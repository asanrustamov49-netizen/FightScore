"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, DemoBadge, MatchStatusBadge } from "@/src/components/ui/Badge/Badge";
import { PublicFrame } from "@/src/components/layout/PublicFrame/PublicFrame";
import { Button, ButtonLink } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { ConnectionIndicator } from "@/src/components/ui/Connection/Connection";
import { ConfirmDialog, DialogText } from "@/src/components/ui/Dialog/Dialog";
import { Flag } from "@/src/components/ui/Flag/Flag";
import { Icon } from "@/src/components/ui/Icon/Icon";
import { Checkbox, Field, FormActions, Input, Select } from "@/src/components/ui/Form/Form";
import { Loading, Notice } from "@/src/components/ui/Notice/Notice";
import { EventLog } from "@/src/components/widgets/EventLog/EventLog";
import { api } from "@/src/lib/api";
import { describeEvent } from "@/src/lib/events";
import { formatClock, personName, SIDE_LABEL } from "@/src/lib/format";
import { useCountdown, useMatchChannel } from "@/src/lib/realtime";
import type { MatchEvent, OfficialAction, Side } from "@/src/lib/types";
import styles from "./JudgePanelPage.module.scss";

type Dialog =
  | { kind: "penalty"; side: Side; code: string }
  | { kind: "end" }
  | { kind: "dq"; side: Side }
  | { kind: "confirm" }
  | { kind: "time" }
  | { kind: "void"; event: MatchEvent }
  | { kind: "nextPeriod" }
  | null;

const VOIDABLE = new Set(["score.add", "score.subtract", "penalty.add"]);
const OTHER: Record<Side, Side> = { red: "blue", blue: "red" };

/** The profile's disqualification end method, if it has one: code "dq" or a label that says so. Never invented here. */
function dqMethod(methods: { code: string; label: string; requiresWinner: boolean }[] | undefined) {
  return methods?.find((m) => m.requiresWinner && (m.code === "dq" || /дисквал/i.test(m.label)));
}

