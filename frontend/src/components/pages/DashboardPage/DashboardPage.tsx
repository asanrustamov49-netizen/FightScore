"use client";

import Link from "next/link";
import { Badge, TournamentStatusBadge } from "@/src/components/ui/Badge/Badge";
import { ButtonLink } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { Icon } from "@/src/components/ui/Icon/Icon";
import { CardFacts, LinkCard } from "@/src/components/ui/LinkCard/LinkCard";
import { Empty, ErrorState, Loading, Notice } from "@/src/components/ui/Notice/Notice";
import { CardGrid, Columns, MetaItem, PageHeader, Stack } from "@/src/components/ui/PageHeader/PageHeader";
import { LinkRow, RowLink, Table } from "@/src/components/ui/Table/Table";
import { MatchTable } from "@/src/components/widgets/MatchTable/MatchTable";
import { StatTiles } from "@/src/components/widgets/StatTiles/StatTiles";
import { dateRange, formatDateTime } from "@/src/lib/format";
import { useSession } from "@/src/lib/session";
import type { DisplayItem, MatchListItem, Side, TournamentSummary } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";
import styles from "./DashboardPage.module.scss";

interface ResultRow {
  id: string;
  match_number: number;
  tournament_name: string;
  winner_side: Side | null;
  outcome_code: string;
  confirmed_at: string;
  participants_snapshot: { side: Side; first_name: string; last_name: string }[];
  definition: { endMethods: { code: string; label: string }[] };
}

