"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/src/components/ui/Button/Button";
import { Icon } from "@/src/components/ui/Icon/Icon";
import { ErrorState, Loading } from "@/src/components/ui/Notice/Notice";
import { formatDate, formatDateTime, personName } from "@/src/lib/format";
import type { Side } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";
import styles from "./ProtocolPage.module.scss";

interface Participant {
  side: Side;
  first_name: string;
  last_name: string;
  country_code: string | null;
  country_name: string | null;
  club_name: string | null;
}

interface ProtocolResult {
  id: string;
  match_number: number;
  discipline: string;
  winner_side: Side | null;
  outcome: string;
  confirmed_at: string;
  confirmed_by: string;
  participants: Participant[];
  score: Record<Side, number> | null;
  rule_profile: string;
  version_number: number;
  is_demo: boolean;
}

interface Protocol {
  tournament: { id: string; name: string; starts_on: string; ends_on: string; venue: string | null; status: string; organizer: string; matches_total: number };
  results: ProtocolResult[];
  generatedAt: string;
}

const side = (r: ProtocolResult, s: Side) => r.participants.find((p) => p.side === s);
const who = (p: Participant | undefined) => (p ? personName(p) : "—");
const team = (p: Participant | undefined) => [p?.club_name, p?.country_name].filter(Boolean).join(", ");

/** CSV for Excel: UTF-8 with BOM and ";" so Russian Excel opens it with the right letters and columns. */
function toCsv(p: Protocol) {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const head = ["№", "Дисциплина", "Красный угол", "Клуб (красный)", "Синий угол", "Клуб (синий)", "Счёт", "Победитель", "Способ", "Правила", "Подтвердил", "Время подтверждения"];
  const rows = p.results.map((r) => {
    const red = side(r, "red");
    const blue = side(r, "blue");
    return [
      r.match_number,
      r.discipline,
      who(red),
      team(red),
      who(blue),
      team(blue),
      r.score ? `${r.score.red}:${r.score.blue}` : "",
      r.winner_side ? who(side(r, r.winner_side)) : "Без победителя",
      r.outcome,
      `${r.rule_profile}, версия ${r.version_number}${r.is_demo ? " (демо)" : ""}`,
      r.confirmed_by,
      formatDateTime(r.confirmed_at),
    ];
  });
  return "﻿" + [head, ...rows].map((row) => row.map(cell).join(";")).join("\r\n");
}

function download(p: Protocol) {
  const url = URL.createObjectURL(new Blob([toCsv(p)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `Протокол — ${p.tournament.name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Official results protocol: one printable page per tournament, built only from confirmed, unchangeable results. */
export function ProtocolPage() {
  const { id } = useParams<{ id: string }>();
  const res = useResource<Protocol>(`/tournaments/${id}/protocol`);
  const p = res.data;

  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!p) return <Loading label="Готовим протокол…" />;
  const t = p.tournament;
  const anyDemo = p.results.some((r) => r.is_demo);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <Link href={`/tournaments/${t.id}?tab=results`} className={styles.back}>
          ← К турниру
        </Link>
        <div className={styles.toolbarActions}>
          <Button onClick={() => download(p)} disabled={!p.results.length}>
            <Icon name="download" size={18} />
            Скачать для Excel
          </Button>
          <Button variant="primary" onClick={() => window.print()}>
            <Icon name="external" size={18} />
            Печать / PDF
          </Button>
        </div>
      </div>

      <article className={styles.sheet} aria-labelledby="protocol-title">
        <header className={styles.head}>
          <div>
            <p className={styles.kicker}>Протокол результатов</p>
            <h1 id="protocol-title">{t.name}</h1>
            <p className={styles.meta}>
              {formatDate(t.starts_on)}
              {t.ends_on !== t.starts_on && ` — ${formatDate(t.ends_on)}`}
              {t.venue && ` · ${t.venue}`}
            </p>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>Организатор</dt>
              <dd>{t.organizer}</dd>
            </div>
            <div>
              <dt>Подтверждено</dt>
              <dd>
                {p.results.length} из {t.matches_total} поединков
              </dd>
            </div>
            <div>
              <dt>Сформирован</dt>
              <dd>{formatDateTime(p.generatedAt)}</dd>
            </div>
          </dl>
        </header>

        {anyDemo && <p className={styles.demo}>Часть поединков проведена по демонстрационным правилам: такие результаты не являются официальными.</p>}

        {p.results.length ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>№</th>
                <th>Красный угол</th>
                <th>Синий угол</th>
                <th className={styles.num}>Счёт</th>
                <th>Победитель · способ</th>
                <th>Подтвердил</th>
              </tr>
            </thead>
            <tbody>
              {p.results.map((r) => {
                const red = side(r, "red");
                const blue = side(r, "blue");
                return (
                  <tr key={r.id}>
                    <td className={styles.num}>{r.match_number}</td>
                    {[red, blue].map((x, i) => (
                      <td key={i} className={r.winner_side === (i ? "blue" : "red") ? styles.winner : undefined}>
                        <strong>{who(x)}</strong>
                        <span className={styles.sub}>{team(x) || "—"}</span>
                      </td>
                    ))}
                    <td className={`${styles.num} ${styles.score}`}>{r.score ? `${r.score.red} : ${r.score.blue}` : "—"}</td>
                    <td>
                      <strong>{r.winner_side ? who(side(r, r.winner_side)) : "Без победителя"}</strong>
                      <span className={styles.sub}>
                        {r.outcome} · {r.discipline}, {r.rule_profile} v{r.version_number}
                        {r.is_demo ? " (демо)" : ""}
                      </span>
                    </td>
                    <td>
                      {r.confirmed_by}
                      <span className={styles.sub}>{formatDateTime(r.confirmed_at)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className={styles.empty}>Подтверждённых результатов пока нет. Результат появляется здесь после подтверждения главным судьёй.</p>
        )}

        <footer className={styles.signatures}>
          <div>
            <span />
            Главный судья соревнований
          </div>
          <div>
            <span />
            Организатор
          </div>
        </footer>
        <p className={styles.note}>
          Сформировано FightScore из подтверждённых результатов. Подтверждённый результат нельзя изменить: протокол совпадает с журналом поединков.
        </p>
      </article>
    </div>
  );
}
