import type { ReactNode } from "react";
import styles from "./Table.module.scss";

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <thead>{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const tableStyles = styles;
