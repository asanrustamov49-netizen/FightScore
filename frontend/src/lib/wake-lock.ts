"use client";

import { useEffect } from "react";

/**
 * Keeps the screen on while `active` (Screen Wake Lock API): a TV board or a judge's laptop must not dim or sleep in
 * the middle of a match. The browser releases the lock when the tab is hidden, so it is taken again on return.
 * Works on localhost and HTTPS; on plain-HTTP LAN addresses the browser offers no lock and this does nothing.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let alive = true;
    let lock: WakeLockSentinel | null = null;
    const request = () => {
      if (document.visibilityState !== "visible" || (lock && !lock.released)) return;
      navigator.wakeLock.request("screen").then(
        (l) => {
          if (alive) lock = l;
          else void l.release();
        },
        () => undefined,
      );
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", request);
      void lock?.release();
    };
  }, [active]);
}
