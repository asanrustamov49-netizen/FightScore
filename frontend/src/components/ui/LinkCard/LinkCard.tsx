import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./LinkCard.module.scss";

interface Props {
  href: string;
  title: ReactNode;
  /** Accessible name when the title is not plain text. */
  label?: string;
  eyebrow?: ReactNode;
  badges?: ReactNode;
  children?: ReactNode;
  /** Buttons and links that do their own thing; clicking them never opens the card. */
  actions?: ReactNode;
  accent?: "red" | "blue" | "live" | "muted";
}

/**
 * A card that opens its page from anywhere on its surface. One real <a> is stretched over the card
 * (keyboard: Tab to it, Enter opens); actions sit above that layer and keep their own behaviour.
 */
export function LinkCard({ href, title, label, eyebrow, badges, children, actions, accent }: Props) {
  return (
    <article className={`${styles.card} ${accent ? styles[accent] : ""}`}>
      <div className={styles.head}>
        <div className={styles.titles}>
          {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
          <h3 className={styles.title}>
            <Link href={href} className={styles.link} aria-label={label}>
              {title}
            </Link>
          </h3>
        </div>
        {badges && <div className={styles.badges}>{badges}</div>}
      </div>
      {children && <div className={styles.body}>{children}</div>}
      {actions && <div className={styles.actions}>{actions}</div>}
    </article>
  );
}

/** Small "label / value" facts inside cards. */
export function CardFacts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className={styles.facts}>
      {items.map((i) => (
        <div key={i.label}>
          <dt>{i.label}</dt>
          <dd>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
