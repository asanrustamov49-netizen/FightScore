"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { TournamentStatusBadge } from "@/src/components/ui/Badge/Badge";
import { Button, ButtonLink } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { ConfirmDialog, DialogText } from "@/src/components/ui/Dialog/Dialog";
import { Flag } from "@/src/components/ui/Flag/Flag";
import { FormActions } from "@/src/components/ui/Form/Form";
import { Icon, type IconName } from "@/src/components/ui/Icon/Icon";
import { Empty, ErrorState, Loading, Notice, PageSkeleton } from "@/src/components/ui/Notice/Notice";
import { Columns, MetaItem, PageHeader, Stack } from "@/src/components/ui/PageHeader/PageHeader";
import { LinkRow, RowLink, Table, tableStyles } from "@/src/components/ui/Table/Table";
import { Tabs } from "@/src/components/ui/Tabs/Tabs";
import { useToast } from "@/src/components/ui/Toast/Toast";
import { AthleteForm } from "@/src/components/widgets/AthleteForm/AthleteForm";
import { BulkAthletePicker, type BulkResult } from "@/src/components/widgets/BulkAthletePicker/BulkAthletePicker";
import { BracketView } from "@/src/components/widgets/BracketView/BracketView";
import { BracketCreateForm } from "@/src/components/widgets/BracketView/BracketCreateForm";
import { MatchSetupForm } from "@/src/components/widgets/MatchSetupForm/MatchSetupForm";
import { MatchTable } from "@/src/components/widgets/MatchTable/MatchTable";
import { StatTiles } from "@/src/components/widgets/StatTiles/StatTiles";
import { TournamentJudges } from "@/src/components/widgets/TournamentJudges/TournamentJudges";
import { TournamentForm, type TournamentInput } from "@/src/components/widgets/TournamentForm/TournamentForm";
import { api, errorText } from "@/src/lib/api";
import { dateRange, personName } from "@/src/lib/format";
import type { Athlete, Bracket, Country, Discipline, MatchListItem, OfficialCandidate, RuleVersion, TournamentDetail } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";
import styles from "./TournamentDetailPage.module.scss";

const TABS = ["overview", "athletes", "matches", "bracket", "judges", "results"] as const;
type Tab = (typeof TABS)[number];

/** The next status an organizer moves the tournament to, with its button. */
const NEXT_STATUS: Partial<Record<TournamentDetail["status"], { status: TournamentDetail["status"]; label: string; icon: IconName; done: string }>> = {
  draft: { status: "scheduled", label: "Опубликовать турнир", icon: "check", done: "Турнир опубликован" },
  scheduled: { status: "active", label: "Начать турнир", icon: "play", done: "Турнир начат" },
  active: { status: "completed", label: "Завершить турнир", icon: "flagCheck", done: "Турнир завершён" },
};

