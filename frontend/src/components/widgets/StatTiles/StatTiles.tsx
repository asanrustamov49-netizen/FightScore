"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/src/components/ui/Icon/Icon";
import styles from "./StatTiles.module.scss";

export interface StatItem {
  label: string;
  value: number | string;
  live?: boolean;
  /** When set, the tile opens the matching list. */
  href?: string;
}

export function StatTiles({ items, compact }: { items: StatItem[]; compact?: boolean }) {
  return (
    <div className={`${styles.grid} ${compact ? styles.compact : ""}`}>
      {items.map((i) => {
        const content = (
          <>
            <div className={styles.label}>{i.label}</div>
            <div className={styles.value}>{typeof i.value === "number" ? <CountUp value={i.value} /> : i.value}</div>
            {i.href && <Icon name="arrow" size={16} className={styles.arrow} />}
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

/** Number that rolls from its previous value to the new one (instant under reduced motion). */
function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    const motion = document.documentElement.getAttribute("data-motion");
    const reduce = motion === "reduce" || (motion !== "full" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (reduce || start === value) {
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown}</>;
}
