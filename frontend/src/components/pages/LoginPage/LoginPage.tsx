"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Brand } from "@/src/components/layout/AppShell/AppShell";
import { AuthForm } from "@/src/components/widgets/AuthForm/AuthForm";
import styles from "./LoginPage.module.scss";

/** Only same-origin paths are accepted as a redirect target (no open redirect). */
export function safeNext(value: string | null, fallback = "/dashboard"): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

export function LoginPage() {
  const router = useRouter();
  const query = useSearchParams();
  const next = safeNext(query.get("next"));
  const mode = query.get("mode") === "register" ? "register" : "login";

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <Brand />
        <p className={styles.lead}>Вход для организаторов, судей и операторов табло</p>
        <AuthForm key={mode} allowRegister initialMode={mode} onSuccess={() => router.replace(next)} />
        <p className={styles.note}>
          Зрителям вход не нужен — <Link href="/display">табло открывается по ссылке</Link>. <Link href="/">На главную</Link>
        </p>
      </div>
    </main>
  );
}
