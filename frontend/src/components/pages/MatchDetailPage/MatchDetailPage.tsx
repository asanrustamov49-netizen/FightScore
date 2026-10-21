"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { DemoBadge, MatchStatusBadge } from "@/src/components/ui/Badge/Badge";
import { Button, ButtonLink } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { ConfirmDialog, DialogText } from "@/src/components/ui/Dialog/Dialog";
import { Flag } from "@/src/components/ui/Flag/Flag";
import { Field, Input } from "@/src/components/ui/Form/Form";
import { ErrorState, Loading, Notice, PageSkeleton } from "@/src/components/ui/Notice/Notice";
import { Columns, MetaItem, PageHeader, Stack } from "@/src/components/ui/PageHeader/PageHeader";
import { EventLog } from "@/src/components/widgets/EventLog/EventLog";
import { MatchSetupForm } from "@/src/components/widgets/MatchSetupForm/MatchSetupForm";
import { OfficialsEditor } from "@/src/components/widgets/OfficialsEditor/OfficialsEditor";
import { api, errorText } from "@/src/lib/api";
import { formatClock, formatDateTime, personName, SIDE_LABEL } from "@/src/lib/format";
import type { MatchEvent, MatchSnapshot, RuleVersion, Side, TournamentDetail } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";
import styles from "./MatchDetailPage.module.scss";

