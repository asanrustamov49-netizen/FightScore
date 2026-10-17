import type { LinkStatus } from "@/src/lib/realtime";
import styles from "./Connection.module.scss";

const LABEL: Record<LinkStatus, string> = {
  online: "Связь с сервером",
  connecting: "Подключение…",
  offline: "Нет связи",
};

export function ConnectionIndicator({ status }: { status: LinkStatus }) {
  return (
    <span className={`${styles.indicator} ${styles[status]}`} role="status" aria-live="polite">
      <span className={styles.dot} aria-hidden />
      {LABEL[status]}
    </span>
  );
}
