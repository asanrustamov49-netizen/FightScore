"use client";

import Link from "next/link";
import { Badge, TournamentStatusBadge } from "@/src/components/ui/Badge/Badge";
import { ButtonLink } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { Icon } from "@/src/components/ui/Icon/Icon";
import { CardFacts, LinkCard } from "@/src/components/ui/LinkCard/LinkCard";
import { Empty, ErrorState, Notice, PageSkeleton } from "@/src/components/ui/Notice/Notice";
import { CardGrid, Columns, MetaItem, PageHeader, Stack } from "@/src/components/ui/PageHeader/PageHeader";
import { LinkRow, RowLink, Table } from "@/src/components/ui/Table/Table";
import { MatchTable } from "@/src/components/widgets/MatchTable/MatchTable";
import { StatTiles } from "@/src/components/widgets/StatTiles/StatTiles";
import { Tip } from "@/src/components/ui/Tip/Tip";
import { Welcome } from "@/src/components/widgets/Welcome/Welcome";
import type { IconName } from "@/src/components/ui/Icon/Icon";
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

  if (tournaments.loading || matches.loading) return <PageSkeleton cards={4} />;
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
  const firstVisit = canCreate && (tournaments.data ?? []).length === 0;
  const nextStep = canCreate ? nextStepFor(tournaments.data ?? []) : null;

  // New organizer: one clear action instead of empty tables and zero counters.
  if (firstVisit) {
    return (
      <Stack>
        <Welcome name={me?.user.displayName ?? ""} />
        {live.length > 0 && (
          <Card title="Идут сейчас" subtitle="Поединки, которые ведут судьи или которые ждут подтверждения итога" flush>
            <MatchTable matches={live} />
          </Card>
        )}

        {mine.length > 0 && (
          <Card title="Мои поединки как судьи" subtitle="«Судейство» открывает панель управления поединком" flush>
            <MatchTable matches={mine} />
          </Card>
        )}
      </Stack>
    );
  }

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
        {nextStep && (
          <section className={styles.next} aria-label="Следующий шаг">
            <span className={styles.nextIcon} aria-hidden>
              <Icon name={nextStep.icon} size={22} />
            </span>
            <div className={styles.nextText}>
              <span className={styles.nextKicker}>Следующий шаг · {nextStep.tournament}</span>
              <strong>{nextStep.title}</strong>
              <span>{nextStep.text}</span>
            </div>
            <ButtonLink href={nextStep.href} variant="primary">
              {nextStep.action}
              <Icon name="arrow" size={17} />
            </ButtonLink>
          </section>
        )}
        {canCreate && (
          <Tip id="dashboard" title="Обзор — ваша стартовая точка">
            Здесь видно, что идёт сейчас, что ждёт старта и какой шаг подготовки следующий. Карточки и строки открывают подробности.
          </Tip>
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
          <Card title="Ожидают старта" actions={<Link href="/matches">Все поединки</Link>} flush>
            <MatchTable
              matches={upcoming.slice(0, 10)}
              emptyText="Нет поединков, ожидающих старта"
              emptyHint={canCreate ? "Поединки создаются на странице турнира во вкладке «Поединки»." : undefined}
            />
          </Card>
          <Stack>
            {canCreate && (
              <Card title="Быстрые действия">
                <nav className={styles.quick} aria-label="Быстрые действия">
                  {QUICK.map((q) => (
                    <Link key={q.href} href={q.href} className={styles.quickItem}>
                      <span className={styles.quickIcon} aria-hidden>
                        <Icon name={q.icon} size={18} />
                      </span>
                      <span>
                        <strong>{q.label}</strong>
                        <small>{q.text}</small>
                      </span>
                      <Icon name="chevron" size={16} className={styles.quickChevron} />
                    </Link>
                  ))}
                </nav>
              </Card>
            )}
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
          </Stack>
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

const QUICK: { href: string; label: string; text: string; icon: IconName }[] = [
  { href: "/tournaments?new=1", label: "Новый турнир", text: "Черновик можно дополнить позже", icon: "plus" },
  { href: "/athletes", label: "Спортсмены", text: "База участников для турниров", icon: "users" },
  { href: "/rules", label: "Профили правил", text: "Версии правил для поединков", icon: "book" },
  { href: "/settings", label: "Настройки", text: "Тема, плотность, пароль", icon: "settings" },
];

interface NextStep {
  tournament: string;
  title: string;
  text: string;
  action: string;
  href: string;
  icon: IconName;
}

/** What the nearest tournament still lacks, from the list counters the server returns. */
function nextStepFor(list: TournamentSummary[]): NextStep | null {
  const open = list.filter((t) => t.can_manage && !t.archived_at && t.status !== "completed").sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  for (const t of open) {
    const base = `/tournaments/${t.id}`;
    if (t.athletes_count < 2)
      return {
        tournament: t.name,
        title: "Зарегистрируйте участников",
        text: `В турнире ${t.athletes_count} из минимум двух спортсменов для поединка.`,
        action: "К участникам",
        href: `${base}?tab=athletes`,
        icon: "users",
      };
    if (t.matches_count === 0)
      return {
        tournament: t.name,
        title: "Создайте первый поединок",
        text: "Выберите спортсменов в красный и синий углы и версию правил.",
        action: "К поединкам",
        href: `${base}?tab=matches`,
        icon: "versus",
      };
    if (t.status === "draft")
      return {
        tournament: t.name,
        title: "Опубликуйте турнир",
        text: "Черновик виден только вам. После публикации турнир можно начать.",
        action: "Открыть турнир",
        href: base,
        icon: "check",
      };
  }
  return null;
}
