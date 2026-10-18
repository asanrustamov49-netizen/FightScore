"use client";

import { useState } from "react";
import { Button } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { Flag } from "@/src/components/ui/Flag/Flag";
import { SearchField } from "@/src/components/ui/Form/Form";
import { Empty, ErrorState, Loading } from "@/src/components/ui/Notice/Notice";
import { PageHeader, Stack } from "@/src/components/ui/PageHeader/PageHeader";
import { Table, tableStyles } from "@/src/components/ui/Table/Table";
import { useToast } from "@/src/components/ui/Toast/Toast";
import { AthleteForm, athleteToInput } from "@/src/components/widgets/AthleteForm/AthleteForm";
import { api } from "@/src/lib/api";
import { formatDate, personName } from "@/src/lib/format";
import { useSession } from "@/src/lib/session";
import type { Athlete, Country } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";

export function AthletesPage() {
  const { can, me } = useSession();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const list = useResource<Athlete[]>("/athletes");
  const countries = useResource<Country[]>("/countries");
  const [editing, setEditing] = useState<Athlete | "new" | null>(null);
  const canCreate = can("athlete.manage") || !!me?.capabilities.organizer;
  const q = query.trim().toLowerCase();
  const visible = (list.data ?? []).filter((a) => !q || `${a.last_name} ${a.first_name} ${a.club_name ?? ""}`.toLowerCase().includes(q));

  return (
    <>
      <PageHeader
        title="Спортсмены"
        description="Имя, страна, клуб и год рождения. Дополнительные персональные данные не собираются."
        actions={canCreate && editing === null && <Button variant="primary" onClick={() => setEditing("new")}>Добавить спортсмена</Button>}
      />
      <Stack>
        {editing !== null && countries.data && (
          <Card title={editing === "new" ? "Новый спортсмен" : `Редактирование: ${personName(editing)}`}>
            <AthleteForm
              key={editing === "new" ? "new" : editing.id}
              countries={countries.data}
              initial={editing === "new" ? undefined : athleteToInput(editing)}
              submitLabel={editing === "new" ? "Добавить" : "Сохранить"}
              onCancel={() => setEditing(null)}
              onSubmit={async (v) => {
                if (editing === "new") await api.post("/athletes", v);
                else await api.put(`/athletes/${editing.id}`, v);
                toast(editing === "new" ? "Спортсмен добавлен в базу" : "Изменения сохранены");
                setEditing(null);
                await list.reload();
              }}
            />
          </Card>
        )}
        <Card flush title={`Всего: ${list.data?.length ?? 0}`} actions={<SearchField label="Поиск по фамилии, имени или клубу" placeholder="Фамилия, имя или клуб" value={query} onChange={setQuery} />}>
          {list.loading ? (
            <Loading />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : !visible.length ? (
            <Empty
              icon={q ? "search" : "users"}
              title={q ? "Никого не найдено" : "Спортсменов пока нет"}
              action={!q && canCreate && editing === null ? <Button variant="primary" onClick={() => setEditing("new")}>Добавить спортсмена</Button> : undefined}
            >
              {q ? "Измените запрос." : "Добавьте спортсменов в базу, затем зарегистрируйте их в турнире на его странице."}
            </Empty>
          ) : (
            <Table
              head={
                <tr>
                  <th>Спортсмен</th>
                  <th>Страна</th>
                  <th>Клуб</th>
                  <th>Рождение</th>
                  <th />
                </tr>
              }
            >
              {visible.map((a) => (
                <tr key={a.id}>
                  <td>{personName(a)}</td>
                  <td>
                    <Flag code={a.country_code} name={a.country_name} showName />
                  </td>
                  <td className={tableStyles.muted}>{a.club_name ?? "—"}</td>
                  <td>{a.birth_date ? formatDate(a.birth_date) : a.birth_year ?? "—"}</td>
                  <td>
                    {a.can_edit && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                        Изменить
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </Stack>
    </>
  );
}
