import type { ReactNode } from "react";
import { Button } from "../Button/Button";
import styles from "./Notice.module.scss";

export function Notice({ tone = "info", children }: { tone?: "error" | "warning" | "info" | "success"; children: ReactNode }) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Loading({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className={styles.state} role="status">
      <span className={styles.spinner} aria-hidden />
      {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.state}>
      <span className={styles.stateTitle}>{title}</span>
      {children}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className={styles.state} role="alert">
      <span className={styles.stateTitle}>Не удалось загрузить данные</span>
      <span>{message}</span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </div>
  );
}
