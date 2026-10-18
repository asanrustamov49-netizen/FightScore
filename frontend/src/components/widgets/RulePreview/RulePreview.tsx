import { formatClock } from "@/src/lib/format";
import type { RuleDefinition } from "@/src/lib/types";
import { ACTION_LABEL } from "../RuleDefinitionEditor/RuleDefinitionEditor";
import styles from "./RulePreview.module.scss";

/** How a profile looks in use: the clock, the judge buttons and who may do what. Read-only. */
export function RulePreview({ definition: d }: { definition: RuleDefinition }) {
  const validDuration = Number.isInteger(d.periods.durationSec) && d.periods.durationSec > 0;
  return (
    <div className={styles.preview}>
      <div className={styles.clock}>
        <span className={styles.clockValue}>{validDuration ? formatClock(d.periods.durationSec * 1000) : "—"}</span>
        <span className={styles.clockLabel}>
          {Number.isInteger(d.periods.count) ? `${d.periods.count} × период` : "периоды не заданы"} · корректировка до {Number.isNaN(d.timeAdjust.maxSec) ? "—" : d.timeAdjust.maxSec} с
        </span>
      </div>

      <div className={styles.block}>
        <span className={styles.label}>Кнопки начисления</span>
        <div className={styles.sides}>
          {(["red", "blue"] as const).map((side) => (
            <div key={side} className={`${styles.side} ${styles[side]}`}>
              {d.scoring.map((s) => (
                <span key={s.code} className={styles.chip}>
                  {s.label || "?"}
                  <small>{Number.isNaN(s.points) ? "" : `+${s.points}`}</small>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.label}>Нарушения</span>
        {d.penalties.length ? (
          <ul className={styles.list}>
            {d.penalties.map((p) => (
              <li key={p.code}>
                {p.label || "?"}
                <span>
                  {p.opponentPoints ? `+${p.opponentPoints} сопернику` : "без баллов"}
                  {p.public ? " · на табло" : " · скрыто"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>Не используются</p>
        )}
      </div>

      <div className={styles.block}>
        <span className={styles.label}>Завершение</span>
        <ul className={styles.list}>
          {d.endMethods.map((e) => (
            <li key={e.code}>
              {e.label || "?"}
              <span>{e.requiresWinner ? "с победителем" : "без победителя"}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.block}>
        <span className={styles.label}>Полномочия</span>
        <p className={styles.roles}>
          <strong>Главный судья:</strong> {d.roles.chief_judge.map((a) => ACTION_LABEL[a].toLowerCase()).join(", ") || "нет"}
        </p>
        <p className={styles.roles}>
          <strong>Судья:</strong> {d.roles.judge.map((a) => ACTION_LABEL[a].toLowerCase()).join(", ") || "только просмотр"}
        </p>
      </div>
    </div>
  );
}
