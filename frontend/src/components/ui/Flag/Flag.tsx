import styles from "./Flag.module.scss";

/**
 * Country as an ISO code badge (+ optional name). Flag emoji are not used: Windows renders them as
 * the same two letters, which duplicated the code. Local SVG flags are a later stage (ARCHITECTURE §16).
 */
export function Flag({ code, name, showName }: { code: string | null | undefined; name?: string | null; showName?: boolean }) {
  if (!code) return null;
  return (
    <span className={styles.flag} title={name ?? code}>
      <span className={styles.code}>{code}</span>
      {showName && name && <span>{name}</span>}
    </span>
  );
}
