import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.scss";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "red" | "blue";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  block?: boolean;
}

export function Button({ variant = "secondary", size = "md", loading, block, className, children, disabled, type = "button", ...rest }: Props) {
  const cls = [styles.button, styles[variant], styles[size], block && styles.block, className].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <span className={styles.spinner} aria-hidden />}
      {children}
    </button>
  );
}

/** Navigation styled as a button (avoids nesting <button> inside <a>). */
export function ButtonLink({ href, variant = "secondary", size = "md", children, target }: { href: string; variant?: Variant; size?: "sm" | "md" | "lg"; children: ReactNode; target?: string }) {
  return (
    <Link href={href} target={target} className={[styles.button, styles[variant], styles[size], styles.link].join(" ")}>
      {children}
    </Link>
  );
}
