"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Icon } from "../Icon/Icon";
import styles from "./Toast.module.scss";

type Tone = "success" | "error" | "info";
interface Toast {
  id: number;
  tone: Tone;
  message: string;
  leaving?: boolean;
}

/** Matches the leave animation in Toast.module.scss. */
const LEAVE_MS = 200;

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => undefined);

/** Short confirmations after an action ("Сохранено"). Errors that need reading stay inline next to the form. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => {
    setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), LEAVE_MS);
  }, []);
  const show = useCallback(
    (message: string, tone: Tone = "success") => {
      const id = next.current++;
      setItems((list) => [...list.slice(-3), { id, tone, message }]);
      setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4000);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={styles.region} aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[t.tone]} ${t.leaving ? styles.leaving : ""}`} role={t.tone === "error" ? "alert" : "status"}>
            <Icon name={t.tone === "error" ? "alert" : t.tone === "info" ? "info" : "check"} size={18} />
            <span>{t.message}</span>
            <button type="button" className={styles.close} onClick={() => dismiss(t.id)} aria-label="Закрыть уведомление">
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