export function TournamentDetailPage() {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams();
  const toast = useToast();
  const { id } = useParams<{ id: string }>();
  const tabParam = query.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "overview";

  const t = useResource<TournamentDetail>(`/tournaments/${id}`);
  const canManage = !!t.data?.canManage && !t.data.archived_at;
  const matches = useResource<MatchListItem[]>(`/matches?tournamentId=${id}`);
  const brackets = useResource<Bracket[]>(`/tournaments/${id}/brackets`);
  // The bracket tab follows results on its own while matches are being fought: a light refresh every 10 s, only
  // while the page is visible and something can still change, plus one on return to the tab.
  const bracketActive = !!brackets.data?.some((b) => b.matches.some((m) => ["ready", "live", "awaiting_confirmation"].includes(m.status)));
  const reloadBrackets = brackets.reload;
  useEffect(() => {
    if (tabParam !== "bracket" || !bracketActive) return;
    const tick = () => document.visibilityState === "visible" && void reloadBrackets();
    const timer = window.setInterval(tick, 10_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [tabParam, bracketActive, reloadBrackets]);
  const disciplines = useResource<Discipline[]>(canManage ? "/disciplines" : null);
  const athletes = useResource<Athlete[]>(canManage ? "/athletes" : null);
  const rules = useResource<RuleVersion[]>(canManage ? "/rule-versions" : null);
  const officials = useResource<OfficialCandidate[]>(canManage ? `/tournaments/${id}/officials` : null);

  const [editing, setEditing] = useState(() => query.get("edit") === "1");
  const [creatingMatch, setCreatingMatch] = useState(false);
  const [newAthlete, setNewAthlete] = useState(false);
  const [creatingBracket, setCreatingBracket] = useState(false);
  // Loaded only when the organizer opens the inline "new athlete" form.
  const countries = useResource<Country[]>(canManage && newAthlete ? "/countries" : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"archive" | "complete" | null>(null);

  if (t.loading) return <PageSkeleton cards={4} />;
  if (t.error || !t.data) return <ErrorState message={t.error ?? "Турнир не найден"} onRetry={t.reload} />;
  const tour = t.data;
  const registered = new Set(tour.athletes.map((a) => a.athlete_id));
  const all = matches.data ?? [];
  const live = all.filter((m) => m.status === "live" || m.status === "awaiting_confirmation");
  const completed = all.filter((m) => m.status === "completed");
  const upcoming = all.filter((m) => m.status === "ready" || m.status === "prepared");
  const judges = officials.data ?? [];
  const disciplineIds = new Set(tour.disciplines.map((d) => d.id));
  const usableRules = (rules.data ?? []).filter((r) => r.status === "approved" && !r.profile_archived_at && disciplineIds.has(r.discipline_id));
  const next = NEXT_STATUS[tour.status];
  const finished = tour.status === "completed";
  const freeDisciplines = tour.disciplines.filter((d) => !brackets.data?.some((b) => b.discipline_id === d.id));
  const hrefFor = (tabId: string) => (tabId === "overview" ? pathname : `${pathname}?tab=${tabId}`);

  const asInput = (status: TournamentDetail["status"]): TournamentInput => ({
    name: tour.name,
    startsOn: tour.starts_on,
    endsOn: tour.ends_on,
    venue: tour.venue ?? "",
    status,
    disciplineIds: tour.disciplines.map((d) => d.id),
  });

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await Promise.all([t.reload(), matches.reload(), officials.reload()]);
      if (done) toast(done);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const advance = () => next && run(() => api.put(`/tournaments/${id}`, { ...asInput(next.status), venue: tour.venue || null }), next.done);

  // Checklist for organizers: what is done and what to do next, each step with its own action.
  const steps: { done: boolean; title: string; text: string; action?: { label: string; href: string } }[] = [
    {
      done: tour.athletes.length >= 2,
      title: "Зарегистрируйте участников",
      text: `${tour.athletes.length} в турнире. Для поединка нужны двое.`,
      action: { label: "Участники", href: hrefFor("athletes") },
    },
    {
      done: usableRules.length > 0,
      title: "Выберите правила",
      text: usableRules.length
        ? `Доступно утверждённых профилей: ${usableRules.length}.`
        : "Для дисциплин турнира нет утверждённого профиля правил. Создайте и опубликуйте профиль.",
      action: { label: usableRules.length ? "Профили правил" : "Создать профиль", href: usableRules.length ? "/rules" : "/rules/new" },
    },
    {
      done: judges.some((j) => j.roles.includes("chief_judge") || j.roles.includes("owner")),
      title: "Добавьте судей",
      text: judges.length ? `Судей: ${judges.length}. Нужен хотя бы один главный судья.` : "Без главного судьи поединок нельзя отметить готовым к старту.",
      action: { label: "Судьи", href: hrefFor("judges") },
    },
    {
      done: all.length > 0,
      title: "Создайте поединки",
      text: all.length ? `Поединков: ${all.length}.` : "Выберите угол каждому спортсмену и версию правил.",
      action: { label: "Поединки", href: hrefFor("matches") },
    },
    {
      done: tour.status === "active" || tour.status === "completed",
      title: "Начните турнир и выведите поединок на табло",
      text: "Табло открывается по ссылке без входа на отдельном экране или ТВ.",
      action: { label: "Табло", href: "/displays" },
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const current = steps.findIndex((s) => !s.done);

  return (
    <>
      <PageHeader
        hero
        breadcrumbs={[{ label: "Турниры", href: "/tournaments" }]}
        title={
          <>
            {tour.name}
            <TournamentStatusBadge status={tour.status} archived={!!tour.archived_at} />
          </>
        }
        meta={
          <>
            <MetaItem icon="calendar">{dateRange(tour.starts_on, tour.ends_on)}</MetaItem>
            {tour.venue && <MetaItem icon="pin">{tour.venue}</MetaItem>}
            <MetaItem icon="versus">{tour.disciplines.map((d) => d.name).join(", ")}</MetaItem>
          </>
        }
        actions={
          canManage && (
            <>
              <Button onClick={() => setEditing((x) => !x)} aria-expanded={editing}>
                <Icon name="edit" size={17} />
                {editing ? "Скрыть редактирование" : "Редактировать"}
              </Button>
              {next && (
                <Button variant="primary" loading={busy} onClick={() => (next.status === "completed" ? setConfirm("complete") : void advance())}>
                  <Icon name={next.icon} size={17} />
                  {next.label}
                </Button>
              )}
            </>
          )
        }
      />
      <Stack>
        {tour.archived_at && (
          <Notice tone="info" title="Турнир в архиве">
            Данные, поединки и результаты сохранены и доступны для просмотра. Чтобы снова управлять турниром, верните его из архива.
            {tour.canManage && (
              <span className={styles.noticeAction}>
                <Button size="sm" loading={busy} onClick={() => void run(() => api.post(`/tournaments/${id}/unarchive`), "Турнир возвращён из архива")}>
                  <Icon name="archive" size={16} />
                  Вернуть из архива
                </Button>
              </span>
            )}
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        {editing && canManage && disciplines.data && (
          <Card title="Редактирование турнира">
            <TournamentForm
              mode="edit"
              disciplines={disciplines.data}
              initial={asInput(tour.status)}
              onCancel={() => setEditing(false)}
              onSubmit={async (v) => {
                await api.put(`/tournaments/${id}`, { ...v, venue: v.venue || null });
                setEditing(false);
                toast("Изменения сохранены");
                await t.reload();
              }}
            />
            <div className={styles.danger}>
              <div>
                <strong>Архив</strong>
                <p>Турнир пропадёт из текущих. Данные, поединки и результаты сохранятся.</p>
              </div>
              <Button variant="danger" onClick={() => setConfirm("archive")}>
                <Icon name="archive" size={17} />В архив
              </Button>
            </div>
          </Card>
        )}

        <StatTiles
          compact
          items={[
            { label: "Участники", value: tour.athletes.length, href: hrefFor("athletes") },
            { label: "Поединки", value: all.length, href: hrefFor("matches") },
            { label: "Идут сейчас", value: live.length, live: live.length > 0, href: hrefFor("matches") },
            { label: "Завершены", value: completed.length, href: hrefFor("results") },
            ...(canManage ? [{ label: "Судьи", value: judges.length, href: hrefFor("judges") }] : []),
          ]}
        />

        <Tabs
          label="Разделы турнира"
          active={tab}
          hrefFor={hrefFor}
          items={[
            { id: "overview", label: "Обзор" },
            { id: "athletes", label: "Участники", count: tour.athletes.length },
            { id: "matches", label: "Поединки", count: all.length },
            { id: "judges", label: "Судьи", count: canManage ? judges.length : undefined },
            { id: "bracket", label: "Сетка", count: brackets.data?.length || undefined },
            { id: "results", label: "Результаты", count: completed.length },
          ]}
        />

        {tab === "overview" && (
          <Columns sideFirstOnNarrow={canManage || finished}>
            <Stack>
              <Card title="Текущие и ближайшие поединки" actions={<Link href={hrefFor("matches")}>Все поединки</Link>} flush>
                {matches.data ? (
                  <MatchTable
                    matches={[...live, ...upcoming].slice(0, 8)}
                    showTournament={false}
                    emptyText="Нет текущих и запланированных поединков"
                    emptyAction={canManage && !finished ? <ButtonLink href={hrefFor("matches")}>Создать поединок</ButtonLink> : undefined}
                  />
                ) : (
                  <Loading />
                )}
              </Card>
              <ResultsCard matches={completed.slice(0, 5)} more={completed.length > 5 ? hrefFor("results") : undefined} />
            </Stack>
            {finished ? (
              <Card title="Турнир завершён" subtitle={`Завершено поединков: ${completed.length} из ${all.length}`}>
                <p className={styles.muted}>
                  {all.length > completed.length
                    ? "Часть поединков не завершена: откройте их во вкладке «Поединки», чтобы завершить или отменить."
                    : "Все поединки завершены. Итоги — во вкладке «Результаты»."}
                </p>
                <FormActions>
                  <ButtonLink href={hrefFor("results")} variant="primary">
                    Результаты
                  </ButtonLink>
                </FormActions>
              </Card>
            ) : canManage ? (
              <Card
                title="Подготовка турнира"
                subtitle={current === -1 ? "Всё готово к проведению" : "Что осталось подготовить к проведению"}
                actions={
                  <span className={styles.progressLabel}>
                    {doneCount} из {steps.length}
                  </span>
                }
              >
                <div
                  className={styles.progress}
                  role="progressbar"
                  aria-label="Подготовка турнира"
                  aria-valuemin={0}
                  aria-valuemax={steps.length}
                  aria-valuenow={doneCount}
                >
                  <span style={{ transform: `scaleX(${doneCount / steps.length})` }} />
                </div>
                <ol className={styles.steps}>
                  {steps.map((s, i) => (
                    <li key={s.title} className={s.done ? styles.stepDone : i === current ? styles.stepCurrent : undefined}>
                      <span className={styles.stepMark} aria-hidden>
                        {s.done ? <Icon name="check" size={15} /> : i + 1}
                      </span>
                      <div className={styles.stepText}>
                        <strong>
                          {s.title}
                          <span className="visually-hidden">{s.done ? " — готово" : " — не сделано"}</span>
                        </strong>
                        <span>{s.text}</span>
                      </div>
                      {s.action && !s.done && (
                        <ButtonLink href={s.action.href} size="sm" variant={i === current ? "primary" : "ghost"}>
                          {s.action.label}
                        </ButtonLink>
                      )}
                    </li>
                  ))}
                </ol>
              </Card>
            ) : (
              <Card title="Ваш доступ">
                <p className={styles.muted}>
                  Вы просматриваете турнир. Управлять им может организатор. Назначенные вам поединки открываются в разделе «Поединки» и на странице «Судья».
                </p>
              </Card>
            )}
          </Columns>
        )}

        {tab === "athletes" && (
          <Card title={`Участники (${tour.athletes.length})`} flush>
            {canManage && (
              <div className={styles.register}>
                <BulkAthletePicker
                  athletes={athletes.data ?? []}
                  registered={registered}
                  onRegisterOne={async (athleteId, registrationNumber) => {
                    await api.post(`/tournaments/${id}/athletes`, { athleteId, registrationNumber });
                    await t.reload();
                    toast("Спортсмен зарегистрирован в турнире");
                  }}
                  onRegisterMany={async (athleteIds) => {
                    const res = await api.post<BulkResult>(`/tournaments/${id}/athletes/bulk`, { athleteIds });
                    await t.reload();
                    if (res.registered.length) toast(`Зарегистрировано спортсменов: ${res.registered.length}`);
                    return res;
                  }}
                />
                <FormActions>
                  <Button variant="ghost" onClick={() => setNewAthlete((x) => !x)} aria-expanded={newAthlete}>
                    <Icon name="plus" size={16} />
                    {newAthlete ? "Скрыть форму спортсмена" : "Нового спортсмена нет в базе"}
                  </Button>
                </FormActions>
              </div>
            )}
            {canManage && newAthlete && (
              <div className={styles.register}>
                <strong>Новый спортсмен</strong>
                <span className={styles.sub}>Спортсмен будет добавлен в общую базу и сразу зарегистрирован в этом турнире.</span>
                {countries.data ? (
                  <AthleteForm
                    countries={countries.data}
                    submitLabel="Добавить и зарегистрировать"
                    onCancel={() => setNewAthlete(false)}
                    onSubmit={async (v) => {
                      // Two calls of the existing API: create in the base, then register. If the second fails,
                      // the athlete stays in the base and can be picked from the list above.
                      const created = await api.post<{ id: string }>("/athletes", v);
                      await api.post(`/tournaments/${id}/athletes`, { athleteId: created.id, registrationNumber: null });
                      setNewAthlete(false);
                      await Promise.all([t.reload(), athletes.reload()]);
                      toast("Спортсмен добавлен и зарегистрирован в турнире");
                    }}
                  />
                ) : countries.error ? (
                  <Notice tone="error">{countries.error}</Notice>
                ) : (
                  <Loading label="Загрузка списка стран…" />
                )}
              </div>
            )}
            {tour.athletes.length ? (
              <Table
                caption="Участники турнира"
                head={
                  <tr>
                    <th>Спортсмен</th>
                    <th>Страна</th>
                    <th>Номер</th>
                    <th className={tableStyles.end}>
                      <span className="visually-hidden">Действия</span>
                    </th>
                  </tr>
                }
              >
                {tour.athletes.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{personName(a)}</strong>
                      {a.club_name && <div className={styles.sub}>{a.club_name}</div>}
                    </td>
                    <td>
                      <Flag code={a.country_code} name={a.country_name} />
                    </td>
                    <td className={tableStyles.muted}>{a.registration_number ?? "—"}</td>
                    <td className={tableStyles.end}>
                      {canManage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => run(() => api.del(`/tournaments/${id}/athletes/${a.id}`), "Спортсмен снят с турнира")}
                          aria-label={`Снять ${personName(a)} с турнира`}
                        >
                          Снять
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty icon="users" title="Участники не зарегистрированы">
                {canManage
                  ? "Выберите спортсмена из базы выше. Если его нет в базе, сначала добавьте его на странице «Спортсмены»."
                  : "Организатор ещё не добавил участников."}
              </Empty>
            )}
          </Card>
        )}

        {tab === "matches" && (
          <Card
            title="Поединки"
            subtitle="Строка открывает поединок: состав, судьи, журнал и результат"
            actions={
              canManage &&
              !creatingMatch &&
              !finished && (
                <Button variant="primary" size="sm" onClick={() => setCreatingMatch(true)}>
                  <Icon name="plus" size={16} />
                  Новый поединок
                </Button>
              )
            }
            flush
          >
            {creatingMatch && rules.data && (
              <div className={styles.register}>
                <MatchSetupForm
                  disciplines={tour.disciplines}
                  entries={tour.athletes}
                  ruleVersions={rules.data}
                  submitLabel="Создать поединок"
                  onCancel={() => setCreatingMatch(false)}
                  onSubmit={async (v) => {
                    const m = await api.post<{ id: string }>(`/tournaments/${id}/matches`, v);
                    toast("Поединок создан. Назначьте судей и отметьте готовность");
                    router.push(`/matches/${m.id}`);
                  }}
                />
              </div>
            )}
            {matches.data ? (
              <MatchTable
                matches={all}
                showTournament={false}
                emptyText="Поединков пока нет"
                emptyHint={canManage ? "Нажмите «Новый поединок»: выберите дисциплину, спортсменов и версию правил." : undefined}
              />
            ) : (
              <Loading />
            )}
          </Card>
        )}

        {tab === "judges" &&
          (canManage ? (
            <TournamentJudges tournamentId={id} onChange={() => void officials.reload()} />
          ) : (
            <Card>
              <Empty icon="judge" title="Судьями управляет организатор">
                Назначенные вам поединки видны в разделе «Поединки» и на странице «Судья».
              </Empty>
            </Card>
          ))}

        {tab === "bracket" && (
          <Stack>
            {canManage && !finished && !creatingBracket && freeDisciplines.length > 0 && (
              <div>
                <Button variant="primary" onClick={() => setCreatingBracket(true)}>
                  <Icon name="plus" size={17} />
                  Создать сетку
                </Button>
              </div>
            )}
            {creatingBracket && rules.data && (
              <Card title="Новая сетка" subtitle="Олимпийская система: проигравший выбывает, победитель проходит в следующий круг">
                <BracketCreateForm
                  disciplines={freeDisciplines}
                  entries={tour.athletes}
                  ruleVersions={rules.data}
                  onCancel={() => setCreatingBracket(false)}
                  onSubmit={async (v) => {
                    await api.post(`/tournaments/${id}/brackets`, v);
                    setCreatingBracket(false);
                    await Promise.all([brackets.reload(), matches.reload()]);
                    toast("Сетка создана: поединки первого круга готовы к подготовке");
                  }}
                />
              </Card>
            )}
            {brackets.error ? (
              <ErrorState message={brackets.error} onRetry={brackets.reload} />
            ) : !brackets.data ? (
              <Loading />
            ) : brackets.data.length === 0 ? (
              !creatingBracket && (
                <Card>
                  <Empty icon="versus" title="Сеток пока нет">
                    {canManage && !finished
                      ? "Сетка создаёт все поединки олимпийской системы сразу и сама переводит победителя в следующий круг после подтверждения результата."
                      : "Организатор ещё не создал сетку для этого турнира."}
                  </Empty>
                </Card>
              )
            ) : (
              brackets.data.map((b) => (
                <Card
                  key={b.id}
                  title={`${b.discipline_name} · сетка на ${b.size}`}
                  subtitle={`${b.rule_profile_name}, версия правил ${b.rule_version_number}`}
                >
                  <BracketView
                    bracket={b}
                    canManage={canManage && !finished}
                    busy={busy}
                    onWalkover={(matchId, side) =>
                      void run(async () => {
                        await api.post(`/matches/${matchId}/walkover`, { side });
                        await brackets.reload();
                      }, "Проход в следующий круг назначен")
                    }
                  />
                </Card>
              ))
            )}
          </Stack>
        )}

        {tab === "results" && <ResultsCard matches={completed} protocol={`/tournaments/${id}/protocol`} />}
      </Stack>

      <ConfirmDialog
        open={confirm === "complete"}
        title="Завершить турнир?"
        confirmLabel="Завершить турнир"
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => void advance()?.then((ok) => ok && setConfirm(null))}
      >
        <DialogText>
          Статус сменится на «Завершён». Незавершённые поединки останутся в своём состоянии: при необходимости завершите или отмените их на их страницах.
        </DialogText>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "archive"}
        title="Отправить турнир в архив?"
        confirmLabel="В архив"
        confirmVariant="danger"
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          void run(() => api.post(`/tournaments/${id}/archive`), "Турнир отправлен в архив").then((ok) => {
            if (ok) {
              setConfirm(null);
              setEditing(false);
            }
          })
        }
      >
        <DialogText>Турнир пропадёт из текущих. Данные, поединки и результаты сохранятся.</DialogText>
      </ConfirmDialog>
    </>
  );
}

function ResultsCard({ matches, more, protocol }: { matches: MatchListItem[]; more?: string; protocol?: string }) {
  return (
    <Card
      title="Результаты"
      actions={
        more ? (
          <Link href={more}>Все результаты</Link>
        ) : (
          protocol && (
            <ButtonLink href={protocol} size="sm">
              Протокол для печати
            </ButtonLink>
          )
        )
      }
      flush
    >
      {matches.length ? (
        <Table
          caption="Подтверждённые результаты"
          head={
            <tr>
              <th>№</th>
              <th>Победитель</th>
              <th>Соперник</th>
              <th className={tableStyles.num}>Счёт</th>
            </tr>
          }
        >
          {matches.map((m) => {
            const red = m.red_name ?? "—";
            const blue = m.blue_name ?? "—";
            const [winner, loser] = m.winner_side === "blue" ? [blue, red] : [red, blue];
            return (
              <LinkRow key={m.id}>
                <td>
                  <RowLink href={`/matches/${m.id}`} label={`Поединок №${m.match_number}`}>
                    {m.match_number}
                  </RowLink>
                </td>
                <td>{m.winner_side ? <strong>{winner}</strong> : <span className={tableStyles.muted}>Без победителя</span>}</td>
                <td className={tableStyles.muted}>{m.winner_side ? loser : `${red} — ${blue}`}</td>
                <td className={tableStyles.num}>
                  {m.score.red} : {m.score.blue}
                </td>
              </LinkRow>
            );
          })}
        </Table>
      ) : (
        <Empty icon="trophy" title="Подтверждённых результатов пока нет">
          Результат появляется здесь после того, как главный судья подтвердит итог поединка.
        </Empty>
      )}
    </Card>
  );
}
