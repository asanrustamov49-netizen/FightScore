import Link from "next/link";
import type { ReactNode } from "react";
import { MatchStatusBadge } from "@/src/components/ui/Badge/Badge";
import { Icon } from "@/src/components/ui/Icon/Icon";
import { Empty } from "@/src/components/ui/Notice/Notice";
import { LinkRow, RowLink, Table, tableStyles } from "@/src/components/ui/Table/Table";
import type { MatchListItem } from "@/src/lib/types";
import styles from "./MatchTable.module.scss";

/** Each row opens the match; the judging link next to it works on its own. */
export function MatchTable({
  matches,
  showTournament = true,
  emptyText = "Поединков пока нет",
  emptyHint,
  emptyAction,
}: {
  matches: MatchListItem[];
  showTournament?: boolean;
  emptyText?: string;
  emptyHint?: ReactNode;
  emptyAction?: ReactNode;
}) {
  if (!matches.length)
    return (
      <Empty icon="versus" title={emptyText} action={emptyAction}>
        {emptyHint}
      </Empty>
    );
  return (
    <Table
      caption="Поединки"
      head={
        <tr>
          <th>№</th>
          <th>Участники</th>
          {showTournament && <th>Турнир</th>}
          <th>Статус</th>
          <th className={tableStyles.num}>Счёт</th>
          <th className={tableStyles.end}>
            <span className="visually-hidden">Действия</span>
          </th>
        </tr>
      }
    >
      {matches.map((m) => (
        <LinkRow key={m.id}>
          <td className={styles.number}>
            <RowLink href={`/matches/${m.id}`} label={`Поединок №${m.match_number}: ${m.red_name ?? "не назначен"} против ${m.blue_name ?? "не назначен"}`}>
              {m.match_number}
            </RowLink>
          </td>
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
          <td className={tableStyles.end}>
            {m.is_official && ["ready", "live", "awaiting_confirmation"].includes(m.status) ? (
              <Link href={`/judge/${m.id}`} className={styles.judge}>
                Судейство
                <Icon name="arrow" size={16} />
              </Link>
            ) : (
              <Icon name="chevron" size={18} className={styles.chevron} />
            )}
          </td>
        </LinkRow>
      ))}
    </Table>
  );
}
