import type { ReactNode } from "react";
import { STATUS_LABEL } from "@/src/lib/format";
import type { MatchStatus } from "@/src/lib/types";
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
