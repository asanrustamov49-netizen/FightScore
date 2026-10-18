import type { CSSProperties, ReactNode } from "react";
import { Empty } from "@/src/components/ui/Notice/Notice";
import { describeEvent, roleLabel } from "@/src/lib/events";
import type { MatchEvent, RuleDefinition } from "@/src/lib/types";
import styles from "./EventLog.module.scss";

interface Props {
  events: MatchEvent[];
  definition: RuleDefinition | null | undefined;
  height?: number;
  action?: (e: MatchEvent) => ReactNode;
}

/** Confirmed events, newest first. Voided events stay visible, struck through (PROJECT_SPEC §11). */
export function EventLog({ events, definition, height, action }: Props) {
  if (!events.length) return <Empty title="Событий пока нет">Журнал заполняется по мере судейства: каждое подтверждённое действие записывается сюда.</Empty>;
  return (
    <ol className={styles.list} style={height ? ({ "--log-height": `${height}px` } as CSSProperties) : undefined} aria-label="Журнал событий">
      {events.map((e) => {
        const side = (e.payload as { side?: string }).side;
        const cls = [styles.item, e.voided && styles.voided, e.corrects_event_id && styles.correction, side === "red" && styles.red, side === "blue" && styles.blue]
          .filter(Boolean)
          .join(" ");
        return (
          <li key={e.id} className={cls}>
            <span className={styles.seq}>#{e.seq}</span>
            <span className={styles.text}>
              {describeEvent(e, definition)}
              {e.voided && " (отменено)"}
            </span>
            <span>{action?.(e)}</span>
            <span className={styles.meta}>
              {new Date(e.server_time).toLocaleTimeString("ru-RU")} · {roleLabel(e.actor_role)}
              {e.actor_name ? ` ${e.actor_name}` : ""}
              {e.reason ? ` · причина: ${e.reason}` : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
