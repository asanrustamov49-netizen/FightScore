import styles from "./StatTiles.module.scss";

export function StatTiles({ items }: { items: { label: string; value: number | string; live?: boolean }[] }) {
  return (
    <div className={styles.grid}>
      {items.map((i) => (
        <div key={i.label} className={`${styles.tile} ${i.live ? styles.live : ""}`}>
          <div className={styles.label}>{i.label}</div>
          <div className={styles.value}>{i.value}</div>
        </div>
      ))}
    </div>
  );
}
