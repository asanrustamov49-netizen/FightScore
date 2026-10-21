import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { Icon, type IconName } from "@/src/components/ui/Icon/Icon";
import styles from "./RolePaths.module.scss";

export interface RolePath {
  key: "organizer" | "judge" | "display";
  title: string;
  who: string;
  steps: string[];
  cta: string;
  href: string;
  icon: IconName;
  photo: string;
  focus: string;
}

/**
 * "Where do I go?": one big photo card per role with the three steps that role takes and a single button. The first
 * thing a new organizer, judge or display operator needs is the right door, not a feature list.
 */
export function RolePaths({ paths }: { paths: RolePath[] }) {
  return (
    <div className={styles.grid}>
      {paths.map((p, i) => (
        <Link key={p.key} href={p.href} className={`${styles.card} ${styles[p.key]}`} data-reveal style={{ "--i": i } as CSSProperties}>
          <Image src={p.photo} alt="" fill sizes="(min-width: 900px) 33vw, 100vw" className={styles.photo} style={{ objectPosition: p.focus }} />
          <span className={styles.shade} aria-hidden />
          <span className={styles.body}>
            <span className={styles.head}>
              <span className={styles.icon}>
                <Icon name={p.icon} size={24} />
              </span>
              <span className={styles.num} aria-hidden>
                0{i + 1}
              </span>
            </span>
            <span className={styles.title}>{p.title}</span>
            <span className={styles.who}>{p.who}</span>
            <ol className={styles.steps}>
              {p.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <span className={styles.cta}>
              {p.cta}
              <Icon name="arrow" size={18} />
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}