export function DashboardPage() {
  const { me, can } = useSession();
  const tournaments = useResource<TournamentSummary[]>("/tournaments");
  const matches = useResource<MatchListItem[]>("/matches");
  const results = useResource<ResultRow[]>("/results");
  const displays = useResource<DisplayItem[]>(me?.capabilities.displays ? "/displays" : null);
  const canCreate = can("tournament.manage") || can("tournament.create");

  if (tournaments.loading || matches.loading) return <Loading />;
  if (tournaments.error || matches.error) {
    return <ErrorState message={tournaments.error ?? matches.error ?? ""} onRetry={() => (tournaments.reload(), matches.reload())} />;
  }
  const active = (tournaments.data ?? []).filter((t) => !t.archived_at && t.status !== "completed");
  const all = matches.data ?? [];
  const live = all.filter((m) => m.status === "live" || m.status === "awaiting_confirmation");
  const upcoming = all.filter((m) => m.status === "ready" || m.status === "prepared");
  const mine = all.filter((m) => m.is_official && m.status !== "completed" && m.status !== "cancelled");
  const athletes = active.reduce((n, t) => n + t.athletes_count, 0);
  const noRoles = me && !me.capabilities.organizer && !me.capabilities.judge && !me.capabilities.displays;

  return (
    <>
      <PageHeader
        title={`Здравствуйте, ${me?.user.displayName ?? ""}`}
        description="Текущее состояние соревнований. Нажмите на карточку или строку, чтобы открыть подробности."
        actions={
          canCreate && (
            <ButtonLink href="/tournaments?new=1" variant="primary">
              <Icon name="plus" size={18} />
              Новый турнир
            </ButtonLink>
          )
        }
      />
      <Stack>
        {noRoles && (
          <Notice tone="info" title="У вашей учётной записи пока нет ролей">
            Организатор турнира может назначить вас судьёй или оператором табло — после этого здесь появятся ваши поединки.
          </Notice>
        )}
        {canCreate && (tournaments.data ?? []).length === 0 && (
          <Card>
            <Empty
              icon="trophy"
              title="Начните с турнира"
              action={
                <>
                  <ButtonLink href="/tournaments?new=1" variant="primary">
                    Создать первый турнир
                  </ButtonLink>
                  <ButtonLink href="/rules">Посмотреть правила</ButtonLink>
                </>
              }
            >
              Создайте турнир и выберите дисциплины. Затем добавьте спортсменов, судей и поединки и выведите поединок на табло.
            </Empty>
          </Card>
        )}

        <StatTiles
          items={[
            { label: "Активные турниры", value: active.length, href: "/tournaments" },
            { label: "Идут сейчас", value: live.length, live: live.length > 0, href: "/matches?status=live" },
            { label: "Ожидают старта", value: upcoming.length, href: "/matches?status=ready" },
            { label: "Спортсменов в турнирах", value: athletes },
          ]}
        />

        {mine.length > 0 && (
          <Card title="Мои поединки как судьи" subtitle="«Судейство» открывает панель управления поединком" flush>
            <MatchTable matches={mine} />
          </Card>
        )}

        {active.length > 0 && (
          <section className={styles.section} aria-labelledby="active-tournaments">
            <div className={styles.sectionHead}>
              <h2 id="active-tournaments">Активные турниры</h2>
              <Link href="/tournaments">Все турниры</Link>
            </div>
            <CardGrid min={280}>
              {active.slice(0, 6).map((t) => (
                <LinkCard
                  key={t.id}
                  href={`/tournaments/${t.id}`}
                  title={t.name}
                  accent={t.live_count > 0 ? "live" : undefined}
                  badges={
                    <>
                      <TournamentStatusBadge status={t.status} />
                      {t.live_count > 0 && <Badge tone="live">{t.live_count} идёт</Badge>}
                    </>
                  }
                >
                  <div className={styles.meta}>
                    <MetaItem icon="calendar">{dateRange(t.starts_on, t.ends_on)}</MetaItem>
                    {t.venue && <MetaItem icon="pin">{t.venue}</MetaItem>}
                  </div>
                  <CardFacts
                    items={[
                      { label: "Участники", value: t.athletes_count },
                      { label: "Поединки", value: t.matches_count },
                    ]}
                  />
                </LinkCard>
              ))}
            </CardGrid>
          </section>
        )}

        <Columns>
          <Card title="Текущие и запланированные поединки" actions={<Link href="/matches">Все поединки</Link>} flush>
            <MatchTable
              matches={[...live, ...upcoming].slice(0, 10)}
              emptyText="Нет текущих и запланированных поединков"
              emptyHint={canCreate ? "Поединки создаются на странице турнира во вкладке «Поединки»." : undefined}
            />
          </Card>
          {me?.capabilities.displays ? (
            <Card title="Табло" actions={<Link href="/displays">Управление</Link>} flush>
              {displays.data?.length ? (
                <ul className={styles.displays}>
                  {displays.data.map((d) => (
                    <li key={d.id}>
                      <Icon name="display" size={20} />
                      <div>
                        <strong>{d.name}</strong>
                        <span>{d.match_number ? `Показывает поединок №${d.match_number}` : "Поединок не выбран"}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty icon="display" title="Табло не настроены" action={<ButtonLink href="/displays">Создать табло</ButtonLink>}>
                  Табло — публичная страница для ТВ, открывается по ссылке без входа.
                </Empty>
              )}
            </Card>
          ) : (
            <Card title="Как это работает">
              <ol className={styles.howto}>
                <li>Организатор создаёт турнир, участников и поединки.</li>
                <li>Судья ведёт поединок в судейской панели — сервер подтверждает каждое действие.</li>
                <li>Табло на ТВ обновляется само, без перезагрузки.</li>
              </ol>
            </Card>
          )}
        </Columns>

        <Card title="Недавние результаты" flush>
          {results.data?.length ? (
            <Table
              caption="Недавние результаты"
              head={
                <tr>
                  <th>Поединок</th>
                  <th>Победитель</th>
                  <th>Итог</th>
                  <th>Подтверждён</th>
                </tr>
              }
            >
              {results.data.slice(0, 8).map((r) => {
                const w = r.participants_snapshot.find((p) => p.side === r.winner_side);
                return (
                  <LinkRow key={r.id}>
                    <td>
                      <RowLink href={`/matches/${r.id}`}>№{r.match_number}</RowLink>
                      <div className={styles.sub}>{r.tournament_name}</div>
                    </td>
                    <td>{w ? `${w.last_name} ${w.first_name}` : "—"}</td>
                    <td>{r.definition.endMethods.find((e) => e.code === r.outcome_code)?.label ?? r.outcome_code}</td>
                    <td>{formatDateTime(r.confirmed_at)}</td>
                  </LinkRow>
                );
              })}
            </Table>
          ) : (
            <Empty icon="trophy" title="Подтверждённых результатов пока нет">
              Результат появляется после того, как главный судья подтвердит итог поединка.
            </Empty>
          )}
        </Card>
      </Stack>
    </>
  );
}
