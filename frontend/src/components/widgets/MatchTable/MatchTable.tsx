import Link from "next/link";
import { MatchStatusBadge } from "@/src/components/ui/Badge/Badge";
import { Empty } from "@/src/components/ui/Notice/Notice";
import { Table, tableStyles } from "@/src/components/ui/Table/Table";
import type { MatchListItem } from "@/src/lib/types";
import styles from "./MatchTable.module.scss";

export function MatchTable({ matches, showTournament = true, emptyText = "Поединков пока нет" }: { matches: MatchListItem[]; showTournament?: boolean; emptyText?: string }) {
  if (!matches.length) return <Empty title={emptyText} />;
  return (
    <Table
      head={
        <tr>
          <th>№</th>
          <th>Участники</th>
          {showTournament && <th>Турнир</th>}
          <th>Статус</th>
          <th className={tableStyles.num}>Счёт</th>
          <th />
        </tr>
      }
    >
      {matches.map((m) => (
        <tr key={m.id}>
          <td className={styles.number}>{m.match_number}</td>
          <td>
            <div className={styles.vs}>
              <span className={`${styles.side} ${styles.red} ${m.winner_side === "red" ? styles.winner : ""}`}>
                {m.red_name ?? <span className={styles.empty}>не назначен</span>}
              </span>
              <span className={`${styles.side} ${styles.blue} ${m.winner_side === "blue" ? styles.winner : ""}`}>
                {m.blue_name ?? <span className={styles.empty}>не назначен</span>}
              </span>
            </div>
          </td>
          {showTournament && (
            <td className={tableStyles.muted}>
              {m.tournament_name}
              <br />
              {m.discipline_name}
            </td>
          )}
          <td>
            <MatchStatusBadge status={m.status} />
          </td>
          <td className={`${tableStyles.num} ${styles.score}`}>
            {m.status === "prepared" || m.status === "ready" ? "—" : `${m.score.red} : ${m.score.blue}`}
          </td>
          <td>
            <div className={styles.actions}>
              {m.is_official && ["ready", "live", "awaiting_confirmation"].includes(m.status) && (
                <Link href={`/judge/${m.id}`}>Судейство →</Link>
              )}
              <Link href={`/matches/${m.id}`}>Открыть</Link>
            </div>
          </td>
        </tr>
      ))}
    </Table>
  );
}
