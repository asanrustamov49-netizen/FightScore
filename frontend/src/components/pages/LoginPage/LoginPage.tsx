"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Brand } from "@/src/components/layout/AppShell/AppShell";
import { Icon, type IconName } from "@/src/components/ui/Icon/Icon";
import { AuthForm } from "@/src/components/widgets/AuthForm/AuthForm";
import styles from "./LoginPage.module.scss";

/** Only same-origin paths are accepted as a redirect target (no open redirect). */
export function safeNext(value: string | null, fallback = "/dashboard"): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

const POINTS: { icon: IconName; title: string; text: string }[] = [
  { icon: "trophy", title: "Турниры и поединки", text: "Участники, правила, судьи и результаты в одном месте." },
  { icon: "shield", title: "Сервер — источник истины", text: "Счёт и время подтверждаются сервером и пишутся в журнал." },
  { icon: "wifiOff", title: "Работает без интернета", text: "Достаточно локальной сети на площадке." },
];

export function LoginPage() {
  const router = useRouter();
  const query = useSearchParams();
  const next = safeNext(query.get("next"));
  const mode = query.get("mode") === "register" ? "register" : "login";

  return (
    <div className={styles.page}>
      <aside className={styles.side} aria-label="О FightScore">
        <Brand />
        <div className={styles.sideBody}>
          <h2 className={styles.sideTitle}>Судейство, счёт и табло — в одной системе</h2>
          <ul className={styles.points}>
            {POINTS.map((p) => (
              <li key={p.title}>
                <span className={styles.pointIcon}>
                  <Icon name={p.icon} size={20} />
                </span>
                <span>
                  <strong>{p.title}</strong>
                  {p.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.miniBoard} aria-hidden>
          <span className={styles.miniRed}>3</span>
          <span className={styles.miniClock}>01:58</span>
          <span className={styles.miniBlue}>2</span>
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.mobileBrand}>
          <Brand />
        </div>
        <div className={styles.panel}>
          <AuthForm key={mode} allowRegister initialMode={mode} onSuccess={() => router.replace(next)} />
        </div>
        <p className={styles.footnote}>
          Зрителям вход не нужен — <Link href="/display">табло открывается по ссылке</Link>.{" "}
          <Link href="/" className={styles.home}>
            <Icon name="arrow" size={14} className={styles.back} />
            На главную
          </Link>
        </p>
      </main>
    </div>
  );
}
