import { useId, type CSSProperties, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Icon } from "../Icon/Icon";
import styles from "./Form.module.scss";

interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  /** Marks the field as not required in its label. */
  optional?: boolean;
  /** `describedBy` points to the hint or error text; pass it to the control as aria-describedby. */
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

export function Field({ label, hint, error, optional, children }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error || hint;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {optional && <span className={styles.optional}>необязательно</span>}
      </label>
      {children(id, note ? noteId : undefined)}
      {error ? (
        <span className={styles.error} id={noteId}>
          <Icon name="alert" size={15} />
          {error}
        </span>
      ) : hint ? (
        <span className={styles.hint} id={noteId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={[styles.control, props.className].filter(Boolean).join(" ")} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={[styles.control, styles.textarea, props.className].filter(Boolean).join(" ")} />;
}

/** Search input with an icon; the label is for screen readers (the placeholder says the same). */
export function SearchField({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string }) {
  return (
    <label className={styles.search}>
      <Icon name="search" size={18} />
      <span className="visually-hidden">{label}</span>
      <input type="search" className={styles.control} placeholder={placeholder ?? label} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={[styles.control, props.className].filter(Boolean).join(" ")} />;
}

export function FormGrid({ cols = 2, children }: { cols?: number; children: ReactNode }) {
  return (
    <div className={styles.grid} style={{ "--cols": cols } as CSSProperties}>
      {children}
    </div>
  );
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}

export function Checkbox({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={styles.check}>
      <input type="checkbox" {...props} />
      {label}
    </label>
  );
}

export function Checks({ children }: { children: ReactNode }) {
  return <div className={styles.checks}>{children}</div>;
}

export function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>{legend}</legend>
      {children}
    </fieldset>
  );
}

export const formClass = styles.form;
export const insetClass = styles.inset;
