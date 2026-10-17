"use client";

import { Badge, DemoBadge } from "@/src/components/ui/Badge/Badge";
import { Card } from "@/src/components/ui/Card/Card";
import { Empty, ErrorState, Loading, Notice } from "@/src/components/ui/Notice/Notice";
import { BulletList, PageHeader, Stack } from "@/src/components/ui/PageHeader/PageHeader";
import { formatDate } from "@/src/lib/format";
import type { RuleVersion } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";

const ACTION_LABEL: Record<string, string> = {
  score: "баллы",
  penalty: "нарушения",
  timer: "таймер",
  period: "периоды",
  correct: "исправления",
  end: "завершение",
  confirm: "подтверждение результата",
};

const STATUS: Record<RuleVersion["status"], string> = { draft: "Черновик", approved: "Утверждена", archived: "В архиве" };

/** Read-only in the MVP: versions are created by migrations/seed; editing and approval UI are a later stage. */
export function RulesPage() {
  const list = useResource<RuleVersion[]>("/rule-versions");
  return (
    <>
      <PageHeader
        eyebrow="Регламенты"
        title="Профили правил"
        description="Поединок привязан к неизменяемой версии профиля. Новая редакция правил не меняет уже созданные поединки."
      />
      <Stack>
        <Notice tone="warning">
          Официальные регламенты пока не загружены. Доступны только демонстрационные профили: их значения условны и не основаны на правилах федераций.
        </Notice>
        {list.loading ? (
          <Loading />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data?.length ? (
          <Empty title="Профилей правил нет" />
        ) : (
          list.data.map((v) => (
            <Card
              key={v.id}
              title={
                <>
                  {v.profile_name} · версия {v.version_number} {v.is_demo && <DemoBadge />}
                </>
              }
              subtitle={`${v.discipline_name} · движок ${v.engine}@${v.engine_version} · действует с ${formatDate(v.effective_from)}`}
              actions={<Badge tone={v.status === "approved" ? "success" : "neutral"}>{STATUS[v.status]}</Badge>}
            >
              <BulletList>
                <li>
                  Источник: {v.source_title ? `${v.source_title}, ${v.source_edition}` : "нет (демонстрационный профиль)"}
                </li>
                <li>
                  Периоды: {v.definition.periods.count} × {v.definition.periods.durationSec} с
                </li>
                <li>Начисления: {v.definition.scoring.map((s) => `${s.label} (${s.points})`).join(", ")}</li>
                <li>
                  Нарушения:{" "}
                  {v.definition.penalties.map((p) => `${p.label}${p.opponentPoints ? ` (+${p.opponentPoints} сопернику)` : ""}`).join(", ") || "нет"}
                </li>
                <li>Способы завершения: {v.definition.endMethods.map((e) => e.label).join(", ")}</li>
                <li>Главный судья: {v.definition.roles.chief_judge.map((a) => ACTION_LABEL[a]).join(", ")}</li>
                <li>Судья: {v.definition.roles.judge.map((a) => ACTION_LABEL[a]).join(", ") || "только просмотр"}</li>
                <li>Корректировка времени: до {v.definition.timeAdjust.maxSec} с</li>
                {v.change_summary && <li>Примечание: {v.change_summary}</li>}
              </BulletList>
            </Card>
          ))
        )}
      </Stack>
    </>
  );
}