export function JudgePanelPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const { snapshot: s, status, error: linkError, offset, pending, send } = useMatchChannel(matchId);
  const remaining = useCountdown(s?.clock, s?.serverTime, offset);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState("");
  const [endCode, setEndCode] = useState("");
  const [winner, setWinner] = useState<Side | "">("");
  const [timeInput, setTimeInput] = useState("");
  const [checked, setChecked] = useState(false);
  // Last send time per identical command: a second tap within 350 ms is an accident on a touch screen.
  const lastSent = useRef(new Map<string, number>());
  const tooSoon = useCallback((key: string) => {
    const now = Date.now();
    if (now - (lastSent.current.get(key) ?? 0) < 350) return true;
    lastSent.current.set(key, now);
    return false;
  }, []);

  // Reload the log whenever the confirmed version changes.
  useEffect(() => {
    if (!s) return;
    api.get<MatchEvent[]>(`/matches/${matchId}/events`).then(setEvents).catch(() => undefined);
  }, [matchId, s?.version, s]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(t);
  }, [message]);

  if (!s) {
    if (!linkError) return <Loading label="Подключение к поединку…" />;
    return (
      <PublicFrame icon="lock" photo="/auth/octagon-ref.webp" title="Поединок недоступен" lead={linkError}>
        <Notice tone="info">
          Судейская панель открывается только назначенным судьям и организатору турнира. Проверьте, что вы вошли под своей учётной записью,
          или попросите организатора назначить вас на этот поединок.
        </Notice>
        <FormActions>
          <ButtonLink href="/judge" variant="primary">
            Мои поединки
          </ButtonLink>
        </FormActions>
      </PublicFrame>
    );
  }

  const def = s.rules?.definition;
  const actions: OfficialAction[] = s.viewer?.official?.actions ?? [];
  const online = status === "online";
  const allowed = (a: OfficialAction) => online && actions.includes(a);
  const live = s.status === "live";
  const running = s.clock.running;

  const isTimerCommand = (type: string) => type === "match.start" || type.startsWith("timer.");
  const timerBusy = pending.some((p) => isTimerCommand(p.type));

  async function exec(command: { type: string } & Record<string, unknown>, ok?: string) {
    // The clock has one state: while a start/stop is on its way, a second tap would only be rejected as invalid.
    if (isTimerCommand(command.type) && timerBusy) return false;
    if (tooSoon(JSON.stringify(command))) return false;
    const res = await send(command);
    if (!res.ok) setMessage({ tone: "error", text: res.error?.message ?? "Команда отклонена" });
    else if (ok) setMessage({ tone: "success", text: ok });
    return res.ok;
  }

  const close = () => {
    setDialog(null);
    setReason("");
    setChecked(false);
  };

  const dq = dqMethod(def?.endMethods);

  // Corner disqualified by the pending or confirmed result (the board shows it with 0 points).
  const outcome =
    s.status === "completed" && s.result
      ? { code: s.result.outcome_code, winner: s.result.winner_side }
      : s.state.pendingResult && { code: s.state.pendingResult.outcomeCode, winner: s.state.pendingResult.winnerSide };
  const outcomeMethod = outcome && def?.endMethods.find((m) => m.code === outcome.code);
  const disqualified: Side | null = outcomeMethod && dqMethod([outcomeMethod]) && outcome.winner ? OTHER[outcome.winner] : null;

  const sidePanel = (side: Side) => {
    const p = s.participants[side];
    const pens = def?.penalties.filter((d) => (s.state.penalties[side][d.code] ?? 0) > 0) ?? [];
    return (
      <section className={`${styles.side} ${styles[side]}`} aria-label={SIDE_LABEL[side]}>
        <div className={styles.sideHead}>
          <div>
            <div className={styles.corner}>{SIDE_LABEL[side]}</div>
            <div className={styles.athlete}>{p ? personName(p) : "—"}</div>
            <div className={styles.club}>
              {p && <Flag code={p.country_code} name={p.country_name} />} {p?.club_name}
            </div>
          </div>
          <div className={styles.score} key={s.state.score[side]} aria-label={`Счёт: ${s.state.score[side]}`}>
            {s.state.score[side]}
          </div>
        </div>
        <div className={styles.penalties}>
          {disqualified === side && <Badge tone="danger">Дисквалифицирован</Badge>}
          {pens.map((d) => (
            <Badge key={d.code} tone="warning">
              {d.label} × {s.state.penalties[side][d.code]}
            </Badge>
          ))}
        </div>
        {def && (
          <>
            <div className={styles.group}>
              <span className={styles.groupLabel}>Начислить</span>
              <div className={styles.buttons}>
                {def.scoring.map((a) => (
                  <Button key={a.code} variant={side} className={styles.bigButton} disabled={!live || !allowed("score")} onClick={() => exec({ type: "score.add", side, code: a.code })}>
                    {a.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className={styles.group}>
              <div className={styles.groupHead}>
                <span className={styles.groupLabel}>Снять</span>
                <Button
                  size="sm"
                  variant="danger"
                  className={styles.dqButton}
                  disabled={!live || !allowed("end") || !dq}
                  title={!dq ? "В профиле правил нет способа завершения «Дисквалификация»" : !actions.includes("end") ? "Дисквалифицирует главный судья" : undefined}
                  onClick={() => setDialog({ kind: "dq", side })}
                >
                  <Icon name="close" size={15} />
                  Дисквалификация
                </Button>
              </div>
              <div className={styles.buttons}>
                {def.scoring.map((a) => (
                  <Button
                    key={a.code}
                    size="sm"
                    disabled={!live || !allowed("score") || s.state.score[side] < a.points}
                    onClick={() => exec({ type: "score.subtract", side, code: a.code })}
                  >
                    −{a.points}
                  </Button>
                ))}
              </div>
            </div>
            {def.penalties.length > 0 && (
              <div className={styles.group}>
                <span className={styles.groupLabel}>Нарушения</span>
                <div className={`${styles.buttons} ${styles.buttonsWide}`}>
                  {def.penalties.map((pen) => (
                    <Button key={pen.code} size="sm" className={styles.wrapButton} disabled={!live || !allowed("penalty")} onClick={() => setDialog({ kind: "penalty", side, code: pen.code })}>
                      {pen.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    );
  };

  const penaltyDef = dialog?.kind === "penalty" ? def?.penalties.find((p) => p.code === dialog.code) : undefined;
  const endMethod = def?.endMethods.find((m) => m.code === endCode);
  // One clear word for the state of the bout, next to the clock.
  const phase: { label: string; tone: "idle" | "run" | "pause" | "zero" | "await" | "done" } =
    s.status === "completed"
      ? { label: "Завершён", tone: "done" }
      : s.status === "cancelled"
        ? { label: "Отменён", tone: "done" }
        : s.status === "awaiting_confirmation"
          ? { label: "Ждёт подтверждения", tone: "await" }
          : live
            ? running
              ? { label: "Идёт", tone: "run" }
              : remaining === 0
                ? { label: "Время вышло", tone: "zero" }
                : { label: "Пауза", tone: "pause" }
            : { label: "Не начат", tone: "idle" };
  const resultEnd = def?.endMethods.find((m) => m.code === s.result?.outcome_code);
  const pendingEnd = s.state.pendingResult;
  const pendingEndLabel = def?.endMethods.find((m) => m.code === pendingEnd?.outcomeCode)?.label;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link href={`/matches/${s.id}`} aria-label="К карточке поединка">
          ← Поединок
        </Link>
        <div className={styles.matchInfo}>
          <span className={styles.matchTitle}>
            №{s.matchNumber} · {s.discipline.name}
          </span>
          <span className={styles.matchSub}>
            {s.tournament.name} · {s.viewer?.official ? (s.viewer.official.role === "chief_judge" ? "вы — главный судья" : "вы — судья") : "только просмотр"}
          </span>
        </div>
        <div className={styles.topRight}>
          {s.rules?.isDemo && <DemoBadge />}
          <MatchStatusBadge status={s.status} />
          {pending.length > 0 && <span className={styles.pending}>Ожидает сервера: {pending.length}</span>}
          <ConnectionIndicator status={status} />
        </div>
      </header>
      {!online && (
        <div className={styles.banner}>
          <Notice tone="error">
            Связь с сервером потеряна. Показаны последние подтверждённые данные, ввод заблокирован. Неотправленные действия будут отправлены после
            восстановления связи.
          </Notice>
        </div>
      )}
      {message && (
        <div className={styles.banner}>
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}
      {!s.viewer?.official && (
        <div className={styles.banner}>
          <Notice tone="warning">Вы не назначены судьёй этого поединка: панель доступна только для просмотра.</Notice>
        </div>
      )}
      <main className={styles.body}>
        <div className={styles.arena}>
          <section className={styles.clockPanel} aria-label="Время">
            <span className={`${styles.phase} ${styles[`phase_${phase.tone}`]}`} role="status">
              {phase.label}
            </span>
            <span className={styles.period}>
              {s.state.periodIndex ? `Период ${s.state.periodIndex} из ${def?.periods.count ?? "?"}` : "Поединок не начат"}
            </span>
            <span className={`${styles.clock} ${running ? styles.clockRunning : ""} ${live && remaining === 0 ? styles.clockZero : ""}`} aria-live="off">
              {formatClock(s.status === "ready" ? (def?.periods.durationSec ?? 0) * 1000 : remaining)}
            </span>
            {s.viewer?.official && !actions.includes("timer") && (s.status === "ready" || live) && (
              <p className={styles.clockHint}>Старт и время ведёт главный судья. Кнопки очков активны, пока идёт поединок.</p>
            )}
            <div className={styles.clockControls}>
              {s.status === "ready" && (
                <Button variant="primary" size="lg" disabled={!allowed("timer") || timerBusy} loading={timerBusy} onClick={() => exec({ type: "match.start" }, "Поединок начат")}>
                  Начать поединок
                </Button>
              )}
              {live && (
                <>
                  {running ? (
                    <Button variant="primary" size="lg" disabled={!allowed("timer") || timerBusy} loading={timerBusy} onClick={() => exec({ type: "timer.stop" })}>
                      ❚❚ Пауза
                    </Button>
                  ) : (
                    <Button variant="primary" size="lg" disabled={!allowed("timer") || remaining === 0 || timerBusy} loading={timerBusy} onClick={() => exec({ type: "timer.start" })}>
                      ▶ Старт
                    </Button>
                  )}
                  <Button
                    disabled={!allowed("timer") || running}
                    onClick={() => {
                      setTimeInput(formatClock(remaining));
                      setDialog({ kind: "time" });
                    }}
                  >
                    Изменить время
                  </Button>
                  <Button disabled={!allowed("period") || running || s.state.periodIndex >= (def?.periods.count ?? 0)} onClick={() => setDialog({ kind: "nextPeriod" })}>
                    Следующий период
                  </Button>
                </>
              )}
            </div>
          </section>
          {sidePanel("red")}
          {sidePanel("blue")}
          <section className={styles.endPanel}>
            {s.status === "awaiting_confirmation" && pendingEnd ? (
              <span>
                Ожидает подтверждения: <strong>{pendingEndLabel}</strong>
                {pendingEnd.winnerSide && <>, победитель — {personName(s.participants[pendingEnd.winnerSide])}</>}
              </span>
            ) : s.status === "completed" ? (
              <span>
                Результат подтверждён и сохранён:{" "}
                <strong>{s.result?.winner_side ? `победитель — ${personName(s.participants[s.result.winner_side])}` : "без победителя"}</strong>
                {resultEnd && `, ${resultEnd.label}`}. Счёт {s.state.score.red} : {s.state.score.blue}.
                {s.bracket && s.result?.winner_side && " Победитель переходит в следующий круг сетки."}
              </span>
            ) : (
              <span>Завершение поединка требует подтверждения главного судьи.</span>
            )}
            <div className={styles.endActions}>
              {live && (
                <Button variant="danger" disabled={!allowed("end")} onClick={() => setDialog({ kind: "end" })}>
                  Завершить поединок
                </Button>
              )}
              {s.status === "awaiting_confirmation" && (
                <>
                  <Button disabled={!allowed("end")} onClick={() => exec({ type: "match.resume" }, "Поединок продолжен")}>
                    Вернуться к поединку
                  </Button>
                  <Button variant="primary" disabled={!allowed("confirm")} onClick={() => setDialog({ kind: "confirm" })}>
                    Подтвердить результат
                  </Button>
                </>
              )}
            </div>
          </section>
        </div>
        <Card title="Журнал" flush>
          <EventLog
            events={events}
            definition={def}
            height={640}
            action={(e) =>
              VOIDABLE.has(e.type) && !e.voided && allowed("correct") && (live || s.status === "awaiting_confirmation") ? (
                <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "void", event: e })}>
                  Отменить
                </Button>
              ) : null
            }
          />
        </Card>
      </main>

      <ConfirmDialog
        open={dialog?.kind === "penalty"}
        title={`${penaltyDef?.label ?? "Нарушение"}: ${dialog?.kind === "penalty" ? SIDE_LABEL[dialog.side].toLowerCase() : ""}`}
        confirmLabel="Записать"
        confirmVariant={dialog?.kind === "penalty" ? dialog.side : "primary"}
        onClose={close}
        onConfirm={async () => {
          if (dialog?.kind === "penalty") await exec({ type: "penalty.add", side: dialog.side, code: dialog.code });
          close();
        }}
      >
        <DialogText>
          {dialog?.kind === "penalty" && personName(s.participants[dialog.side])}
          {penaltyDef?.opponentPoints ? `. Сопернику будет начислено ${penaltyDef.opponentPoints} б. по профилю правил.` : "."}
        </DialogText>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "nextPeriod"}
        title={`Перейти к периоду ${s.state.periodIndex + 1}?`}
        confirmLabel="Следующий период"
        onClose={close}
        onConfirm={async () => {
          await exec({ type: "period.next" });
          close();
        }}
      >
        <DialogText>Таймер будет установлен на полную длительность периода из профиля правил.</DialogText>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "time"}
        title="Изменить время"
        confirmLabel="Установить"
        confirmDisabled={reason.trim().length < 3 || !/^\d{1,2}:\d{2}$/.test(timeInput)}
        onClose={close}
        onConfirm={async () => {
          const [mm, ss] = timeInput.split(":").map(Number);
          if (await exec({ type: "timer.set", remainingMs: (mm * 60 + ss) * 1000, reason: reason.trim() }, "Время изменено")) close();
        }}
      >
        <DialogText>Допустимая корректировка по профилю — до {def?.timeAdjust.maxSec ?? 0} с. Изменение фиксируется в журнале.</DialogText>
        <Field label="Оставшееся время (м:сс)">{(id) => <Input id={id} value={timeInput} onChange={(e) => setTimeInput(e.target.value)} inputMode="numeric" />}</Field>
        <Field label="Причина">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "void"}
        title="Отменить действие?"
        confirmLabel="Отменить действие"
        confirmVariant="danger"
        confirmDisabled={reason.trim().length < 3}
        onClose={close}
        onConfirm={async () => {
          if (dialog?.kind === "void" && (await exec({ type: "event.void", eventId: dialog.event.id, reason: reason.trim() }, "Действие отменено"))) close();
        }}
      >
        <DialogText>
          {dialog?.kind === "void" && `#${dialog.event.seq}: ${describeEvent(dialog.event, def)}.`} Исходная запись останется в журнале с пометкой об отмене.
        </DialogText>
        <Field label="Причина">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "dq"}
        title="Дисквалифицировать бойца?"
        confirmLabel="Дисквалифицировать"
        confirmVariant="danger"
        confirmDisabled={!checked}
        onClose={close}
        onConfirm={async () => {
          if (dialog?.kind !== "dq" || !dq) return;
          if (await exec({ type: "match.end", outcomeCode: dq.code, winnerSide: OTHER[dialog.side] })) close();
        }}
      >
        {dialog?.kind === "dq" && (
          <>
            <DialogText>
              {SIDE_LABEL[dialog.side]}: <strong>{personName(s.participants[dialog.side])}</strong> дисквалифицирован. Победа — {SIDE_LABEL[OTHER[dialog.side]].toLowerCase()}:{" "}
              <strong>{personName(s.participants[OTHER[dialog.side]])}</strong> ({dq?.label.toLowerCase()}).
            </DialogText>
            <DialogText>Таймер остановится. Результат вступит в силу после подтверждения главным судьёй и попадёт в журнал.</DialogText>
            <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} label="Я уверен(а): дисквалифицировать этого бойца" />
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "end"}
        title="Завершить поединок"
        confirmLabel="Завершить"
        confirmVariant="danger"
        confirmDisabled={!endMethod || (endMethod.requiresWinner && !winner)}
        onClose={close}
        onConfirm={async () => {
          if (await exec({ type: "match.end", outcomeCode: endCode, winnerSide: endMethod?.requiresWinner ? winner : null })) close();
        }}
      >
        <DialogText>Таймер остановится. Результат вступит в силу только после подтверждения главным судьёй.</DialogText>
        <Field label="Способ завершения">
          {(id) => (
            <Select id={id} value={endCode} onChange={(e) => setEndCode(e.target.value)}>
              <option value="">— выберите —</option>
              {def?.endMethods.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {endMethod?.requiresWinner && (
          <Field label="Победитель">
            {(id) => (
              <Select id={id} value={winner} onChange={(e) => setWinner(e.target.value as Side | "")}>
                <option value="">— выберите —</option>
                <option value="red">{SIDE_LABEL.red}: {personName(s.participants.red)}</option>
                <option value="blue">{SIDE_LABEL.blue}: {personName(s.participants.blue)}</option>
              </Select>
            )}
          </Field>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "confirm"}
        title="Подтвердить результат?"
        confirmLabel="Подтвердить результат"
        confirmDisabled={!checked}
        onClose={close}
        onConfirm={async () => {
          if (await exec({ type: "result.confirm" }, "Результат подтверждён и сохранён")) close();
        }}
      >
        <DialogText>
          {pendingEndLabel}
          {pendingEnd?.winnerSide ? `, победитель — ${personName(s.participants[pendingEnd.winnerSide])}` : ""}. Счёт {s.state.score.red} : {s.state.score.blue}. После
          подтверждения результат изменить нельзя.
        </DialogText>
        <Checkbox label="Я проверил(а) счёт и способ завершения" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
      </ConfirmDialog>
    </div>
  );
}
