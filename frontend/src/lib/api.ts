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

type ApiBody = { code?: string; message?: string; details?: unknown } | null;

/** How long a request keeps waiting for a backend that is still starting (or restarting) before it gives up. */
const SERVER_WAIT_MS = 45_000;
const MIN_ATTEMPTS = 14;
/** Window event with `detail: boolean`: some request is waiting for the backend right now. */
export const SERVER_WAIT_EVENT = "fs:server-wait";

let waiting = 0;
function setWaiting(delta: number) {
  waiting = Math.max(0, waiting + delta);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SERVER_WAIT_EVENT, { detail: waiting > 0 }));
}

/**
 * The backend could not be reached at all: no connection, or the Next.js proxy answered for it (5xx without the
 * API's JSON body). The request never got to the API, so sending it again is safe even for POST.
 */
function unreachable(res: Response | null, data: ApiBody) {
  return !res || ([500, 502, 503].includes(res.status) && !data?.code);
}

async function send(method: string, path: string, body?: unknown): Promise<{ res: Response | null; data: ApiBody }> {
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
    return { res: null, data: null };
  }
  if (res.status === 204) return { res, data: null };
  return { res, data: await res.json().catch(() => null) };
}

/**
 * Sends a request. While the backend is unreachable (still starting, restarting), it waits and retries for up to
 * SERVER_WAIT_MS and announces the wait, so the page shows "connecting" instead of an error.
 */
async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const started = Date.now();
  let delay = 600;
  let attempts = 0;
  let counted = false;
  try {
    for (;;) {
      const { res, data } = await send(method, path, body);
      attempts++;
      // Gives up only after enough real attempts too: a background tab throttles timers, and the clock alone would
      // end the wait after one or two tries.
      const expired = Date.now() - started > SERVER_WAIT_MS && attempts >= MIN_ATTEMPTS;
      if (!unreachable(res, data) || expired) return finish<T>(res, data, path, opts);
      if (!counted) {
        counted = true;
        setWaiting(1);
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.6, 4000);
    }
  } finally {
    if (counted) setWaiting(-1);
  }
}

function finish<T>(res: Response | null, data: ApiBody, path: string, opts: RequestOptions): T {
  if (!res) throw new ApiError(0, "NETWORK", "Нет связи с сервером FightScore. Проверьте, что сервер запущен, и повторите.");
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !opts.quiet401 && path !== "/auth/login") {
      // Expired session: full page load to /login so no stale data stays on screen.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
    // 5xx without the API's JSON: the proxy answered, the backend did not.
    const fallback = res.status >= 500 ? "Сервер FightScore не отвечает. Проверьте, что он запущен, и повторите." : `Ошибка ${res.status}`;
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
