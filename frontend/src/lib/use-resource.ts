"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "./api";

interface State<T> {
  path: string | null;
  data: T | null;
  error: string | null;
}

/** GET a resource with loading/error state and a manual reload that keeps the old data visible. */
export function useResource<T>(path: string | null) {
  const [state, setState] = useState<State<T>>({ path: null, data: null, error: null });

  const load = useCallback(
    (onResult: (s: State<T>) => void) => {
      if (!path) return Promise.resolve();
      return api.get<T>(path).then(
        (data) => onResult({ path, data, error: null }),
        (err) => onResult({ path, data: null, error: errorText(err) }),
      );
    },
    [path],
  );

  useEffect(() => {
    let alive = true;
    void load((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, [load]);

  const reload = useCallback(() => load((s) => setState((prev) => ({ ...s, data: s.data ?? prev.data }))), [load]);

  return {
    data: state.path === path ? state.data : null,
    error: state.path === path ? state.error : null,
    loading: !!path && state.path !== path,
    reload,
  };
}
