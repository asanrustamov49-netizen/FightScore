import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/src/components/layout/AppShell/AppShell";
import { Icon, type IconName } from "@/src/components/ui/Icon/Icon";
import styles from "./PublicFrame.module.scss";

/** Frame for public entry pages (/judge, /display): brand, a way back home, a focused column. */
export function PublicFrame({ icon, title, lead, children }: { icon: IconName; title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Brand />
        <Link href="/">← На главную</Link>
      </header>
      <main className={styles.main}>
        <div className={styles.head}>
          <span className={styles.iconBox}>
            <Icon name={icon} size={26} />
          </span>
          <div>
            <h1>{title}</h1>
            <p className={styles.lead}>{lead}</p>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
