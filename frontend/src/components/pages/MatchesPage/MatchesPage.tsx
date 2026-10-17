"use client";

import { useState } from "react";
import { Card } from "@/src/components/ui/Card/Card";
import { Field, Select } from "@/src/components/ui/Form/Form";
import { ErrorState, Loading } from "@/src/components/ui/Notice/Notice";
import { PageHeader } from "@/src/components/ui/PageHeader/PageHeader";
import { MatchTable } from "@/src/components/widgets/MatchTable/MatchTable";
import { STATUS_LABEL } from "@/src/lib/format";
import type { MatchListItem, MatchStatus } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";

export function MatchesPage() {
  const [status, setStatus] = useState<MatchStatus | "">("");
  const list = useResource<MatchListItem[]>(`/matches${status ? `?status=${status}` : ""}`);
  return (
    <>
      <PageHeader eyebrow="Соревнования" title="Поединки" description="Поединки создаются в карточке турнира" />
      <Card
        flush
        actions={
          <Field label="Статус">
            {(id) => (
              <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as MatchStatus | "")}>
                <option value="">Все</option>
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        }
      >
        {list.loading ? <Loading /> : list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : <MatchTable matches={list.data ?? []} />}
      </Card>
    </>
  );
}
