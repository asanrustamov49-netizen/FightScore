import type { ReactNode } from "react";
import { Button } from "../Button/Button";
import { Icon, type IconName } from "../Icon/Icon";
import styles from "./Notice.module.scss";

const TONE_ICON: Record<"error" | "warning" | "info" | "success", IconName> = { error: "alert", warning: "alert", info: "info", success: "check" };

export function Notice({ tone = "info", title, children }: { tone?: "error" | "warning" | "info" | "success"; title?: string; children: ReactNode }) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={TONE_ICON[tone]} size={18} className={styles.noticeIcon} />
      <div className={styles.noticeBody}>
        {title && <strong className={styles.noticeTitle}>{title}</strong>}
        {children}
      </div>
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

/** Empty list: what is missing, why, and what to do next. */
export function Empty({ title, icon, children, action }: { title: string; icon?: IconName; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.state}>
      {icon && (
        <span className={styles.stateIcon} aria-hidden>
          <Icon name={icon} size={26} />
        </span>
      )}
      <span className={styles.stateTitle}>{title}</span>
      {children && <span className={styles.stateText}>{children}</span>}
      {action && <div className={styles.stateAction}>{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className={styles.state} role="alert">
      <span className={`${styles.stateIcon} ${styles.stateIconError}`} aria-hidden>
        <Icon name="alert" size={26} />
      </span>
      <span className={styles.stateTitle}>Не удалось загрузить данные</span>
      <span className={styles.stateText}>{message}</span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </div>
  );
}

function Bar({ w, h = 14 }: { w: string; h?: number }) {
  return <span className="fs-skeleton" style={{ width: w, height: h }} />;
}

/** Page placeholder while the first data loads: keeps the layout steady instead of a lone spinner. */
export function PageSkeleton({ cards = 3, label = "Загрузка…" }: { cards?: number; label?: string }) {
  return (
    <div className={styles.skeletonPage} role="status" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      <div className={styles.skeletonHead} aria-hidden>
        <Bar w="9rem" h={12} />
        <Bar w="min(22rem, 70%)" h={30} />
        <Bar w="min(32rem, 90%)" />
      </div>
      <div className={styles.skeletonGrid} aria-hidden>
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className={styles.skeletonCard}>
            <Bar w="60%" h={18} />
            <Bar w="85%" />
            <Bar w="40%" />
          </div>
        ))}
      </div>
    </div>
  );
}
