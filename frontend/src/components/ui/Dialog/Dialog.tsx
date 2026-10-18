"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "../Button/Button";
import styles from "./Dialog.module.scss";

interface Props {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  confirmVariant?: "primary" | "danger" | "red" | "blue";
  confirmDisabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Native <dialog>: focus trap and Esc handling come from the browser. Used for dangerous actions. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Подтвердить",
  confirmVariant = "primary",
  confirmDisabled,
  busy,
  onConfirm,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose} aria-labelledby={titleId}>
      <form
        method="dialog"
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm();
        }}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" variant={confirmVariant} loading={busy} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

export function DialogText({ children }: { children: ReactNode }) {
  return <p className={styles.text}>{children}</p>;
}
