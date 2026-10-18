"use client";

import type { ReactNode } from "react";
import { useTip } from "@/src/lib/onboarding";
import { Icon } from "../Icon/Icon";
import styles from "./Tip.module.scss";

/**
 * A short contextual hint for a section ("what is this for, what to do here"). Shown once per section until
 * the user closes it; the account menu brings all tips back. Never blocks the page.
 */
export function Tip({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const { visible, dismiss } = useTip(id);
  if (!visible) return null;
  return (
    <aside className={styles.tip} aria-label={`Подсказка: ${title}`}>
      <span className={styles.icon} aria-hidden>
        <Icon name="sparkle" size={18} />
      </span>
      <div className={styles.body}>
        <strong>{title}</strong>
        <div className={styles.text}>{children}</div>
      </div>
      <button type="button" className={styles.close} onClick={dismiss}>
        Понятно
      </button>
    </aside>
  );
}
