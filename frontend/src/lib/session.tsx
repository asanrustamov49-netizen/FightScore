"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import type { Me } from "./types";

interface SessionValue {
  me: Me | null;
  loading: boolean;
  error: string | null;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Loads the current user. UI hides actions the user lacks; the server still checks every request. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    () =>
      api.get<Me>("/auth/me").then(
        (data) => {
          setMe(data);
          setError(null);
          setLoading(false);
        },
        (e) => {
          // 401 is redirected to /login by the api client.
          if (!(e instanceof ApiError && e.status === 401)) setError(e instanceof Error ? e.message : "Ошибка загрузки профиля");
          setLoading(false);
        },
      ),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    // Full page load on purpose: drops all client state of the previous user.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }, []);

  const can = useCallback((p: string) => !!me?.permissions.includes(p), [me]);

  return <SessionContext.Provider value={{ me, loading, error, can, refresh, logout }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}
