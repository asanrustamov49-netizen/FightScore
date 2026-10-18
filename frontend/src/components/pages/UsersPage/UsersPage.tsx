"use client";

import { useState, type FormEvent } from "react";
import { Badge } from "@/src/components/ui/Badge/Badge";
import { Button } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { Field, FormActions, FormGrid, formClass, Input, Select } from "@/src/components/ui/Form/Form";
import { Empty, ErrorState, Loading, Notice } from "@/src/components/ui/Notice/Notice";
import { PageHeader, Stack } from "@/src/components/ui/PageHeader/PageHeader";
import { Table } from "@/src/components/ui/Table/Table";
import { api, errorText } from "@/src/lib/api";
import { formatDateTime } from "@/src/lib/format";
import { useResource } from "@/src/lib/use-resource";

interface UserRow {
  id: string;
  login: string;
  display_name: string;
  is_active: boolean;
  last_login_at: string | null;
  has_password: boolean;
  roles: string[];
}

const ROLES = [
  ["organizer", "Организатор"],
  ["chief_judge", "Главный судья"],
  ["judge", "Судья"],
  ["display_operator", "Оператор табло"],
] as const;
const ROLE_NAME: Record<string, string> = { owner: "Владелец", ...Object.fromEntries(ROLES) };

export function UsersPage() {
  const list = useResource<UserRow[]>("/users");
  const [form, setForm] = useState({ login: "", displayName: "", password: "", role: "judge" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await api.post("/users", form);
      setDone(`Пользователь ${form.login} создан`);
      setForm({ login: "", displayName: "", password: "", role: form.role });
      await list.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Пользователи" description="Локальные учётные записи работают без интернета." />
      <Stack>
        <Card title="Новый пользователь">
          <form onSubmit={submit} className={formClass}>
            {error && <Notice tone="error">{error}</Notice>}
            {done && <Notice tone="success">{done}</Notice>}
            <FormGrid cols={4}>
              <Field label="Логин" hint="Латиница, цифры, . _ - @ +">
                {(id) => <Input id={id} value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required autoComplete="off" />}
              </Field>
              <Field label="Имя">{(id) => <Input id={id} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />}</Field>
              <Field label="Пароль" hint="Не короче 8 символов">
                {(id) => (
                  <Input id={id} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} autoComplete="new-password" />
                )}
              </Field>
              <Field label="Роль">
                {(id) => (
                  <Select id={id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                    {ROLES.map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </FormGrid>
            <FormActions>
              <Button type="submit" variant="primary" loading={busy}>
                Создать
              </Button>
            </FormActions>
          </form>
        </Card>
        <Card flush>
          {list.loading ? (
            <Loading />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : !list.data?.length ? (
            <Empty icon="users" title="Пользователей нет" />
          ) : (
            <Table
              head={
                <tr>
                  <th>Пользователь</th>
                  <th>Роли</th>
                  <th>Последний вход</th>
                </tr>
              }
            >
              {list.data.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.display_name}</strong> <span>({u.login})</span> {!u.is_active && <Badge tone="danger">Отключён</Badge>}
                  </td>
                  <td>{u.roles.map((r) => ROLE_NAME[r] ?? r).join(", ") || "—"}</td>
                  <td>{formatDateTime(u.last_login_at)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </Stack>
    </>
  );
}
