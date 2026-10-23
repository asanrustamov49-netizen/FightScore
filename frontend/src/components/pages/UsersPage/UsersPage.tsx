"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Badge } from "@/src/components/ui/Badge/Badge";
import { Button } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { ConfirmDialog, DialogText } from "@/src/components/ui/Dialog/Dialog";
import { Field, FormActions, FormGrid, formClass, Input, SearchField, Select } from "@/src/components/ui/Form/Form";
import { Icon } from "@/src/components/ui/Icon/Icon";
import { Empty, ErrorState, Loading, Notice } from "@/src/components/ui/Notice/Notice";
import { PageHeader, Stack } from "@/src/components/ui/PageHeader/PageHeader";
import { Table } from "@/src/components/ui/Table/Table";
import { Segmented } from "@/src/components/ui/Tabs/Tabs";
import { api, errorText } from "@/src/lib/api";
import { formatDateTime } from "@/src/lib/format";
import { useResource } from "@/src/lib/use-resource";
import styles from "./UsersPage.module.scss";

interface UserRow {
  id: string;
  login: string;
  display_name: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  blocked_at: string | null;
  blocked_reason: string | null;
  has_password: boolean;
  roles: string[];
  tournaments: number;
  matches_officiated: number;
}

const ROLES = [
  ["organizer", "Организатор"],
  ["chief_judge", "Главный судья"],
  ["judge", "Судья"],
  ["display_operator", "Оператор табло"],
] as const;
const ROLE_NAME: Record<string, string> = {
  owner: "Администратор платформы",
  organizer_self: "Организатор",
  ...Object.fromEntries(ROLES),
};

type RoleFilter = "all" | "organizers" | "judges" | "blocked";
type Action = { kind: "block" | "unblock" | "password" | "delete"; user: UserRow } | null;

const isAdmin = (u: UserRow) => u.roles.includes("owner");
const isOrganizer = (u: UserRow) => u.roles.some((r) => r === "organizer" || r === "organizer_self");
const isJudge = (u: UserRow) => u.roles.some((r) => r === "judge" || r === "chief_judge");

/** Readable random password for a reset: no look-alike characters. */
function randomPassword() {
  const set = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(14));
  return Array.from(bytes, (b) => set[b % set.length]).join("");
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?"
  );
}

