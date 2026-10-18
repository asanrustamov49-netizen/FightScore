"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { TournamentStatusBadge } from "@/src/components/ui/Badge/Badge";
import { Button, ButtonLink } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { ConfirmDialog, DialogText } from "@/src/components/ui/Dialog/Dialog";
import { Flag } from "@/src/components/ui/Flag/Flag";
import { Field, FormActions, Input, Select } from "@/src/components/ui/Form/Form";
import { Icon, type IconName } from "@/src/components/ui/Icon/Icon";
import { Empty, ErrorState, Loading, Notice } from "@/src/components/ui/Notice/Notice";
import { Columns, MetaItem, PageHeader, Stack } from "@/src/components/ui/PageHeader/PageHeader";
import { LinkRow, RowLink, Table, tableStyles } from "@/src/components/ui/Table/Table";
import { Tabs } from "@/src/components/ui/Tabs/Tabs";
import { useToast } from "@/src/components/ui/Toast/Toast";
import { MatchSetupForm } from "@/src/components/widgets/MatchSetupForm/MatchSetupForm";
import { MatchTable } from "@/src/components/widgets/MatchTable/MatchTable";
import { StatTiles } from "@/src/components/widgets/StatTiles/StatTiles";
import { TournamentJudges } from "@/src/components/widgets/TournamentJudges/TournamentJudges";
import { TournamentForm, type TournamentInput } from "@/src/components/widgets/TournamentForm/TournamentForm";
import { api, errorText } from "@/src/lib/api";
import { dateRange, personName } from "@/src/lib/format";
import type { Athlete, Discipline, MatchListItem, OfficialCandidate, RuleVersion, TournamentDetail } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";
import styles from "./TournamentDetailPage.module.scss";

const TABS = ["overview", "athletes", "matches", "judges", "results"] as const;
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
  const disciplines = useResource<Discipline[]>(canManage ? "/disciplines" : null);
  const athletes = useResource<Athlete[]>(canManage ? "/athletes" : null);
  const rules = useResource<RuleVersion[]>(canManage ? "/rule-versions" : null);
  const officials = useResource<OfficialCandidate[]>(canManage ? `/tournaments/${id}/officials` : null);

  const [editing, setEditing] = useState(() => query.get("edit") === "1");
  const [creatingMatch, setCreatingMatch] = useState(false);
  const [registerId, setRegisterId] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"archive" | "complete" | null>(null);

  if (t.loading) return <Loading />;
  if (t.error || !t.data) return <ErrorState message={t.error ?? "Турнир не найден"} onRetry={t.reload} />;
  const tour = t.data;
  const registered = new Set(tour.athletes.map((a) => a.athlete_id));
  const available = (athletes.data ?? []).filter((a) => !registered.has(a.id));
  const all = matches.data ?? [];
  const live = all.filter((m) => m.status === "live" || m.status === "awaiting_confirmation");
  const completed = all.filter((m) => m.status === "completed");
  const upcoming = all.filter((m) => m.status === "ready" || m.status === "prepared");
  const judges = officials.data ?? [];
  const disciplineIds = new Set(tour.disciplines.map((d) => d.id));
  const usableRules = (rules.data ?? []).filter((r) => r.status === "approved" && !r.profile_archived_at && disciplineIds.has(r.discipline_id));
  const next = NEXT_STATUS[tour.status];
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

  return (
    <>
      <PageHeader
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
        {tour.archived_at && <Notice tone="info">Турнир в архиве. Данные, поединки и результаты сохранены и доступны для просмотра.</Notice>}
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
                <Icon name="archive" size={17} />
                В архив
              </Button>
            </div>
          </Card>
        )}

        <StatTiles
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
            { id: "results", label: "Результаты", count: completed.length },
          ]}
        />

        {tab === "overview" && (
          <Columns sideFirstOnNarrow={canManage}>
            <Stack>
              <Card title="Текущие и ближайшие поединки" actions={<Link href={hrefFor("matches")}>Все поединки</Link>} flush>
                {matches.data ? (
                  <MatchTable
                    matches={[...live, ...upcoming].slice(0, 8)}
                    showTournament={false}
                    emptyText="Нет текущих и запланированных поединков"
                    emptyAction={canManage ? <ButtonLink href={hrefFor("matches")}>Создать поединок</ButtonLink> : undefined}
                  />
                ) : (
                  <Loading />
                )}
              </Card>
              <ResultsCard matches={completed.slice(0, 5)} more={completed.length > 5 ? hrefFor("results") : undefined} />
            </Stack>
            {canManage ? (
              <Card title="Следующие шаги" subtitle="Что осталось подготовить к проведению">
                <ol className={styles.steps}>
                  {steps.map((s) => (
                    <li key={s.title} className={s.done ? styles.stepDone : undefined}>
                      <span className={styles.stepMark} aria-hidden>
                        {s.done ? <Icon name="check" size={16} /> : null}
                      </span>
                      <div className={styles.stepText}>
                        <strong>
                          {s.title}
                          <span className="visually-hidden">{s.done ? " — готово" : " — не сделано"}</span>
                        </strong>
                        <span>{s.text}</span>
                      </div>
                      {s.action && !s.done && (
                        <ButtonLink href={s.action.href} size="sm">
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
                <Field label="Спортсмен из базы" hint={available.length ? undefined : "Все спортсмены из базы уже зарегистрированы"}>
                  {(fid) => (
                    <Select id={fid} value={registerId} onChange={(e) => setRegisterId(e.target.value)}>
                      <option value="">— выберите —</option>
                      {available.map((a) => (
                        <option key={a.id} value={a.id}>
                          {personName(a)} ({a.country_code})
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Регистрационный номер" hint="Необязательно">
                  {(fid) => <Input id={fid} value={regNumber} onChange={(e) => setRegNumber(e.target.value)} maxLength={40} />}
                </Field>
                <FormActions>
                  <ButtonLink href="/athletes" variant="ghost">
                    <Icon name="plus" size={16} />
                    Новый спортсмен в базе
                  </ButtonLink>
                  <Button
                    variant="primary"
                    disabled={!registerId}
                    loading={busy}
                    onClick={() =>
                      run(async () => {
                        await api.post(`/tournaments/${id}/athletes`, { athleteId: registerId, registrationNumber: regNumber || null });
                        setRegisterId("");
                        setRegNumber("");
                      }, "Спортсмен зарегистрирован в турнире")
                    }
                  >
                    Зарегистрировать
                  </Button>
                </FormActions>
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
                {canManage ? "Выберите спортсмена из базы выше. Если его нет в базе, сначала добавьте его на странице «Спортсмены»." : "Организатор ещё не добавил участников."}
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
              !creatingMatch && (
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

        {tab === "results" && <ResultsCard matches={completed} />}
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

function ResultsCard({ matches, more }: { matches: MatchListItem[]; more?: string }) {
  return (
    <Card title="Результаты" actions={more && <Link href={more}>Все результаты</Link>} flush>
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
