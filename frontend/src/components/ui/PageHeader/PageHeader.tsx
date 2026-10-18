import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "../Icon/Icon";
import styles from "./PageHeader.module.scss";

export interface Crumb {
  label: ReactNode;
  href?: string;
}

interface Props {
  title: ReactNode;
  /** Where the page sits: links back to its parents. The current page is the title, not a crumb. */
  breadcrumbs?: Crumb[];
  eyebrow?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, breadcrumbs, eyebrow, description, meta, actions }: Props) {
  return (
    <div className={styles.header}>
      <div className={styles.text}>
        {breadcrumbs?.length ? (
          <nav aria-label="Навигационная цепочка" className={styles.crumbs}>
            <ol>
              {breadcrumbs.map((c, i) => (
                <li key={i}>
                  {c.href ? <Link href={c.href}>{c.label}</Link> : <span>{c.label}</span>}
                  <Icon name="chevron" size={14} />
                </li>
              ))}
            </ol>
          </nav>
        ) : (
          eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>
        )}
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
        {meta && <div className={styles.meta}>{meta}</div>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

/** Icon + text fact for page meta lines (dates, venue, discipline). */
export function MetaItem({ icon, children }: { icon: Parameters<typeof Icon>[0]["name"]; children: ReactNode }) {
  return (
    <span className={styles.metaItem}>
      <Icon name={icon} size={16} />
      {children}
    </span>
  );
}

export function Stack({ children, gap }: { children: ReactNode; gap?: "sm" | "md" }) {
  return <div className={`${styles.stack} ${gap === "sm" ? styles.stackSm : ""}`}>{children}</div>;
}

/** Main column + side column on wide screens, single column on narrow ones. */
export function Columns({ children, sideFirstOnNarrow }: { children: ReactNode; sideFirstOnNarrow?: boolean }) {
  return <div className={`${styles.columns} ${sideFirstOnNarrow ? styles.sideFirst : ""}`}>{children}</div>;
}

export function BulletList({ children }: { children: ReactNode }) {
  return <ul className={styles.list}>{children}</ul>;
}

/** Responsive grid of cards. */
export function CardGrid({ children, min = 280 }: { children: ReactNode; min?: number }) {
  return (
    <div className={styles.grid} style={{ "--min": `${min}px` } as React.CSSProperties}>
      {children}
    </div>
  );
}

/** Row of filter chips / toolbar above a list. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className={styles.toolbar}>{children}</div>;
}
