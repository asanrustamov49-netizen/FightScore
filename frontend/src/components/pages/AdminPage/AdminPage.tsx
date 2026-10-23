"use client";

import { Badge } from "@/src/components/ui/Badge/Badge";
import { ButtonLink } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { Icon } from "@/src/components/ui/Icon/Icon";
import { Empty, ErrorState, Loading } from "@/src/components/ui/Notice/Notice";
import { PageHeader, Stack } from "@/src/components/ui/PageHeader/PageHeader";
import { Table } from "@/src/components/ui/Table/Table";
import { StatTiles } from "@/src/components/widgets/StatTiles/StatTiles";
import { formatDateTime } from "@/src/lib/format";
import { useResource } from "@/src/lib/use-resource";
import styles from "./AdminPage.module.scss";

interface Overview {
  users: number;
  blocked: number;
  online: number;
  tournaments: number;
  live_matches: number;
  matches: number;
  failed_logins_24h: number;
}

interface AuditRow {
  id: string;
  occurred_at: string;
  action: string;
  entity_type: string;
  data: Record<string, unknown>;
  ip: string | null;
  actor: string | null;
}

/** Human names for audit actions; anything else is shown by its code. */
const ACTION: Record<string, { label: string; tone?: "danger" | "warning" | "success" | "info" }> = {
  "auth.login": { label: "Вход" },
  "auth.logout": { label: "Выход" },
  "auth.login_failed": { label: "Неудачный вход", tone: "warning" },
  "auth.admin_login": { label: "Вход администратора", tone: "info" },
  "auth.admin_login_failed": { label: "Неудачный вход администратора", tone: "danger" },
  "auth.register": { label: "Регистрация организатора", tone: "success" },
  "auth.password_change": { label: "Смена пароля" },
  "user.create": { label: "Создан пользователь", tone: "success" },
  "user.block": { label: "Заблокирован пользователь", tone: "danger" },
  "user.unblock": { label: "Разблокирован пользователь", tone: "success" },
  "user.password_reset": { label: "Новый пароль пользователю", tone: "warning" },
  "user.delete": { label: "Удалён пользователь", tone: "danger" },
  "admin.created": { label: "Создан администратор (сервер)", tone: "info" },
  "admin.credentials_reset": { label: "Новый пароль администратора (сервер)", tone: "warning" },
  "auth.profile_update": { label: "Изменено имя профиля" },
  "athlete.create": { label: "Добавлен спортсмен" },
  "athlete.update": { label: "Изменён спортсмен" },
  "tournament.create": { label: "Создан турнир", tone: "success" },
  "tournament.update": { label: "Изменён турнир" },
  "tournament.archive": { label: "Турнир в архиве" },
  "tournament.unarchive": { label: "Турнир из архива" },
  "tournament.create_judge": { label: "Создан судья турнира" },
  "tournament.register_athlete": { label: "Спортсмен зарегистрирован" },
  "tournament.unregister_athlete": { label: "Регистрация спортсмена снята" },
  "match.create": { label: "Создан поединок" },
  "match.setup": { label: "Изменён состав поединка" },
  "match.officials": { label: "Назначены судьи" },
  "match.cancel": { label: "Поединок отменён", tone: "warning" },
  "bracket.create": { label: "Создана сетка" },
  "bracket.walkover": { label: "Победа без боя" },
  "display.create": { label: "Создано табло" },
  "display.assign": { label: "Табло переключено" },
  "display.rotate_token": { label: "Новая ссылка табло" },
  "rules.profile_create": { label: "Создан профиль правил" },
  "rules.profile_update": { label: "Изменён профиль правил" },
  "rules.profile_duplicate": { label: "Скопирован профиль правил" },
  "rules.profile_archive": { label: "Профиль правил в архиве" },
  "rules.profile_restore": { label: "Профиль правил восстановлен" },
  "rules.version_create": { label: "Черновик версии правил" },
  "rules.version_update": { label: "Изменена версия правил" },
  "rules.version_publish": { label: "Опубликована версия правил", tone: "success" },
  "rules.version_archive": { label: "Версия правил в архиве" },
  "rules.version_delete": { label: "Удалён черновик правил" },
};

function subject(r: AuditRow) {
  const login = typeof r.data?.login === "string" ? r.data.login : null;
  return login ?? (r.entity_type === "user" ? "" : r.entity_type);
}

/** Platform administrator's home: what is happening on the platform right now and who did what. */
export function AdminPage() {
  const overview = useResource<Overview>("/admin/overview");
  const audit = useResource<AuditRow[]>("/admin/audit?limit=60");
  const o = overview.data;

  return (
    <>
      <PageHeader
        eyebrow="Администратор платформы"
        title="Обзор платформы"
        description="Все организаторы, судьи и турниры. Блокировка и удаление аккаунтов — в разделе «Пользователи»."
        actions={
          <ButtonLink href="/admin/users" variant="primary">
            <Icon name="users" size={18} />
            Пользователи
          </ButtonLink>
        }
      />
      <Stack>
        {overview.error ? (
          <ErrorState message={overview.error} onRetry={overview.reload} />
        ) : !o ? (
          <Loading />
        ) : (
          <StatTiles
            items={[
              { label: "Пользователей", value: o.users, href: "/admin/users" },
              { label: "Сейчас в сети", value: o.online, live: o.online > 0 },
              { label: "Заблокировано", value: o.blocked, href: "/admin/users?status=blocked" },
              { label: "Турниров", value: o.tournaments, href: "/tournaments" },
              { label: "Идут поединки", value: o.live_matches, live: o.live_matches > 0, href: "/matches" },
              { label: "Неудачных входов за сутки", value: o.failed_logins_24h },
            ]}
          />
        )}

        <Card title="Журнал действий" actions={<span className={styles.hint}>Последние 60 записей · журнал нельзя изменить или удалить</span>} flush>
          {audit.loading ? (
            <Loading />
          ) : audit.error ? (
            <ErrorState message={audit.error} onRetry={audit.reload} />
          ) : !audit.data?.length ? (
            <Empty icon="history" title="Записей пока нет" />
          ) : (
            <Table
              head={
                <tr>
                  <th>Когда</th>
                  <th>Действие</th>
                  <th>Кто</th>
                  <th>Объект</th>
                  <th>IP</th>
                </tr>
              }
            >
              {audit.data.map((r) => {
                const a = ACTION[r.action];
                return (
                  <tr key={r.id}>
                    <td className={styles.nowrap}>{formatDateTime(r.occurred_at)}</td>
                    <td>{a?.tone ? <Badge tone={a.tone}>{a.label}</Badge> : (a?.label ?? <code>{r.action}</code>)}</td>
                    <td>{r.actor ?? <span className={styles.muted}>система</span>}</td>
                    <td>{subject(r) || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.muted}>{r.ip ?? "—"}</td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      </Stack>
    </>
  );
}
