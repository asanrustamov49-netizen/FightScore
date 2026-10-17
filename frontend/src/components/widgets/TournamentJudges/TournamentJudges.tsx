"use client";

import { useState, type FormEvent } from "react";
import { Badge } from "@/src/components/ui/Badge/Badge";
import { Button } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { Field, FormActions, FormGrid, formClass, Input, insetClass, Select } from "@/src/components/ui/Form/Form";
import { Empty, ErrorState, Loading, Notice } from "@/src/components/ui/Notice/Notice";
import { Table } from "@/src/components/ui/Table/Table";
import { api, errorText } from "@/src/lib/api";
import type { OfficialCandidate } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";

const ROLE: Record<string, string> = { chief_judge: "Главный судья", judge: "Судья", owner: "Владелец" };
const EMPTY = { login: "", displayName: "", password: "", role: "judge" };

/**
 * Judges of one tournament. Accounts created here exist only for this tournament: they cannot see
 * other tournaments and get no organizer rights. Give each judge their login and password in person.
 */
export function TournamentJudges({ tournamentId }: { tournamentId: string }) {
  const list = useResource<OfficialCandidate[]>(`/tournaments/${tournamentId}/officials`);
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await api.post(`/tournaments/${tournamentId}/judges`, form);
      setDone(`Учётная запись «${form.login}» создана. Передайте судье логин и пароль лично; вход — на странице «Судья».`);
      setForm(EMPTY);
      setOpen(false);
      await list.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Судьи турнира"
      subtitle="Назначаются на поединки в карточке поединка"
      actions={!open && <Button size="sm" variant="primary" onClick={() => setOpen(true)}>Добавить судью</Button>}
      flush
    >
      {done && <Notice tone="success">{done}</Notice>}
      {open && (
        <form className={`${formClass} ${insetClass}`} onSubmit={submit}>
          {error && <Notice tone="error">{error}</Notice>}
          <FormGrid cols={2}>
            <Field label="Логин" hint="Латиница, цифры, . _ -">
              {(id) => <Input id={id} value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required autoComplete="off" />}
            </Field>
            <Field label="Имя судьи">{(id) => <Input id={id} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />}</Field>
            <Field label="Пароль" hint="Не короче 8 символов">
              {(id) => (
                <Input id={id} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} autoComplete="new-password" />
              )}
            </Field>
            <Field label="Роль">
              {(id) => (
                <Select id={id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option value="judge">Судья</option>
                  <option value="chief_judge">Главный судья</option>
                </Select>
              )}
            </Field>
          </FormGrid>
          <FormActions>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Создать учётную запись
            </Button>
          </FormActions>
        </form>
      )}
      {list.loading ? (
        <Loading />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data?.length ? (
        <Empty title="Судей пока нет">Добавьте хотя бы главного судью — без него поединок нельзя отметить готовым к старту.</Empty>
      ) : (
        <Table
          head={
            <tr>
              <th>Судья</th>
              <th>Роль</th>
              <th>Учётная запись</th>
            </tr>
          }
        >
          {list.data.map((u) => (
            <tr key={u.id}>
              <td>
                {u.display_name} <span>({u.login})</span>
              </td>
              <td>{u.roles.map((r) => ROLE[r] ?? r).join(", ")}</td>
              <td>{u.tournament_account ? <Badge>только этот турнир</Badge> : <Badge tone="info">системная</Badge>}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
