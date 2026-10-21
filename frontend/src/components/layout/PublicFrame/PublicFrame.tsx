import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/src/components/layout/AppShell/AppShell";
import { Icon, type IconName } from "@/src/components/ui/Icon/Icon";
import { ModeSwitch } from "@/src/components/ui/ModeSwitch/ModeSwitch";
import styles from "./PublicFrame.module.scss";

/** Frame for public entry pages (/judge, /display): brand, mode switch, a way back home, a focused column. */
export function PublicFrame({
  icon,
  title,
  lead,
  photo,
  children,
}: {
  icon: IconName;
  title: string;
  lead: ReactNode;
  /** Decorative photo behind the top of the page (from /public/auth). */
  photo: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.bg}>
        <Image src={photo} alt="" fill priority sizes="100vw" className={styles.photo} />
      </div>
      <header className={styles.top}>
        <Brand />
        <ModeSwitch className={styles.modeSwitch} />
        <Link href="/" className={styles.home}>
          ← На главную
        </Link>
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
