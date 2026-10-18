"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Icon } from "../Icon/Icon";
import styles from "./Form.module.scss";

/** Password input with a show/hide toggle (the toggle never submits the form). */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className={styles.affix}>
      <input {...props} type={shown ? "text" : "password"} className={[styles.control, props.className].filter(Boolean).join(" ")} />
      <button
        type="button"
        className={styles.affixButton}
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Скрыть пароль" : "Показать пароль"}
        aria-pressed={shown}
        title={shown ? "Скрыть пароль" : "Показать пароль"}
      >
        <Icon name={shown ? "eyeOff" : "eye"} size={18} />
      </button>
    </div>
  );
}
