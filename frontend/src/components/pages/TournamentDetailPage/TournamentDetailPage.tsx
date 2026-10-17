"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/src/components/ui/Badge/Badge";
import { Button } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { ConfirmDialog, DialogText } from "@/src/components/ui/Dialog/Dialog";
import { Flag } from "@/src/components/ui/Flag/Flag";
import { Field, FormActions, Input, Select } from "@/src/components/ui/Form/Form";
import { Empty, ErrorState, Loading, Notice } from "@/src/components/ui/Notice/Notice";
import { Columns, PageHeader, Stack } from "@/src/components/ui/PageHeader/PageHeader";
import { Table } from "@/src/components/ui/Table/Table";
import { MatchSetupForm } from "@/src/components/widgets/MatchSetupForm/MatchSetupForm";
import { MatchTable } from "@/src/components/widgets/MatchTable/MatchTable";
import { TournamentJudges } from "@/src/components/widgets/TournamentJudges/TournamentJudges";
import { TournamentForm } from "@/src/components/widgets/TournamentForm/TournamentForm";
import { api, errorText } from "@/src/lib/api";
import { formatDate, personName, TOURNAMENT_STATUS_LABEL } from "@/src/lib/format";
import type { Athlete, Discipline, MatchListItem, RuleVersion, TournamentDetail } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";
import styles from "./TournamentDetailPage.module.scss";

export function TournamentDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const t = useResource<TournamentDetail>(`/tournaments/${id}`);
  const matches = useResource<MatchListItem[]>(`/matches?tournamentId=${id}`);
  const disciplines = useResource<Discipline[]>("/disciplines");
  const athletes = useResource<Athlete[]>("/athletes");
  const rules = useResource<RuleVersion[]>("/rule-versions");
  const [editing, setEditing] = useState(false);
  const [creatingMatch, setCreatingMatch] = useState(false);
  const [registerId, setRegisterId] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  if (t.loading) return <Loading />;
  if (t.error || !t.data) return <ErrorState message={t.error ?? "Турнир не найден"} onRetry={t.reload} />;
  const tour = t.data;
  const registered = new Set(tour.athletes.map((a) => a.athlete_id));
  const available = (athletes.data ?? []).filter((a) => !registered.has(a.id));

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await Promise.all([t.reload(), matches.reload()]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/tournaments">Турниры</Link>}
        title={
          <>
            {tour.name}
            {tour.archived_at ? <Badge>В архиве</Badge> : <Badge tone={tour.status === "active" ? "success" : "neutral"}>{TOURNAMENT_STATUS_LABEL[tour.status]}</Badge>}
          </>
        }
        description={`${formatDate(tour.starts_on)}${tour.ends_on !== tour.starts_on ? ` — ${formatDate(tour.ends_on)}` : ""}${tour.venue ? ` · ${tour.venue}` : ""}`}
        actions={
          tour.canManage &&
          !tour.archived_at && (
            <>
              <Button onClick={() => setEditing((x) => !x)}>{editing ? "Скрыть редактирование" : "Редактировать"}</Button>
              <Button variant="danger" onClick={() => setArchiveOpen(true)}>
                В архив
              </Button>
            </>
          )
        }
      />
      <Stack>
        {error && <Notice tone="error">{error}</Notice>}
        {editing && disciplines.data && (
          <Card title="Редактирование турнира">
            <TournamentForm
              disciplines={disciplines.data}
              submitLabel="Сохранить"
              initial={{
                name: tour.name,
                startsOn: tour.starts_on,
                endsOn: tour.ends_on,
                venue: tour.venue ?? "",
                status: tour.status,
                disciplineIds: tour.disciplines.map((d) => d.id),
              }}
              onCancel={() => setEditing(false)}
              onSubmit={async (v) => {
                await api.put(`/tournaments/${id}`, { ...v, venue: v.venue || null });
                setEditing(false);
                await t.reload();
              }}
            />
          </Card>
        )}
        <Columns>
          <Card
            title="Поединки"
            subtitle={tour.disciplines.map((d) => d.name).join(", ")}
            actions={tour.canManage && !tour.archived_at && !creatingMatch && <Button variant="primary" size="sm" onClick={() => setCreatingMatch(true)}>Новый поединок</Button>}
          >
            <Stack>
              {creatingMatch && rules.data && (
                <MatchSetupForm
                  disciplines={tour.disciplines}
                  entries={tour.athletes}
                  ruleVersions={rules.data}
                  submitLabel="Создать поединок"
                  onCancel={() => setCreatingMatch(false)}
                  onSubmit={async (v) => {
                    const m = await api.post<{ id: string }>(`/tournaments/${id}/matches`, v);
                    router.push(`/matches/${m.id}`);
                  }}
                />
              )}
              {matches.data ? <MatchTable matches={matches.data} showTournament={false} /> : <Loading />}
            </Stack>
          </Card>
          <Card title={`Участники (${tour.athletes.length})`} flush>
            {tour.canManage && !tour.archived_at && (
              <div className={styles.register}>
                <Field label="Зарегистрировать спортсмена" hint={available.length ? undefined : "Все спортсмены из базы уже зарегистрированы"}>
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
                <Field label="Регистрационный номер (необязательно)">
                  {(fid) => <Input id={fid} value={regNumber} onChange={(e) => setRegNumber(e.target.value)} maxLength={40} />}
                </Field>
                <FormActions>
                  <Link href="/athletes">Добавить в базу</Link>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!registerId}
                    loading={busy}
                    onClick={() =>
                      run(async () => {
                        await api.post(`/tournaments/${id}/athletes`, { athleteId: registerId, registrationNumber: regNumber || null });
                        setRegisterId("");
                        setRegNumber("");
                      })
                    }
                  >
                    Зарегистрировать
                  </Button>
                </FormActions>
              </div>
            )}
            {tour.athletes.length ? (
              <Table
                head={
                  <tr>
                    <th>Спортсмен</th>
                    <th>Страна</th>
                    <th />
                  </tr>
                }
              >
                {tour.athletes.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {personName(a)}
                      {a.club_name && <div className={styles.sub}>{a.club_name}</div>}
                    </td>
                    <td>
                      <Flag code={a.country_code} name={a.country_name} />
                    </td>
                    <td>
                      {tour.canManage && !tour.archived_at && (
                        <Button size="sm" variant="ghost" onClick={() => run(() => api.del(`/tournaments/${id}/athletes/${a.id}`))} aria-label={`Снять ${personName(a)} с турнира`}>
                          Снять
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty title="Участники не зарегистрированы" />
            )}
          </Card>
        </Columns>
        {tour.canManage && !tour.archived_at && <TournamentJudges tournamentId={id} />}
      </Stack>
      <ConfirmDialog
        open={archiveOpen}
        title="Отправить турнир в архив?"
        confirmLabel="В архив"
        confirmVariant="danger"
        busy={busy}
        onClose={() => setArchiveOpen(false)}
        onConfirm={() => run(() => api.post(`/tournaments/${id}/archive`)).then(() => setArchiveOpen(false))}
      >
        <DialogText>Турнир пропадёт из активных. Данные, поединки и результаты сохранятся.</DialogText>
      </ConfirmDialog>
    </>
  );
}
