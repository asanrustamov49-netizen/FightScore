"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ButtonLink } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { SearchField } from "@/src/components/ui/Form/Form";
import { Icon } from "@/src/components/ui/Icon/Icon";
import { ErrorState, Loading } from "@/src/components/ui/Notice/Notice";
import { PageHeader, Stack, Toolbar } from "@/src/components/ui/PageHeader/PageHeader";
import { Segmented } from "@/src/components/ui/Tabs/Tabs";
import { MatchTable } from "@/src/components/widgets/MatchTable/MatchTable";
import { STATUS_LABEL } from "@/src/lib/format";
import { useSession } from "@/src/lib/session";
import type { MatchListItem, MatchStatus } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";

const STATUSES = Object.keys(STATUS_LABEL) as MatchStatus[];

export function MatchesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams();
  const { me } = useSession();
  const raw = query.get("status");
  const status: MatchStatus | "" = raw && (STATUSES as string[]).includes(raw) ? (raw as MatchStatus) : "";
  const [search, setSearch] = useState("");
  const list = useResource<MatchListItem[]>(`/matches${status ? `?status=${status}` : ""}`);
  // The filter lives in the URL, so dashboard tiles can link straight to "live" or "ready" matches.
  const setStatus = (s: MatchStatus | "") => router.replace(s ? `${pathname}?status=${s}` : pathname, { scroll: false });
  const needle = search.trim().toLowerCase();
  const shown = (list.data ?? []).filter(
    (m) => !needle || `${m.match_number} ${m.red_name ?? ""} ${m.blue_name ?? ""} ${m.tournament_name}`.toLowerCase().includes(needle),
  );

  return (
    <>
      <PageHeader
        title="Поединки"
        description="Все поединки доступных вам турниров. Новый поединок создаётся на странице турнира, во вкладке «Поединки»."
        actions={
          me?.capabilities.organizer && (
            <ButtonLink href="/tournaments">
              <Icon name="trophy" size={18} />
              К турнирам
            </ButtonLink>
          )
        }
      />
      <Stack>
        <Toolbar>
          <Segmented
            label="Статус поединка"
            value={status}
            onChange={setStatus}
            options={[{ value: "" as MatchStatus | "", label: "Все" }, ...STATUSES.map((s) => ({ value: s as MatchStatus | "", label: STATUS_LABEL[s] }))]}
          />
          <SearchField label="Поиск по номеру, спортсмену или турниру" placeholder="Номер, спортсмен или турнир" value={search} onChange={setSearch} />
        </Toolbar>
        <Card flush>
          {list.loading ? (
            <Loading />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : (
            <MatchTable
              matches={shown}
              emptyText={needle || status ? "Поединков с такими условиями нет" : "Поединков пока нет"}
              emptyHint={needle || status ? "Измените фильтр или поисковый запрос." : "Поединки создаются на странице турнира."}
            />
          )}
        </Card>
      </Stack>
    </>
  );
}
