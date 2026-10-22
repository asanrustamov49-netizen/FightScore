"use client";

import { useEffect, useState } from "react";
import { SERVER_WAIT_EVENT } from "@/src/lib/api";
import styles from "./ServerWait.module.scss";

/**
 * "Connecting to the server" bar while the backend is still starting. Requests wait for it instead of failing, and
 * this bar says why the page is waiting. Shown after a short delay so a single slow request does not flash it.
 */
export function ServerWait() {
  const [waiting, setWaiting] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const on = (e: Event) => setWaiting((e as CustomEvent<boolean>).detail);
    window.addEventListener(SERVER_WAIT_EVENT, on);
    return () => window.removeEventListener(SERVER_WAIT_EVENT, on);
  }, []);

  useEffect(() => {
    if (!waiting) {
      const t = setTimeout(() => setVisible(false), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setVisible(true), 700);
    return () => clearTimeout(t);
  }, [waiting]);

  if (!visible) return null;
  return (
    <div className={styles.bar} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden />
      <span>
        <strong>Подключаемся к серверу…</strong> Он ещё запускается. Страница продолжит работу сама, ничего нажимать не нужно.
      </span>
    </div>
  );
}