export function MatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const match = useResource<MatchSnapshot>(`/matches/${id}`);
  const events = useResource<MatchEvent[]>(`/matches/${id}/events`);
  // The server refuses changes in an archived tournament, and line-up/judge changes in a completed one;
  // the page offers only what will be accepted.
  const canManage = !!match.data?.viewer?.canManage && !match.data?.tournament.archived;
  const lineupOpen = canManage && match.data?.tournament.status !== "completed";
  const inBracket = !!match.data?.bracket;
  const prepared = match.data?.status === "prepared";
  const tour = useResource<TournamentDetail>(lineupOpen && !inBracket && prepared ? `/tournaments/${match.data!.tournament.id}` : null);
  const rules = useResource<RuleVersion[]>(lineupOpen && !inBracket && prepared ? "/rule-versions" : null);
  const officials = useResource<{ id: string; login: string; display_name: string }[]>(
    lineupOpen && (prepared || match.data?.status === "ready") ? `/tournaments/${match.data!.tournament.id}/officials` : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  if (match.loading) return <PageSkeleton cards={2} />;
  if (match.error || !match.data) return <ErrorState message={match.error ?? "Поединок не найден"} onRetry={match.reload} />;
  const m = match.data;
  const def = m.rules?.definition;

  async function command(cmd: object) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/matches/${id}/commands`, { commandId: crypto.randomUUID(), expectedVersion: m.version, command: cmd });
      await Promise.all([match.reload(), events.reload()]);
      return true;
    } catch (e) {
      setError(errorText(e));
      await match.reload();
      return false;
    } finally {
      setBusy(false);
    }
  }

  const corner = (side: Side) => {
    const p = m.participants[side];
    const won = m.status === "completed" && m.result?.winner_side === side;
    return (
      <div className={`${styles.corner} ${styles[side]} ${won ? styles.won : ""}`}>
        <span className={styles.cornerLabel}>
          {SIDE_LABEL[side]}
          {won && <span className={styles.winBadge}>Победитель</span>}
        </span>
        <strong className={styles.cornerName}>{p ? personName(p) : <span className={styles.unset}>Не назначен</span>}</strong>
        <span className={styles.cornerMeta}>
          {p && <Flag code={p.country_code} name={p.country_name} showName />}
          {p?.club_name && <span>{p.club_name}</span>}
        </span>
        <span className={styles.cornerScore} aria-label={`Баллы: ${m.state.score[side]}`}>
          {m.state.score[side]}
        </span>
      </div>
    );
  };
  const end = def?.endMethods.find((e) => e.code === m.result?.outcome_code);
  const canJudge = !!m.viewer?.official && ["ready", "live", "awaiting_confirmation"].includes(m.status);

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Турниры", href: "/tournaments" },
          { label: m.tournament.name, href: `/tournaments/${m.tournament.id}?tab=matches` },
        ]}
        title={
          <>
            Поединок №{m.matchNumber} <MatchStatusBadge status={m.status} />
            {m.rules?.isDemo && <DemoBadge />}
          </>
        }
        meta={
          <>
            <MetaItem icon="versus">{m.discipline.name}</MetaItem>
            <MetaItem icon="book">{m.rules ? `${m.rules.profileName}, версия правил ${m.rules.versionNumber}` : "Правила не выбраны"}</MetaItem>
          </>
        }
        actions={
          <>
            {canJudge && (
              <ButtonLink href={`/judge/${m.id}`} variant="primary">
                Судейская панель
              </ButtonLink>
            )}
            {canManage && m.status === "prepared" && (
              <Button variant="primary" loading={busy} onClick={() => command({ type: "match.ready" })}>
                Готов к старту
              </Button>
            )}
            {canManage && !["completed", "cancelled"].includes(m.status) && !(m.bracket && !(m.participants.red && m.participants.blue)) && (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                Отменить поединок
              </Button>
            )}
          </>
        }
      />
      <Stack>
        {error && <Notice tone="error">{error}</Notice>}
        {m.status === "cancelled" && <Notice tone="warning">Поединок отменён. Причина: {m.cancelReason}</Notice>}
        {m.tournament.archived && <Notice tone="info">Турнир в архиве: поединок доступен только для просмотра.</Notice>}
        {!m.tournament.archived && m.viewer?.canManage && m.tournament.status === "completed" && !["completed", "cancelled"].includes(m.status) && (
          <Notice tone="info" title="Турнир завершён">
            Состав и судей этого поединка менять нельзя. Чтобы продолжить подготовку, верните турниру статус «Идёт» на его странице.
          </Notice>
        )}
        {m.bracket && (
          <Notice tone="info" title={`Поединок сетки · круг ${m.bracket.round}`}>
            Пары задаёт сетка, поэтому состав здесь не меняется. Победитель перейдёт в следующий круг автоматически после подтверждения результата.
            {m.bracket.advancedSide && !m.result?.winner_side && " Проход в следующий круг назначен организатором."}{" "}
            <Link href={`/tournaments/${m.tournament.id}?tab=bracket`}>Открыть сетку</Link>
          </Notice>
        )}
        {lineupOpen && m.status === "prepared" && (
          <Notice tone="info" title="Подготовка поединка">
            {inBracket
              ? "Назначьте главного судью, затем нажмите «Готов к старту»: спортсмены появятся здесь, когда пройдут предыдущий круг."
              : "Выберите спортсменов и версию правил, назначьте главного судью, затем нажмите «Готов к старту». После этого состав и правила фиксируются."}
          </Notice>
        )}
        {m.status === "completed" && m.result && (
          <Notice tone="success">
            Результат подтверждён {formatDateTime(m.result.confirmed_at)} ({m.result.confirmed_by}):{" "}
            {m.result.winner_side ? `победитель — ${personName(m.participants[m.result.winner_side])}` : "без победителя"},{" "}
            {end?.label ?? m.result.outcome_code}.
          </Notice>
        )}
        <Columns>
          <Stack>
            <section className={styles.versus} aria-label="Участники и счёт">
              {corner("red")}
              <span className={styles.vs} aria-hidden>
                VS
              </span>
              {corner("blue")}
            </section>
            {lineupOpen && !inBracket && prepared && tour.data && rules.data && (
              <Card title="Состав и правила" subtitle="Менять можно, пока поединок не отмечен как готовый к старту">
                <MatchSetupForm
                  disciplines={tour.data.disciplines}
                  entries={tour.data.athletes}
                  ruleVersions={rules.data}
                  initial={{
                    disciplineId: m.discipline.id,
                    redEntryId: m.participants.red?.entry_id ?? null,
                    blueEntryId: m.participants.blue?.entry_id ?? null,
                    ruleVersionId: m.rules?.versionId ?? null,
                  }}
                  submitLabel="Сохранить состав"
                  onSubmit={async (v) => {
                    await api.put(`/matches/${id}/setup`, v);
                    await match.reload();
                  }}
                />
              </Card>
            )}
            {lineupOpen && officials.data && (
              <Card title="Судьи" subtitle="Права судей определяются выбранным профилем правил">
                <OfficialsEditor
                  candidates={officials.data}
                  current={m.officials}
                  onSave={async (list) => {
                    await api.put(`/matches/${id}/officials`, { officials: list });
                    await match.reload();
                  }}
                />
              </Card>
            )}
          </Stack>
          <Stack>
            <Card title="Состояние">
              <dl className={styles.facts}>
                <dt>Период</dt>
                <dd>{m.state.periodIndex ? `${m.state.periodIndex} из ${def?.periods.count ?? "?"}` : "—"}</dd>
                <dt>Время</dt>
                <dd>
                  {formatClock(m.clock.remainingMs)}
                  {m.clock.running ? " (идёт)" : ""}
                </dd>
                <dt title="Счётчик подтверждённых изменений состояния, нужен для синхронизации экранов. Не связан с версией правил">Изменений состояния</dt>
                <dd>{m.version}</dd>
                <dt>Судьи</dt>
                <dd>
                  {m.officials.length
                    ? m.officials.map((o) => `${o.display_name}${o.official_role === "chief_judge" ? " (гл.)" : ""}`).join(", ")
                    : "не назначены"}
                </dd>
              </dl>
            </Card>
            <Card
              title="Журнал событий"
              flush
              actions={
                <Button size="sm" variant="ghost" onClick={events.reload}>
                  Обновить
                </Button>
              }
            >
              {events.data ? <EventLog events={events.data} definition={def} /> : <Loading />}
            </Card>
          </Stack>
        </Columns>
      </Stack>
      <ConfirmDialog
        open={cancelOpen}
        title="Отменить поединок?"
        confirmLabel="Отменить поединок"
        confirmVariant="danger"
        confirmDisabled={cancelReason.trim().length < 3}
        busy={busy}
        onClose={() => setCancelOpen(false)}
        onConfirm={async () => {
          if (await command({ type: "match.cancel", reason: cancelReason.trim() })) setCancelOpen(false);
        }}
      >
        <DialogText>Отмена фиксируется в журнале и не может быть снята.</DialogText>
        <Field label="Причина">{(fid) => <Input id={fid} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={300} />}</Field>
      </ConfirmDialog>
    </>
  );
}
