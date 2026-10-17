"use client";

import { useState } from "react";
import { Button, ButtonLink } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { ConfirmDialog, DialogText } from "@/src/components/ui/Dialog/Dialog";
import { Field, FormActions, FormGrid, Input, Select } from "@/src/components/ui/Form/Form";
import { Empty, ErrorState, Loading, Notice } from "@/src/components/ui/Notice/Notice";
import { PageHeader, Stack } from "@/src/components/ui/PageHeader/PageHeader";
import { Table } from "@/src/components/ui/Table/Table";
import { api, errorText } from "@/src/lib/api";
import { STATUS_LABEL } from "@/src/lib/format";
import type { DisplayItem, MatchListItem, TournamentSummary } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";

export function DisplaysPage() {
  const displays = useResource<DisplayItem[]>("/displays");
  const tournaments = useResource<TournamentSummary[]>("/tournaments");
  const matches = useResource<MatchListItem[]>("/matches");
  const [name, setName] = useState("");
  const [tournamentId, setTournamentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rotate, setRotate] = useState<DisplayItem | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await displays.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const activeTournaments = (tournaments.data ?? []).filter((t) => !t.archived_at);

  return (
    <>
      <PageHeader
        eyebrow="Трансляция"
        title="Табло"
        description="Публичное табло открывается по ссылке без входа. Ссылка даёт только просмотр и не позволяет управлять поединком."
      />
      <Stack>
        {error && <Notice tone="error">{error}</Notice>}
        <Card title="Новое табло">
          <FormGrid cols={2}>
            <Field label="Название">{(id) => <Input id={id} value={name} placeholder="Татами 1 — ТВ" onChange={(e) => setName(e.target.value)} maxLength={80} />}</Field>
            <Field label="Турнир">
              {(id) => (
                <Select id={id} value={tournamentId} onChange={(e) => setTournamentId(e.target.value)}>
                  <option value="">— выберите —</option>
                  {activeTournaments.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </FormGrid>
          <FormActions>
            <Button
              variant="primary"
              disabled={!name.trim() || !tournamentId}
              loading={busy}
              onClick={() =>
                run(async () => {
                  await api.post("/displays", { name: name.trim(), tournamentId });
                  setName("");
                })
              }
            >
              Создать табло
            </Button>
          </FormActions>
        </Card>
        <Card title="Табло" flush>
          {displays.loading ? (
            <Loading />
          ) : displays.error ? (
            <ErrorState message={displays.error} onRetry={displays.reload} />
          ) : !displays.data?.length ? (
            <Empty title="Табло ещё не созданы" />
          ) : (
            <Table
              head={
                <tr>
                  <th>Табло</th>
                  <th>Показывает поединок</th>
                  <th>Ссылка</th>
                </tr>
              }
            >
              {displays.data.map((d) => {
                const options = (matches.data ?? []).filter((m) => m.tournament_id === d.tournament_id);
                return (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.name}</strong>
                      <div>{d.tournament_name}</div>
                    </td>
                    <td>
                      <Field label="Поединок">
                        {(id) => (
                          <Select
                            id={id}
                            value={d.current_match_id ?? ""}
                            disabled={busy}
                            onChange={(e) => run(() => api.put(`/displays/${d.id}/match`, { matchId: e.target.value || null }))}
                          >
                            <option value="">— не показывать —</option>
                            {options.map((m) => (
                              <option key={m.id} value={m.id}>
                                №{m.match_number}: {m.red_name ?? "?"} — {m.blue_name ?? "?"} ({STATUS_LABEL[m.status]})
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    </td>
                    <td>
                      <FormActions>
                        <ButtonLink href={`/display/${d.public_token}`} target="_blank" size="sm" variant="primary">
                          Открыть табло
                        </ButtonLink>
                        <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/display/${d.public_token}`)}>
                          Копировать ссылку
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setRotate(d)}>
                          Новая ссылка
                        </Button>
                      </FormActions>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      </Stack>
      <ConfirmDialog
        open={!!rotate}
        title="Выпустить новую ссылку?"
        confirmLabel="Выпустить"
        confirmVariant="danger"
        busy={busy}
        onClose={() => setRotate(null)}
        onConfirm={() => run(() => api.post(`/displays/${rotate!.id}/rotate-token`)).then(() => setRotate(null))}
      >
        <DialogText>Старая ссылка перестанет работать, открытые по ней экраны отключатся.</DialogText>
      </ConfirmDialog>
    </>
  );
}
