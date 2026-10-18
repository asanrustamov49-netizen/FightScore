"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/src/components/ui/Button/Button";
import { Field, Input } from "@/src/components/ui/Form/Form";
import { PasswordInput } from "@/src/components/ui/Form/PasswordInput";
import { Notice } from "@/src/components/ui/Notice/Notice";
import { api, ApiError, errorText } from "@/src/lib/api";
import type { AuthOptions, Me } from "@/src/lib/types";
import styles from "./AuthForm.module.scss";

export type AuthMode = "login" | "register";

interface Props {
  /** Registration is offered only to organizers; judges and operators get accounts from an organizer. */
  allowRegister?: boolean;
  initialMode?: AuthMode;
  onSuccess: (me: Me) => void;
  /** Page title and lead above the form (off when the page already has its own heading). */
  heading?: boolean;
}

type FieldName = "login" | "displayName" | "password";

/** Local sign-in (works without internet) and optional organizer sign-up. */
export function AuthForm({ allowRegister = false, initialMode = "login", onSuccess, heading = true }: Props) {
  const [options, setOptions] = useState<AuthOptions | null>(null);
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [login, setLogin] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.get<AuthOptions>("/auth/options").then(setOptions, () => setOptions({ registration: false, minPasswordLength: 8 }));
  }, []);

  const canRegister = allowRegister && !!options?.registration;
  const activeMode: AuthMode = canRegister ? mode : "login";
  const minLength = options?.minPasswordLength ?? 8;

  function switchMode(m: AuthMode) {
    setMode(m);
    setError(null);
    setFieldErrors({});
  }

  // Only "is it filled in" and the length the server announced; everything else is the server's answer.
  function validate(): boolean {
    const errs: Partial<Record<FieldName, string>> = {};
    if (!login.trim()) errs.login = "Введите логин";
    if (activeMode === "register" && !displayName.trim()) errs.displayName = "Введите имя или название организации";
    if (!password) errs.password = "Введите пароль";
    else if (activeMode === "register" && password.length < minLength) errs.password = `Пароль должен быть не короче ${minLength} символов`;
    setFieldErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) document.querySelector<HTMLInputElement>(`[data-field="${first}"]`)?.focus();
    return !first;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || done) return;
    setError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      const me =
        activeMode === "login"
          ? await api.postQuiet<Me>("/auth/login", { login, password })
          : await api.postQuiet<Me>("/auth/register", { login, displayName, password });
      // Keep the button disabled while the next page loads: no second submit.
      setDone(true);
      onSuccess(me);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Неверный логин или пароль. Проверьте раскладку и Caps Lock." : errorText(err));
      setBusy(false);
    }
  }

  const clear = (name: FieldName) => fieldErrors[name] && setFieldErrors((f) => ({ ...f, [name]: undefined }));

  return (
    <div className={styles.wrap}>
      {canRegister && (
        <div className={styles.tabs} role="tablist" aria-label="Вход или регистрация" data-mode={activeMode}>
          <span className={styles.tabIndicator} aria-hidden />
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={activeMode === m}
              className={`${styles.tab} ${activeMode === m ? styles.tabActive : ""}`}
              onClick={() => switchMode(m)}
            >
              {m === "login" ? "Вход" : "Регистрация"}
            </button>
          ))}
        </div>
      )}

      {heading && (
        <div className={styles.heading} key={activeMode}>
          <h1>{activeMode === "login" ? "С возвращением" : "Аккаунт организатора"}</h1>
          <p>
            {activeMode === "login"
              ? "Войдите, чтобы вести турниры, судить поединки или управлять табло."
              : "Создайте аккаунт, чтобы проводить свои турниры. Судьям аккаунты выдаёт организатор."}
          </p>
        </div>
      )}

      <form className={styles.form} onSubmit={submit} noValidate>
        <Field label="Логин" error={fieldErrors.login} hint={activeMode === "register" ? "Латиница, цифры и символы . _ - @ + (подойдёт e-mail)" : undefined}>
          {(id, describedBy) => (
            <Input
              id={id}
              data-field="login"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={login}
              onChange={(e) => (setLogin(e.target.value), clear("login"))}
              aria-invalid={!!fieldErrors.login}
              aria-describedby={describedBy}
              placeholder={activeMode === "register" ? "например, club.admin" : undefined}
              required
              autoFocus
            />
          )}
        </Field>
        {activeMode === "register" && (
          <div className={styles.reveal}>
            <Field label="Имя или название организации" error={fieldErrors.displayName}>
              {(id, describedBy) => (
                <Input
                  id={id}
                  data-field="displayName"
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => (setDisplayName(e.target.value), clear("displayName"))}
                  aria-invalid={!!fieldErrors.displayName}
                  aria-describedby={describedBy}
                  required
                  maxLength={120}
                />
              )}
            </Field>
          </div>
        )}
        <Field label="Пароль" error={fieldErrors.password} hint={activeMode === "register" ? `Не короче ${minLength} символов` : undefined}>
          {(id, describedBy) => (
            <PasswordInput
              id={id}
              data-field="password"
              autoComplete={activeMode === "register" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => (setPassword(e.target.value), clear("password"))}
              aria-invalid={!!fieldErrors.password}
              aria-describedby={describedBy}
              required
            />
          )}
        </Field>

        <div aria-live="polite" className={styles.live}>
          {error && <Notice tone="error">{error}</Notice>}
        </div>

        <Button type="submit" variant="primary" size="lg" block loading={busy || done}>
          {done ? "Вход выполнен…" : activeMode === "login" ? "Войти" : "Создать аккаунт"}
        </Button>
      </form>

      {activeMode === "register" ? (
        <p className={styles.note}>Аккаунт даёт право создавать свои турниры. Чужие турниры и их участники вам видны не будут.</p>
      ) : canRegister ? (
        <p className={styles.note}>
          Нет аккаунта?{" "}
          <button type="button" className={styles.inlineLink} onClick={() => switchMode("register")}>
            Зарегистрируйтесь как организатор
          </button>
          . Аккаунт судьи выдаёт организатор турнира.
        </p>
      ) : (
        <p className={styles.note}>Локальная учётная запись работает без интернета. Аккаунт судьи выдаёт организатор турнира.</p>
      )}
    </div>
  );
}