/** Platform administrator's user management: find anyone, block, reset a password, delete. The server checks every step. */
export function UsersPage() {
  const query = useSearchParams();
  const list = useResource<UserRow[]>("/users");
  const [filter, setFilter] = useState<RoleFilter>(query.get("status") === "blocked" ? "blocked" : "all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ login: "", displayName: "", password: "", role: "judge" });
  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmLogin, setConfirmLogin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const users = useMemo(() => list.data ?? [], [list.data]);
  const counts = useMemo(
    () => ({
      all: users.length,
      organizers: users.filter(isOrganizer).length,
      judges: users.filter(isJudge).length,
      blocked: users.filter((u) => u.blocked_at).length,
    }),
    [users],
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(
      (u) =>
        (filter === "all" || (filter === "organizers" ? isOrganizer(u) : filter === "judges" ? isJudge(u) : !!u.blocked_at)) &&
        (!q || u.display_name.toLowerCase().includes(q) || u.login.toLowerCase().includes(q)),
    );
  }, [users, filter, search]);

  const open = (kind: NonNullable<Action>["kind"], user: UserRow) => {
    setError(null);
    setReason("");
    setConfirmLogin("");
    setNewPassword(kind === "password" ? randomPassword() : "");
    setAction({ kind, user });
  };
  const close = () => setAction(null);

  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setDone(message);
      close();
      await list.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await api.post("/users", form);
      setForm({ login: "", displayName: "", password: "", role: form.role });
      setCreating(false);
    }, `Пользователь ${form.login} создан`);
  }

  const target = action?.user;

  return (
    <>
      <PageHeader
        eyebrow="Администратор платформы"
        title="Пользователи"
        description="Все аккаунты платформы: организаторы, судьи и операторы табло. Блокировка сразу завершает все сеансы пользователя."
        actions={
          <Button variant="primary" onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
            <Icon name={creating ? "close" : "plus"} size={18} />
            {creating ? "Скрыть форму" : "Новый пользователь"}
          </Button>
        }
      />
      <Stack>
        {done && <Notice tone="success">{done}</Notice>}
        {error && !action && <Notice tone="error">{error}</Notice>}

        {creating && (
          <Card title="Новый пользователь" subtitle="Логин и пароль передайте человеку лично. Пароль он сможет сменить в настройках.">
            <form onSubmit={create} className={formClass}>
              <FormGrid cols={4}>
                <Field label="Логин" hint="Латиница, цифры, . _ - @ +">
                  {(id) => <Input id={id} value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required autoComplete="off" />}
                </Field>
                <Field label="Имя">{(id) => <Input id={id} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />}</Field>
                <Field label="Пароль" hint="Не короче 8 символов">
                  {(id) => (
                    <Input id={id} type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} autoComplete="new-password" />
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
                <Button type="button" variant="ghost" onClick={() => setForm({ ...form, password: randomPassword() })}>
                  Сгенерировать пароль
                </Button>
                <Button type="submit" variant="primary" loading={busy}>
                  Создать
                </Button>
              </FormActions>
            </form>
          </Card>
        )}

        <div className={styles.toolbar}>
          <Segmented
            label="Показать"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "Все", count: counts.all },
              { value: "organizers", label: "Организаторы", count: counts.organizers },
              { value: "judges", label: "Судьи", count: counts.judges },
              { value: "blocked", label: "Заблокированные", count: counts.blocked },
            ]}
          />
          <SearchField value={search} onChange={setSearch} label="Поиск пользователя" placeholder="Имя или логин" />
        </div>

        <Card flush>
          {list.loading ? (
            <Loading />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : !shown.length ? (
            <Empty icon="users" title={users.length ? "Никого не найдено" : "Пользователей нет"} />
          ) : (
            <Table
              head={
                <tr>
                  <th>Пользователь</th>
                  <th>Роль</th>
                  <th>Статус</th>
                  <th>Активность</th>
                  <th className={styles.actionsHead}>Действия</th>
                </tr>
              }
            >
              {shown.map((u) => (
                <tr key={u.id} className={u.blocked_at ? styles.blockedRow : undefined}>
                  <td>
                    <div className={styles.person}>
                      <span className={`${styles.avatar} ${isAdmin(u) ? styles.avatarAdmin : ""}`} aria-hidden>
                        {isAdmin(u) ? <Icon name="shield" size={16} /> : initials(u.display_name)}
                      </span>
                      <span>
                        <strong>{u.display_name}</strong>
                        <span className={styles.login}>{u.login}</span>
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className={styles.roles}>
                      {u.roles.length ? u.roles.map((r) => <Badge key={r} tone={r === "owner" ? "info" : "neutral"}>{ROLE_NAME[r] ?? r}</Badge>) : <span className={styles.muted}>—</span>}
                    </div>
                  </td>
                  <td>
                    {u.blocked_at ? (
                      <>
                        <Badge tone="danger">Заблокирован</Badge>
                        <span className={styles.sub}>
                          {formatDateTime(u.blocked_at)}
                          {u.blocked_reason ? ` · ${u.blocked_reason}` : ""}
                        </span>
                      </>
                    ) : (
                      <Badge tone="success">Активен</Badge>
                    )}
                  </td>
                  <td>
                    <span className={styles.sub}>Вход: {u.last_login_at ? formatDateTime(u.last_login_at) : "ещё не входил"}</span>
                    <span className={styles.sub}>
                      Турниров: {u.tournaments} · судейств: {u.matches_officiated}
                    </span>
                  </td>
                  <td>
                    {isAdmin(u) ? (
                      <span className={styles.muted}>Меняется только на сервере</span>
                    ) : (
                      <div className={styles.actions}>
                        <Button size="sm" variant="ghost" onClick={() => open("password", u)} title="Задать новый пароль">
                          <Icon name="lock" size={16} />
                          Пароль
                        </Button>
                        {u.blocked_at ? (
                          <Button size="sm" onClick={() => open("unblock", u)}>
                            <Icon name="check" size={16} />
                            Разблокировать
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => open("block", u)}>
                            <Icon name="lock" size={16} />
                            Заблокировать
                          </Button>
                        )}
                        <Button size="sm" variant="danger" onClick={() => open("delete", u)} aria-label={`Удалить ${u.display_name}`} title="Удалить аккаунт">
                          <Icon name="trash" size={16} />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </Stack>

      <ConfirmDialog
        open={action?.kind === "block"}
        title="Заблокировать пользователя?"
        confirmLabel="Заблокировать"
        confirmVariant="danger"
        busy={busy}
        onClose={close}
        onConfirm={() => run(() => api.post(`/users/${target!.id}/block`, { reason: reason || undefined }), `${target!.display_name}: аккаунт заблокирован`)}
      >
        {error && action && <Notice tone="error">{error}</Notice>}
        <DialogText>
          <strong>{target?.display_name}</strong> ({target?.login}) сразу выйдет со всех устройств и не сможет войти, пока вы его не разблокируете. Турниры, поединки и журнал
          сохраняются.
        </DialogText>
        <Field label="Причина" optional>
          {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Например: нарушение правил площадки" />}
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={action?.kind === "unblock"}
        title="Разблокировать пользователя?"
        confirmLabel="Разблокировать"
        busy={busy}
        onClose={close}
        onConfirm={() => run(() => api.post(`/users/${target!.id}/unblock`), `${target!.display_name}: аккаунт разблокирован`)}
      >
        {error && action && <Notice tone="error">{error}</Notice>}
        <DialogText>
          <strong>{target?.display_name}</strong> снова сможет входить со своим паролем.
        </DialogText>
      </ConfirmDialog>

      <ConfirmDialog
        open={action?.kind === "password"}
        title="Новый пароль"
        confirmLabel="Сохранить пароль"
        confirmDisabled={newPassword.length < 8}
        busy={busy}
        onClose={close}
        onConfirm={() => run(() => api.post(`/users/${target!.id}/password`, { password: newPassword }), `${target!.display_name}: пароль изменён. Передайте его пользователю лично.`)}
      >
        {error && action && <Notice tone="error">{error}</Notice>}
        <DialogText>
          Для <strong>{target?.display_name}</strong> ({target?.login}). Старый пароль перестанет работать, все сеансы пользователя завершатся.
        </DialogText>
        <Field label="Пароль" hint="Не короче 8 символов. Скопируйте его до сохранения.">
          {(id) => (
            <div className={styles.passwordRow}>
              <Input id={id} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="off" spellCheck={false} />
              <Button type="button" size="sm" variant="ghost" onClick={() => setNewPassword(randomPassword())}>
                Другой
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(newPassword)}>
                <Icon name="copy" size={16} />
              </Button>
            </div>
          )}
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={action?.kind === "delete"}
        title="Удалить аккаунт?"
        confirmLabel="Удалить навсегда"
        confirmVariant="danger"
        confirmDisabled={confirmLogin.trim().toLowerCase() !== target?.login.toLowerCase()}
        busy={busy}
        onClose={close}
        onConfirm={() =>
          run(() => api.del(`/users/${target!.id}?confirmLogin=${encodeURIComponent(confirmLogin.trim())}`), `Аккаунт ${target!.login} удалён`)
        }
      >
        {error && action && <Notice tone="error">{error}</Notice>}
        <DialogText>
          Аккаунт <strong>{target?.display_name}</strong> нельзя будет восстановить: логин и имя удаляются, войти больше не получится. Поединки и журнал остаются, в них он будет
          показан как «Удалённый пользователь».
        </DialogText>
        <Field label={`Введите логин «${target?.login ?? ""}» для подтверждения`}>
          {(id) => <Input id={id} value={confirmLogin} onChange={(e) => setConfirmLogin(e.target.value)} autoComplete="off" spellCheck={false} />}
        </Field>
      </ConfirmDialog>
    </>
  );
}
