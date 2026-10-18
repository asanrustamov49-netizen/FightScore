import Link from "next/link";
import styles from "./StatTiles.module.scss";

export interface StatItem {
  label: string;
  value: number | string;
  live?: boolean;
  /** When set, the tile opens the matching list. */
  href?: string;
}

export function StatTiles({ items }: { items: StatItem[] }) {
  return (
    <div className={styles.grid}>
      {items.map((i) => {
        const content = (
          <>
            <div className={styles.label}>{i.label}</div>
            <div className={styles.value}>{i.value}</div>
          </>
        );
        const cls = `${styles.tile} ${i.live ? styles.live : ""} ${i.href ? styles.link : ""}`;
        return i.href ? (
          <Link key={i.label} href={i.href} className={cls} scroll={false}>
            {content}
          </Link>
        ) : (
          <div key={i.label} className={cls}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
