"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Brand } from "@/src/components/layout/AppShell/AppShell";
import { Button } from "@/src/components/ui/Button/Button";
import { Field, Input } from "@/src/components/ui/Form/Form";
import { Icon } from "@/src/components/ui/Icon/Icon";
import { Notice } from "@/src/components/ui/Notice/Notice";
import { api, errorText } from "@/src/lib/api";
import type { Me } from "@/src/lib/types";
import styles from "./AdminLoginPage.module.scss";

/**
 * The platform administrator's own sign-in. It accepts only that one account (the server checks), keeps nothing
 * in the browser and says so plainly: every attempt is logged and repeated failures are throttled.
 */
export function AdminLoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.postQuiet<Me>("/auth/admin/login", { login, password });
      router.replace("/admin");
    } catch (err) {
      setError(errorText(err));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page} data-theme="dark">
      <header className={styles.top}>
        <Brand />
        <Link href="/login">← Обычный вход</Link>
      </header>
      <main className={styles.main}>
        <form className={styles.card} onSubmit={submit} aria-labelledby="admin-login-title">
          <span className={styles.badge}>
            <Icon name="shield" size={28} />
          </span>
          <h1 id="admin-login-title">Вход для администратора</h1>
          <p className={styles.lead}>Только для администратора платформы. Организаторы и судьи входят через обычную страницу входа.</p>
          {error && <Notice tone="error">{error}</Notice>}
          <Field label="Логин администратора">
            {(id) => <Input id={id} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required />}
          </Field>
          <Field label="Пароль">
            {(id) => (
              <div className={styles.password}>
                <Input id={id} type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                <button type="button" className={styles.eye} onClick={() => setShow((v) => !v)} aria-label={show ? "Скрыть пароль" : "Показать пароль"} aria-pressed={show}>
                  <Icon name={show ? "eyeOff" : "eye"} size={18} />
                </button>
              </div>
            )}
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!login || !password}>
            <Icon name="lock" size={18} />
            Войти в панель администратора
          </Button>
          <ul className={styles.facts}>
            <li>
              <Icon name="history" size={16} />
              Каждая попытка входа записывается в журнал.
            </li>
            <li>
              <Icon name="timer" size={16} />
              После 5 неудачных попыток вход с этого адреса блокируется на 5 минут.
            </li>
            <li>
              <Icon name="lock" size={16} />
              Сессия администратора длится 8 часов.
            </li>
          </ul>
        </form>
      </main>
    </div>
  );
}
