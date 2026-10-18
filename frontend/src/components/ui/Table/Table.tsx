import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./Table.module.scss";

export function Table({ head, children, caption }: { head: ReactNode; children: ReactNode; caption?: string }) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        {caption && <caption className="visually-hidden">{caption}</caption>}
        <thead>{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * A row that opens `href` from any cell. Put <RowLink> in the first cell: it is the one focusable link,
 * stretched over the row. Other links and buttons in the row stay independent (they sit above it).
 */
export function LinkRow({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={[styles.linkRow, className].filter(Boolean).join(" ")}>{children}</tr>;
}

export function RowLink({ href, children, label }: { href: string; children: ReactNode; label?: string }) {
  return (
    <Link href={href} className={styles.rowLink} aria-label={label}>
      {children}
    </Link>
  );
}

export const tableStyles = styles;
