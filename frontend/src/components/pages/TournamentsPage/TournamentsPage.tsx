"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/src/components/ui/Badge/Badge";
import { Button } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { Empty, ErrorState, Loading } from "@/src/components/ui/Notice/Notice";
import { PageHeader, Stack } from "@/src/components/ui/PageHeader/PageHeader";
import { Table, tableStyles } from "@/src/components/ui/Table/Table";
import { TournamentForm } from "@/src/components/widgets/TournamentForm/TournamentForm";
import { api } from "@/src/lib/api";
import { formatDate, TOURNAMENT_STATUS_LABEL } from "@/src/lib/format";
import { useSession } from "@/src/lib/session";
import type { Discipline, TournamentSummary } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";

export function TournamentsPage() {
  const router = useRouter();
  const { can } = useSession();
  const list = useResource<TournamentSummary[]>("/tournaments");
  const disciplines = useResource<Discipline[]>("/disciplines");
  const query = useSearchParams();
  const canCreate = can("tournament.manage") || can("tournament.create");
  const [creating, setCreating] = useState(() => query.get("new") === "1");

  return (
    <>
      <PageHeader
        eyebrow="Соревнования"
        title="Турниры"
        actions={canCreate && !creating && <Button variant="primary" onClick={() => setCreating(true)}>Новый турнир</Button>}
      />
      <Stack>
        {creating && disciplines.data && (
          <Card title="Новый турнир">
            <TournamentForm
              disciplines={disciplines.data}
              submitLabel="Создать турнир"
              onCancel={() => setCreating(false)}
              onSubmit={async (v) => {
                const t = await api.post<{ id: string }>("/tournaments", { ...v, venue: v.venue || null });
                router.push(`/tournaments/${t.id}`);
              }}
            />
          </Card>
        )}
        <Card flush>
          {list.loading ? (
            <Loading />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : !list.data?.length ? (
            <Empty title="Турниров пока нет">{canCreate ? "Создайте первый турнир кнопкой выше." : "Вам пока не открыт доступ ни к одному турниру."}</Empty>
          ) : (
            <Table
              head={
                <tr>
                  <th>Название</th>
                  <th>Даты</th>
                  <th>Статус</th>
                  <th className={tableStyles.num}>Спортсмены</th>
                  <th className={tableStyles.num}>Поединки</th>
                </tr>
              }
            >
              {list.data.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/tournaments/${t.id}`}>{t.name}</Link>
                    {t.venue && <div className={tableStyles.muted}>{t.venue}</div>}
                  </td>
                  <td>
                    {formatDate(t.starts_on)}
                    {t.ends_on !== t.starts_on && ` — ${formatDate(t.ends_on)}`}
                  </td>
                  <td>
                    {t.archived_at ? <Badge>В архиве</Badge> : <Badge tone={t.status === "active" ? "success" : "neutral"}>{TOURNAMENT_STATUS_LABEL[t.status]}</Badge>}{" "}
                    {t.live_count > 0 && <Badge tone="live">{t.live_count} идёт</Badge>}
                  </td>
                  <td className={tableStyles.num}>{t.athletes_count}</td>
                  <td className={tableStyles.num}>{t.matches_count}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </Stack>
    </>
  );
}
