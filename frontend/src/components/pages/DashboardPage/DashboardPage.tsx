"use client";

import Link from "next/link";
import { ButtonLink } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { FormActions } from "@/src/components/ui/Form/Form";
import { Empty, ErrorState, Loading, Notice } from "@/src/components/ui/Notice/Notice";
import { BulletList, Columns, PageHeader, Stack } from "@/src/components/ui/PageHeader/PageHeader";
import { Table } from "@/src/components/ui/Table/Table";
import { MatchTable } from "@/src/components/widgets/MatchTable/MatchTable";
import { StatTiles } from "@/src/components/widgets/StatTiles/StatTiles";
import { formatDateTime } from "@/src/lib/format";
import { useSession } from "@/src/lib/session";
import type { DisplayItem, MatchListItem, Side, TournamentSummary } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";

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

  return (
    <>
      <PageHeader eyebrow="Обзор" title={`Здравствуйте, ${me?.user.displayName ?? ""}`} description="Текущее состояние соревнований" />
      <Stack>
        {me && !me.capabilities.organizer && !me.capabilities.judge && !me.capabilities.displays && (
          <Notice tone="info">
            У вашей учётной записи пока нет ролей. Организатор турнира может назначить вас судьёй или оператором табло — после этого здесь
            появятся ваши поединки.
          </Notice>
        )}
        {canCreate && (tournaments.data ?? []).length === 0 && (
          <Card title="Начните с турнира" subtitle="Три шага до первого поединка">
            <BulletList>
              <li>Создайте турнир и выберите дисциплины.</li>
              <li>Добавьте спортсменов и зарегистрируйте их в турнире, создайте учётные записи судей.</li>
              <li>Создайте поединок, назначьте судей и выведите его на табло.</li>
            </BulletList>
            <FormActions>
              <ButtonLink href="/tournaments?new=1" variant="primary">
                Создать первый турнир
              </ButtonLink>
            </FormActions>
          </Card>
        )}
        <StatTiles
          items={[
            { label: "Активные турниры", value: active.length },
            { label: "Идут сейчас", value: live.length, live: live.length > 0 },
            { label: "Ожидают старта", value: upcoming.length },
            { label: "Спортсменов в турнирах", value: athletes },
          ]}
        />
        {mine.length > 0 && (
          <Card title="Мои поединки как судьи" subtitle="Откройте судейскую панель, чтобы вести поединок">
            <MatchTable matches={mine} />
          </Card>
        )}
        <Columns>
          <Card title="Текущие и запланированные поединки" actions={<Link href="/matches">Все поединки</Link>} flush>
            <MatchTable matches={[...live, ...upcoming].slice(0, 10)} emptyText="Нет текущих и запланированных поединков" />
          </Card>
          <Stack>
            <Card title="Активные турниры" actions={<Link href="/tournaments">Все</Link>}>
              {active.length ? (
                <BulletList>
                  {active.map((t) => (
                    <li key={t.id}>
                      <Link href={`/tournaments/${t.id}`}>{t.name}</Link> — {t.matches_count} поед.
                    </li>
                  ))}
                </BulletList>
              ) : (
                <Empty title="Активных турниров нет" />
              )}
            </Card>
            {me?.capabilities.displays && (
              <Card title="Табло" actions={<Link href="/displays">Управление</Link>}>
                {displays.data?.length ? (
                  <BulletList>
                    {displays.data.map((d) => (
                      <li key={d.id}>
                        {d.name}: {d.match_number ? `поединок №${d.match_number}` : "поединок не выбран"}
                      </li>
                    ))}
                  </BulletList>
                ) : (
                  <Empty title="Табло не настроены" />
                )}
              </Card>
            )}
          </Stack>
        </Columns>
        <Card title="Недавние результаты" flush>
          {results.data?.length ? (
            <Table
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
                  <tr key={r.id}>
                    <td>
                      <Link href={`/matches/${r.id}`}>№{r.match_number}</Link> · {r.tournament_name}
                    </td>
                    <td>{w ? `${w.last_name} ${w.first_name}` : "—"}</td>
                    <td>{r.definition.endMethods.find((e) => e.code === r.outcome_code)?.label ?? r.outcome_code}</td>
                    <td>{formatDateTime(r.confirmed_at)}</td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <Empty title="Подтверждённых результатов пока нет" />
          )}
        </Card>
      </Stack>
    </>
  );
}
