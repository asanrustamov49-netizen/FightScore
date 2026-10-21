"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { MatchStatusBadge } from "@/src/components/ui/Badge/Badge";
import { Button } from "@/src/components/ui/Button/Button";
import type { Bracket, BracketMatch, Side } from "@/src/lib/types";
import styles from "./BracketView.module.scss";

function roundTitle(round: number, rounds: number): string {
  const left = rounds - round;
  if (left === 0) return "Финал";
  if (left === 1) return "Полуфинал";
  if (left === 2) return "Четвертьфинал";
  return `1/${2 ** left} финала`;
}

/** Who went through from this match, if decided: confirmed winner or walkover. */
const advanced = (m: BracketMatch): Side | null => m.advanced_side ?? m.winner_side;

/** A walkover is possible after a cancellation or a result without a winner, once. */
export const needsWalkover = (m: BracketMatch) => !m.advanced_side && (m.status === "cancelled" || (m.status === "completed" && !m.winner_side));

/**
 * Single-elimination bracket: one column per round, every position from the server. Missing first-round positions
 * are byes. Each match card opens the match; the walkover buttons are separate actions above the card link.
 */
export function BracketView({
  bracket,
  canManage,
  busy,
  onWalkover,
}: {
  bracket: Bracket;
  canManage: boolean;
  busy: boolean;
  onWalkover: (matchId: string, side: Side) => void;
}) {
  const rounds = Math.log2(bracket.size);
  const columns = Array.from({ length: rounds }, (_, i) => {
    const round = i + 1;
    const count = bracket.size / 2 ** round;
    return Array.from({ length: count }, (_, slot) => bracket.matches.find((m) => m.round === round && m.slot === slot) ?? null);
  });
  const final = columns[rounds - 1]?.[0];
  const champion = final && advanced(final) ? final.sides?.[advanced(final)!] : null;

  return (
    <div className={styles.wrap}>
      {champion && (
        <div className={styles.champion}>
          <span>Победитель сетки</span>
          <strong>
            {champion.last_name} {champion.first_name}
          </strong>
        </div>
      )}
      <div className={styles.scroller} role="region" aria-label={`Сетка: ${bracket.discipline_name}`} tabIndex={0}>
        <div className={styles.grid} style={{ "--rounds": rounds } as CSSProperties}>
          {columns.map((col, i) => (
            <section key={i} className={styles.round} aria-label={roundTitle(i + 1, rounds)}>
              <h3 className={styles.roundTitle}>{roundTitle(i + 1, rounds)}</h3>
              <ol className={styles.slots}>
                {col.map((m, slot) => (
                  <li key={slot} className={styles.slot}>
                    {m ? <MatchCard match={m} canManage={canManage} busy={busy} onWalkover={onWalkover} /> : <div className={styles.bye}>Проход без боя</div>}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function MatchCard({
  match: m,
  canManage,
  busy,
  onWalkover,
}: {
  match: BracketMatch;
  canManage: boolean;
  busy: boolean;
  onWalkover: (matchId: string, side: Side) => void;
}) {
  const through = advanced(m);
  const played = m.status !== "prepared" && m.status !== "ready";
  const row = (side: Side) => {
    const p = m.sides?.[side];
    return (
      <div className={`${styles.side} ${styles[side]} ${through === side ? styles.won : through ? styles.lost : ""}`}>
        <span className={styles.name}>{p ? `${p.last_name} ${p.first_name}` : <em>ждёт победителя</em>}</span>
        {played && <span className={styles.score}>{m.score[side]}</span>}
      </div>
    );
  };
  return (
    <article className={`${styles.card} ${m.status === "live" ? styles.live : ""}`}>
      <Link href={`/matches/${m.id}`} className={styles.cardLink} aria-label={`Поединок №${m.match_number}`}>
        <span className={styles.cardHead}>
          №{m.match_number}
          <MatchStatusBadge status={m.status} />
        </span>
      </Link>
      {row("red")}
      {row("blue")}
      {m.advanced_side && !m.winner_side && <span className={styles.note}>Проход назначен организатором</span>}
      {canManage && needsWalkover(m) && (
        <div className={styles.walkover}>
          <span>Кто проходит дальше?</span>
          {(["red", "blue"] as const).map(
            (side) =>
              m.sides?.[side] && (
                <Button key={side} size="sm" variant={side === "red" ? "red" : "blue"} disabled={busy} onClick={() => onWalkover(m.id, side)}>
                  {m.sides[side]!.last_name}
                </Button>
              ),
          )}
        </div>
      )}
    </article>
  );
}
