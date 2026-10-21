"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, ApiError } from "./api";
import type { Clock, MatchSnapshot, PublicDisplay, PublicMatch } from "./types";

export type LinkStatus = "connecting" | "online" | "offline";

/** Socket.IO goes straight to the backend port; the ticket replaces the cookie (docs/ARCHITECTURE.md §9.2). */
function realtimeBase(): string {
  if (process.env.NEXT_PUBLIC_REALTIME_URL) return process.env.NEXT_PUBLIC_REALTIME_URL;
  const port = process.env.NEXT_PUBLIC_REALTIME_PORT ?? "3001";
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
}

/** Estimates server-minus-client clock offset with the RTT/2 correction; repeats every 15 s. */
function syncClock(socket: Socket, onOffset: (offset: number) => void) {
  const probe = async () => {
    const sent = Date.now();
    try {
      const { serverTime } = await socket.timeout(3000).emitWithAck("time.sync");
      const now = Date.now();
      onOffset(serverTime + (now - sent) / 2 - now);
    } catch {
      // keep the previous estimate
    }
  };
  void probe();
  const id = setInterval(probe, 15_000);
  return () => clearInterval(id);
}

/** Remaining time on the server clock, redrawn every animation frame while running. */
export function useCountdown(clock: Clock | undefined, serverTime: number | undefined, offset: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!clock?.running) return;
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clock?.running]);
  if (!clock || serverTime === undefined) return 0;
  if (!clock.running) return clock.remainingMs;
  return Math.max(0, clock.remainingMs - (now + offset - serverTime));
}

export interface PendingCommand {
  commandId: string;
  type: string;
  sentAt: number;
}

export interface CommandOutcome {
  ok: boolean;
  status?: "accepted" | "duplicate";
  error?: { code: string; message: string };
}

/** Officials' channel: authoritative snapshots + commands with acknowledgement. */
export function useMatchChannel(matchId: string) {
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [status, setStatus] = useState<LinkStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState<PendingCommand[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const versionRef = useRef(-1);
  const inFlightRef = useRef(new Set<string>());
  const queueRef = useRef(new Map<string, { body: object; resolve: (o: CommandOutcome) => void; type: string; sentAt: number }>());
  // Lets a lost-ack retry call the current flush without the callback referring to itself.
  const retryRef = useRef<(socket: Socket) => void>(() => undefined);

  const accept = useCallback((snap: MatchSnapshot) => {
    if (snap.version < versionRef.current) return;
    versionRef.current = snap.version;
    setSnapshot((prev) => ({ ...snap, viewer: snap.viewer ?? prev?.viewer }));
  }, []);

  const flush = useCallback((socket: Socket) => {
    for (const [commandId, item] of queueRef.current) {
      if (inFlightRef.current.has(commandId)) continue;
      inFlightRef.current.add(commandId);
      socket
        .timeout(8000)
        .emitWithAck("match.command", item.body)
        .then((ack: { ok: boolean; result?: { status: "accepted" | "duplicate" }; error?: { code: string; message: string } }) => {
          inFlightRef.current.delete(commandId);
          queueRef.current.delete(commandId);
          setPending([...queueRef.current].map(([id, q]) => ({ commandId: id, type: q.type, sentAt: q.sentAt })));
          item.resolve(ack.ok ? { ok: true, status: ack.result?.status } : { ok: false, error: ack.error });
        })
        .catch(() => {
          inFlightRef.current.delete(commandId);
          // No ack: keep it queued with the same commandId (the server answers "duplicate" if it was applied).
          // Disconnected → resent on reconnect; still connected (slow server, lost ack) → retried here, otherwise
          // it would wait for a reconnect that may never come and stay "pending" forever.
          if (socket.connected) setTimeout(() => socket.connected && retryRef.current(socket), 1500);
        });
    }
  }, []);

  useEffect(() => {
    retryRef.current = flush;
  }, [flush]);

  useEffect(() => {
    const socket = io(`${realtimeBase()}/realtime`, {
      transports: ["websocket"],
      reconnectionDelayMax: 4000,
      auth: (cb) => {
        api
          .post<{ ticket: string }>("/auth/realtime-ticket")
          .then(({ ticket }) => cb({ ticket }))
          .catch(() => cb({}));
      },
    });
    socketRef.current = socket;
    let stopSync = () => {};
    socket.on("connect", async () => {
      setError(null);
      const ack = await socket.timeout(8000).emitWithAck("match.subscribe", { matchId }).catch(() => null);
      if (!ack?.ok) {
        setStatus("offline");
        setError(ack?.error?.message ?? "Не удалось подписаться на поединок");
        return;
      }
      versionRef.current = -1;
      inFlightRef.current.clear();
      accept(ack.snapshot);
      setStatus("online");
      stopSync();
      stopSync = syncClock(socket, setOffset);
      flush(socket);
    });
    socket.on("match.state", (snap: MatchSnapshot) => accept(snap));
    socket.on("disconnect", () => setStatus("offline"));
    socket.on("connect_error", () => setStatus("offline"));
    socket.io.on("reconnect_attempt", () => setStatus("connecting"));
    return () => {
      stopSync();
      socket.close();
    };
  }, [matchId, accept, flush]);

  const send = useCallback(
    (command: { type: string } & Record<string, unknown>): Promise<CommandOutcome> => {
      const commandId = crypto.randomUUID();
      const body = { matchId, commandId, expectedVersion: versionRef.current, command };
      return new Promise((resolve) => {
        queueRef.current.set(commandId, { body, resolve, type: command.type, sentAt: Date.now() });
        setPending([...queueRef.current].map(([id, q]) => ({ commandId: id, type: q.type, sentAt: q.sentAt })));
        const socket = socketRef.current;
        if (socket?.connected) flush(socket);
      });
    },
    [matchId, flush],
  );

  return { snapshot, status, error, offset, pending, send };
}

/** TV display channel: read-only, by public token. */
export function useDisplayChannel(token: string) {
  const [data, setData] = useState<PublicDisplay | null>(null);
  const [status, setStatus] = useState<LinkStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .get<PublicDisplay>(`/public/displays/${encodeURIComponent(token)}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof ApiError && e.status === 404 ? "Табло не найдено или ссылка устарела" : "Нет связи с сервером"));
    const socket = io(`${realtimeBase()}/public`, { transports: ["websocket"], reconnectionDelayMax: 4000 });
    let stopSync = () => {};
    socket.on("connect", async () => {
      const ack = await socket.timeout(8000).emitWithAck("display.subscribe", { token }).catch(() => null);
      if (!ack?.ok) {
        setStatus("offline");
        setError(ack?.error?.code === "NOT_FOUND" ? "Табло не найдено или ссылка устарела" : "Не удалось подключиться к табло");
        return;
      }
      setError(null);
      setData(ack.view);
      setStatus("online");
      stopSync();
      stopSync = syncClock(socket, setOffset);
    });
    socket.on("display.match", (match: PublicMatch) =>
      setData((prev) => (prev && (!prev.match || prev.match.matchId !== match.matchId || match.version >= prev.match.version) ? { ...prev, match } : prev)),
    );
    socket.on("display.state", (view: PublicDisplay | null) => (view ? setData(view) : setError("Табло отключено")));
    socket.on("display.revoked", () => setError("Ссылка на табло отозвана"));
    socket.on("disconnect", () => setStatus("offline"));
    socket.on("connect_error", () => setStatus("offline"));
    socket.io.on("reconnect_attempt", () => setStatus("connecting"));
    return () => {
      alive = false;
      stopSync();
      socket.close();
    };
  }, [token]);

  return { data, status, error, offset };
}
