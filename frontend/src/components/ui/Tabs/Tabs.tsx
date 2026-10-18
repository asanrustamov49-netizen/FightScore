import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./Tabs.module.scss";

export interface TabItem {
  id: string;
  label: ReactNode;
  count?: number;
}

/** Section switcher backed by URLs (?tab=...), so every section can be linked to and reloaded. */
export function Tabs({ items, active, hrefFor, label }: { items: TabItem[]; active: string; hrefFor: (id: string) => string; label: string }) {
  return (
    <nav className={styles.tabs} aria-label={label}>
      {items.map((t) => (
        <Link
          key={t.id}
          href={hrefFor(t.id)}
          scroll={false}
          className={`${styles.tab} ${t.id === active ? styles.active : ""}`}
          aria-current={t.id === active ? "page" : undefined}
        >
          {t.label}
          {t.count !== undefined && <span className={styles.count}>{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Mutually exclusive filter buttons (aria-pressed). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={styles.segment} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className={styles.count}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
