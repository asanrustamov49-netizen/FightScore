"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Brand } from "@/src/components/layout/AppShell/AppShell";
import { Icon, type IconName } from "@/src/components/ui/Icon/Icon";
import { ImageCarousel } from "@/src/components/widgets/ImageCarousel/ImageCarousel";
import { AuthForm } from "@/src/components/widgets/AuthForm/AuthForm";
import { currentUser } from "@/src/lib/api";
import type { Me } from "@/src/lib/types";
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

  // Already signed in (the session lives on): go straight on. To switch accounts, sign out first.
  useEffect(() => {
    currentUser<Me>().then((me) => me && router.replace(next), () => undefined);
  }, [router, next]);

  return (
    <div className={styles.page}>
      <aside className={styles.side} aria-label="О FightScore">
        <ImageCarousel />
        <span className={styles.shade} aria-hidden />
        <div className={styles.sideTop}>
          <Brand />
        </div>
        <div className={styles.sideBody}>
          <span className={styles.kicker}>Fight night · судейство · табло</span>
          <h2 className={styles.sideTitle}>
            Каждый бой — <span>под контролем</span>
          </h2>
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
      </aside>

      <main className={styles.main}>
        <div className={styles.mobileBrand}>
          <ImageCarousel captions={false} />
          <span className={styles.mobileShade} aria-hidden />
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
        <Link href="/admin/login" className={styles.adminLink}>
          <Icon name="shield" size={14} />
          Вход для администратора
        </Link>
      </main>
    </div>
  );
}
