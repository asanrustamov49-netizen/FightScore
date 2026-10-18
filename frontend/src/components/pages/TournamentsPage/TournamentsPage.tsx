"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, TournamentStatusBadge } from "@/src/components/ui/Badge/Badge";
import { Button, ButtonLink } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { SearchField } from "@/src/components/ui/Form/Form";
import { Icon } from "@/src/components/ui/Icon/Icon";
import { CardFacts, LinkCard } from "@/src/components/ui/LinkCard/LinkCard";
import { Empty, ErrorState, Loading } from "@/src/components/ui/Notice/Notice";
import { CardGrid, MetaItem, PageHeader, Stack, Toolbar } from "@/src/components/ui/PageHeader/PageHeader";
import { Segmented } from "@/src/components/ui/Tabs/Tabs";
import { useToast } from "@/src/components/ui/Toast/Toast";
import { TournamentForm } from "@/src/components/widgets/TournamentForm/TournamentForm";
import { api } from "@/src/lib/api";
import { dateRange } from "@/src/lib/format";
import { useSession } from "@/src/lib/session";
import type { Discipline, TournamentSummary } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";
import styles from "./TournamentsPage.module.scss";

type Filter = "current" | "draft" | "completed" | "archived" | "all";

const MATCHES: Record<Filter, (t: TournamentSummary) => boolean> = {
  current: (t) => !t.archived_at && (t.status === "scheduled" || t.status === "active"),
  draft: (t) => !t.archived_at && t.status === "draft",
  completed: (t) => !t.archived_at && t.status === "completed",
  archived: (t) => !!t.archived_at,
  all: () => true,
};

export function TournamentsPage() {
  const router = useRouter();
  const toast = useToast();
  const { can } = useSession();
  const list = useResource<TournamentSummary[]>("/tournaments");
  const disciplines = useResource<Discipline[]>("/disciplines");
  const query = useSearchParams();
  const canCreate = can("tournament.manage") || can("tournament.create");
  const [creating, setCreating] = useState(() => query.get("new") === "1");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const all = useMemo(() => list.data ?? [], [list.data]);
  const counts = useMemo(
    () => Object.fromEntries((Object.keys(MATCHES) as Filter[]).map((f) => [f, all.filter(MATCHES[f]).length])) as Record<Filter, number>,
    [all],
  );
  const shown = all.filter(MATCHES[filter]).filter((t) => !search.trim() || `${t.name} ${t.venue ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <>
      <PageHeader
        title="Турниры"
        description="Откройте турнир, чтобы управлять участниками, поединками, судьями и результатами."
        actions={
          canCreate &&
          !creating && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={18} />
              Новый турнир
            </Button>
          )
        }
      />
      <Stack>
        {creating && disciplines.data && (
          <Card title="Новый турнир" subtitle="Начните с черновика и дополняйте его. Когда всё будет готово, опубликуйте турнир на его странице.">
            <TournamentForm
              mode="create"
              disciplines={disciplines.data}
              onCancel={() => setCreating(false)}
              onSubmit={async (v) => {
                const t = await api.post<{ id: string }>("/tournaments", { ...v, venue: v.venue || null });
                toast(v.status === "draft" ? "Черновик турнира сохранён" : "Турнир создан и опубликован");
                router.push(`/tournaments/${t.id}`);
              }}
            />
          </Card>
        )}

        {all.length > 0 && (
          <Toolbar>
            <Segmented
              label="Фильтр турниров"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "Все", count: counts.all },
                { value: "current", label: "Текущие", count: counts.current },
                { value: "draft", label: "Черновики", count: counts.draft },
                { value: "completed", label: "Завершённые", count: counts.completed },
                { value: "archived", label: "Архив", count: counts.archived },
              ]}
            />
            <SearchField label="Поиск по названию или месту" value={search} onChange={setSearch} />
          </Toolbar>
        )}

        {list.loading ? (
          <Loading />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !all.length ? (
          <Card>
            <Empty
              icon="trophy"
              title="Турниров пока нет"
              action={
                canCreate && !creating ? (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    <Icon name="plus" size={18} />
                    Создать первый турнир
                  </Button>
                ) : undefined
              }
            >
              {canCreate
                ? "Создайте турнир, выберите дисциплины, затем добавьте участников, судей и поединки."
                : "Вам пока не открыт доступ ни к одному турниру. Организатор может назначить вас судьёй."}
            </Empty>
          </Card>
        ) : !shown.length ? (
          <Card>
            <Empty icon="search" title="Ничего не найдено" action={<Button onClick={() => (setFilter("all"), setSearch(""))}>Сбросить фильтры</Button>}>
              Измените фильтр или поисковый запрос.
            </Empty>
          </Card>
        ) : (
          <CardGrid min={300}>
            {shown.map((t) => (
              <LinkCard
                key={t.id}
                href={`/tournaments/${t.id}`}
                title={t.name}
                accent={t.live_count > 0 ? "live" : t.archived_at ? "muted" : undefined}
                badges={
                  <>
                    <TournamentStatusBadge status={t.status} archived={!!t.archived_at} />
                    {t.live_count > 0 && <Badge tone="live">{t.live_count} идёт</Badge>}
                  </>
                }
                actions={
                  <>
                    <ButtonLink href={`/tournaments/${t.id}`} size="sm" variant="primary">
                      Открыть
                    </ButtonLink>
                    <ButtonLink href={`/tournaments/${t.id}?tab=matches`} size="sm" variant="ghost">
                      Поединки
                    </ButtonLink>
                    {t.can_manage && !t.archived_at && (
                      <ButtonLink href={`/tournaments/${t.id}?edit=1`} size="sm" variant="ghost">
                        <Icon name="edit" size={16} />
                        Редактировать
                      </ButtonLink>
                    )}
                  </>
                }
              >
                <div className={styles.meta}>
                  <MetaItem icon="calendar">{dateRange(t.starts_on, t.ends_on)}</MetaItem>
                  {t.venue && <MetaItem icon="pin">{t.venue}</MetaItem>}
                  {t.disciplines && <MetaItem icon="versus">{t.disciplines}</MetaItem>}
                </div>
                <CardFacts
                  items={[
                    { label: "Участники", value: t.athletes_count },
                    { label: "Поединки", value: t.matches_count },
                    { label: "Завершено", value: t.completed_count },
                  ]}
                />
              </LinkCard>
            ))}
          </CardGrid>
        )}
      </Stack>
    </>
  );
}
