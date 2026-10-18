import type { ReactNode } from "react";
import { STATUS_LABEL, TOURNAMENT_STATUS_LABEL } from "@/src/lib/format";
import type { MatchStatus, TournamentSummary } from "@/src/lib/types";
import styles from "./Badge.module.scss";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "live" | "demo";

export function Badge({ tone = "neutral", children, title }: { tone?: BadgeTone; children: ReactNode; title?: string }) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`} title={title}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<MatchStatus, BadgeTone> = {
  prepared: "neutral",
  ready: "info",
  live: "live",
  awaiting_confirmation: "warning",
  completed: "success",
  cancelled: "danger",
};

export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

/** Marks rule profiles and data that are not an official regulation (PROJECT_SPEC §10). */
export function DemoBadge() {
  return (
    <Badge tone="demo" title="Демонстрационный профиль правил, не официальный регламент">
      Демо-правила
    </Badge>
  );
}

const TOURNAMENT_TONE: Record<TournamentSummary["status"], BadgeTone> = { draft: "neutral", scheduled: "info", active: "success", completed: "neutral" };

export function TournamentStatusBadge({ status, archived }: { status: TournamentSummary["status"]; archived?: boolean }) {
  if (archived) return <Badge>В архиве</Badge>;
  return <Badge tone={TOURNAMENT_TONE[status]}>{TOURNAMENT_STATUS_LABEL[status]}</Badge>;
}

/** Official regulation (approved with a source) vs. a non-official demo/custom profile. */
export function RuleKindBadge({ demo }: { demo: boolean }) {
  return demo ? (
    <Badge tone="demo" title="Не официальный регламент: демонстрационный или собственный профиль">
      Неофициальный
    </Badge>
  ) : (
    <Badge tone="success" title="Официальный регламент с указанным источником">
      Официальный
    </Badge>
  );
}
