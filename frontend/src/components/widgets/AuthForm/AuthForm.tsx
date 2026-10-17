"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/src/components/ui/Button/Button";
import { Field, Input } from "@/src/components/ui/Form/Form";
import { Notice } from "@/src/components/ui/Notice/Notice";
import { api, errorText } from "@/src/lib/api";
import type { AuthOptions, Me } from "@/src/lib/types";
import styles from "./AuthForm.module.scss";

export type AuthMode = "login" | "register";

interface Props {
  /** Registration is offered only to organizers; judges and operators get accounts from an organizer. */
  allowRegister?: boolean;
  initialMode?: AuthMode;
  onSuccess: (me: Me) => void;
}

/** Local sign-in (works without internet) and optional organizer sign-up. */
export function AuthForm({ allowRegister = false, initialMode = "login", onSuccess }: Props) {
  const [options, setOptions] = useState<AuthOptions | null>(null);
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [login, setLogin] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<AuthOptions>("/auth/options").then(setOptions, () => setOptions({ registration: false, minPasswordLength: 8 }));
  }, []);

  const canRegister = allowRegister && !!options?.registration;
  const activeMode: AuthMode = canRegister ? mode : "login";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me =
        activeMode === "login"
          ? await api.postQuiet<Me>("/auth/login", { login, password })
          : await api.postQuiet<Me>("/auth/register", { login, displayName, password });
      onSuccess(me);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      {canRegister && (
        <div className={styles.tabs} role="tablist" aria-label="Вход или регистрация">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={activeMode === m}
              className={`${styles.tab} ${activeMode === m ? styles.tabActive : ""}`}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
            >
              {m === "login" ? "Вход" : "Регистрация организатора"}
            </button>
          ))}
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <form className={styles.form} onSubmit={submit}>
        <Field label="Логин" hint={activeMode === "register" ? "Латиница, цифры, точка, дефис, подчёркивание" : undefined}>
          {(id) => <Input id={id} autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />}
        </Field>
        {activeMode === "register" && (
          <Field label="Имя или название организации">
            {(id) => <Input id={id} autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={120} />}
          </Field>
        )}
        <Field label="Пароль" hint={activeMode === "register" ? `Не короче ${options?.minPasswordLength ?? 8} символов` : undefined}>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete={activeMode === "register" ? "new-password" : "current-password"}
              value={password}
              minLength={activeMode === "register" ? options?.minPasswordLength : undefined}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          {activeMode === "login" ? "Войти" : "Создать аккаунт организатора"}
        </Button>
      </form>
      {activeMode === "register" ? (
        <p className={styles.note}>Аккаунт даёт право создавать свои турниры. Другие турниры и их участники вам видны не будут.</p>
      ) : (
        <p className={styles.note}>Локальная учётная запись работает без интернета.</p>
      )}
    </div>
  );
}
