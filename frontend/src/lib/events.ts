import { formatClock, SIDE_LABEL } from "./format";
import type { MatchEvent, RuleDefinition, Side } from "./types";

const ROLE_LABEL: Record<string, string> = {
  chief_judge: "Главный судья",
  judge: "Судья",
  organizer: "Организатор",
  system: "Система",
};

export const roleLabel = (r: string) => ROLE_LABEL[r] ?? r;

/** Human-readable description of a logged event, using labels from the match's rule version. */
export function describeEvent(e: MatchEvent, def: RuleDefinition | null | undefined): string {
  const p = e.payload as Record<string, unknown>;
  const side = p.side ? SIDE_LABEL[p.side as Side] : "";
  const scoring = def?.scoring.find((s) => s.code === p.code);
  const penalty = def?.penalties.find((s) => s.code === p.code);
  switch (e.type) {
    case "match.ready":
      return "Поединок готов к старту";
    case "match.cancel":
      return "Поединок отменён";
    case "match.start":
      return "Поединок начат";
    case "timer.start":
      return "Таймер запущен";
    case "timer.stop":
      return `Таймер остановлен на ${formatClock(Number(p.remainingMs ?? 0))}`;
    case "timer.expire":
      return "Время периода истекло";
    case "timer.set":
      return `Время установлено: ${formatClock(Number(p.remainingMs ?? 0))}`;
    case "period.next":
      return "Следующий период";
    case "score.add":
      return `${side}: ${scoring?.label ?? p.code}`;
    case "score.subtract":
      return `${side}: снятие ${scoring ? `${scoring.points} б.` : p.code}`;
    case "penalty.add":
      return `${side}: ${penalty?.label ?? p.code}`;
    case "event.void":
      return "Исправление: действие отменено";
    case "match.end": {
      const end = def?.endMethods.find((m) => m.code === p.outcomeCode);
      return `Завершение: ${end?.label ?? p.outcomeCode}${p.winnerSide ? `, победитель — ${SIDE_LABEL[p.winnerSide as Side].toLowerCase()}` : ""}`;
    }
    case "match.resume":
      return "Завершение отклонено, поединок продолжен";
    case "result.confirm":
      return "Результат подтверждён";
    default:
      return e.type;
  }
}
