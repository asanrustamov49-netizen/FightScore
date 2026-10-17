import type { MatchStatus, Side } from "./types";

export const STATUS_LABEL: Record<MatchStatus, string> = {
  prepared: "Подготовка",
  ready: "Готов к старту",
  live: "Идёт",
  awaiting_confirmation: "Ждёт подтверждения",
  completed: "Завершён",
  cancelled: "Отменён",
};

export const TOURNAMENT_STATUS_LABEL = {
  draft: "Черновик",
  scheduled: "Запланирован",
  active: "Идёт",
  completed: "Завершён",
} as const;

export const SIDE_LABEL: Record<Side, string> = { red: "Красный угол", blue: "Синий угол" };

/** mm:ss, or m:ss.t under 10 seconds for precision at the end of a period. */
export function formatClock(ms: number): string {
  const safe = Math.max(0, ms);
  const totalSec = Math.ceil(safe / 1000);
  if (safe > 0 && safe < 10_000) {
    const tenths = Math.ceil(safe / 100) / 10;
    return `0:${tenths.toFixed(1).padStart(4, "0")}`;
  }
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" });
}

export function personName(p: { first_name: string; last_name: string } | null | undefined): string {
  return p ? `${p.last_name} ${p.first_name}` : "—";
}
