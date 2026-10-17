"use client";

/** Thin client for the NestJS API behind the /api rewrite. No business rules live here. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

interface RequestOptions {
  /** Public pages: report 401 to the caller instead of redirecting to /login. */
  quiet401?: boolean;
}

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(method === "GET" ? {} : { "X-FightScore-Request": "1" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Нет связи с сервером");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !opts.quiet401 && path !== "/auth/login") {
      // Expired session: full page load to /login so no stale data stays on screen.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
    // 5xx from the proxy usually means the backend is down.
    const fallback = res.status >= 500 ? "Сервер недоступен или вернул ошибку" : `Ошибка ${res.status}`;
    throw new ApiError(res.status, data?.code ?? "HTTP", data?.message ?? fallback, data?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  del: <T>(path: string) => request<T>("DELETE", path),
  /** POST from public forms (login, sign-up): a 401 is an answer, not an expired session. */
  postQuiet: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}, { quiet401: true }),
};

/** Current user for public pages: null when nobody is signed in (no redirect). */
export async function currentUser<T>(): Promise<T | null> {
  try {
    return await request<T>("GET", "/auth/me", undefined, { quiet401: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const details = Array.isArray(err.details)
      ? err.details.map((d: { path?: string; message?: string }) => d.message).filter(Boolean)
      : [];
    return details.length ? `${err.message}: ${details.join("; ")}` : err.message;
  }
  return err instanceof Error ? err.message : "Неизвестная ошибка";
}
