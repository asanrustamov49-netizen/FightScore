"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, RuleKindBadge } from "@/src/components/ui/Badge/Badge";
import { Button, ButtonLink } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { SearchField } from "@/src/components/ui/Form/Form";
import { Icon } from "@/src/components/ui/Icon/Icon";
import { LinkCard } from "@/src/components/ui/LinkCard/LinkCard";
import { Empty, ErrorState, Loading, Notice } from "@/src/components/ui/Notice/Notice";
import { CardGrid, MetaItem, PageHeader, Stack, Toolbar } from "@/src/components/ui/PageHeader/PageHeader";
import { Segmented } from "@/src/components/ui/Tabs/Tabs";
import { useToast } from "@/src/components/ui/Toast/Toast";
import { api, errorText } from "@/src/lib/api";
import { plural } from "@/src/lib/format";
import type { RuleAbilities, RuleProfileSummary } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";
import styles from "./RulesPage.module.scss";

type Filter = "all" | "official" | "custom" | "archived";

/** The version that matters for a profile: the newest approved one, otherwise the newest. */
export function currentVersion(p: RuleProfileSummary) {
  return p.versions.find((v) => v.status === "approved") ?? p.versions[0];
}

export function RulesPage() {
  const router = useRouter();
  const toast = useToast();
  const list = useResource<{ abilities: RuleAbilities; profiles: RuleProfileSummary[] }>("/rule-profiles");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const profiles = useMemo(() => list.data?.profiles ?? [], [list.data]);
  const abilities = list.data?.abilities;
  const isOfficial = (p: RuleProfileSummary) => p.versions.some((v) => !v.is_demo && v.status === "approved");
  const matchers: Record<Filter, (p: RuleProfileSummary) => boolean> = {
    all: (p) => !p.archived_at,
    official: (p) => !p.archived_at && isOfficial(p),
    custom: (p) => !p.archived_at && !isOfficial(p),
    archived: (p) => !!p.archived_at,
  };
  const needle = search.trim().toLowerCase();
  const shown = profiles.filter(matchers[filter]).filter((p) => !needle || `${p.name} ${p.discipline_name}`.toLowerCase().includes(needle));
  const officialCount = profiles.filter((p) => !p.archived_at && isOfficial(p)).length;

  async function duplicate(p: RuleProfileSummary) {
    setBusy(p.id);
    setError(null);
    try {
      const copy = await api.post<{ id: string }>(`/rule-profiles/${p.id}/duplicate`, {});
      toast("Копия создана как черновик. Измените её и опубликуйте");
      router.push(`/rules/${copy.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Профили правил"
        description="Профиль правил задаёт время, начисления, нарушения, способы завершения и полномочия судей. Поединок получает неизменяемую версию профиля: правка правил никогда не меняет уже созданные поединки."
        actions={
          abilities?.create && (
            <ButtonLink href="/rules/new" variant="primary">
              <Icon name="plus" size={18} />
              Создать профиль правил
            </ButtonLink>
          )
        }
      />
      <Stack>
        {officialCount === 0 && (
          <Notice tone="warning" title="Официальные регламенты не загружены">
            Сейчас доступны только неофициальные профили — демонстрационные или созданные организаторами. Их значения не основаны на правилах федераций. Официальный
            регламент заводится с указанием источника и утверждается владельцем системы.
          </Notice>
        )}
        <Card>
          <ol className={styles.howto}>
            <li>
              <strong>Создайте профиль</strong> или скопируйте существующий — получится черновик.
            </li>
            <li>
              <strong>Настройте и опубликуйте</strong> версию: после публикации она неизменяема.
            </li>
            <li>
              <strong>Выберите версию в поединке</strong>: турнир → «Поединки» → «Новый поединок» → «Версия правил».
            </li>
          </ol>
        </Card>
        {error && <Notice tone="error">{error}</Notice>}
        {profiles.length > 0 && (
          <Toolbar>
            <Segmented
              label="Фильтр профилей"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "Все", count: profiles.filter(matchers.all).length },
                { value: "official", label: "Официальные", count: profiles.filter(matchers.official).length },
                { value: "custom", label: "Неофициальные", count: profiles.filter(matchers.custom).length },
                { value: "archived", label: "Архив", count: profiles.filter(matchers.archived).length },
              ]}
            />
            <SearchField label="Поиск по названию или дисциплине" value={search} onChange={setSearch} />
          </Toolbar>
        )}
        {list.loading ? (
          <Loading />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !profiles.length ? (
          <Card>
            <Empty
              icon="book"
              title="Профилей правил пока нет"
              action={abilities?.create ? <ButtonLink href="/rules/new" variant="primary">Создать профиль правил</ButtonLink> : undefined}
            >
              {abilities?.create ? "Создайте первый профиль: задайте время, начисления и полномочия судей." : "Профили правил создаёт организатор."}
            </Empty>
          </Card>
        ) : !shown.length ? (
          <Card>
            <Empty icon="search" title="Ничего не найдено" action={<Button onClick={() => (setFilter("all"), setSearch(""))}>Сбросить фильтры</Button>} />
          </Card>
        ) : (
          <CardGrid min={300}>
            {shown.map((p) => {
              const cur = currentVersion(p);
              const draft = p.versions.find((v) => v.status === "draft");
              const approved = p.versions.filter((v) => v.status === "approved").length;
              return (
                <LinkCard
                  key={p.id}
                  href={`/rules/${p.id}`}
                  title={p.name}
                  accent={p.archived_at ? "muted" : undefined}
                  badges={
                    <>
                      {cur && <RuleKindBadge demo={cur.is_demo} />}
                      {p.visibility === "private" && <Badge title="Виден только автору и организаторам системы">Личный</Badge>}
                      {p.archived_at && <Badge>В архиве</Badge>}
                    </>
                  }
                  actions={
                    <>
                      <ButtonLink href={`/rules/${p.id}`} size="sm" variant="primary">
                        Открыть
                      </ButtonLink>
                      {abilities?.create && (
                        <Button size="sm" variant="ghost" loading={busy === p.id} onClick={() => void duplicate(p)}>
                          <Icon name="copy" size={16} />
                          Дублировать
                        </Button>
                      )}
                    </>
                  }
                >
                  <div className={styles.meta}>
                    <MetaItem icon="versus">{p.discipline_name}</MetaItem>
                    <MetaItem icon="book">
                      {cur ? `Версия ${cur.version_number}` : "Нет версий"}
                      {approved ? ` · опубликовано ${approved}` : " · не опубликован"}
                      {draft ? ` · черновик v${draft.version_number}` : ""}
                    </MetaItem>
                    <MetaItem icon="trophy">
                      {p.matches_count} {plural(p.matches_count, ["поединок", "поединка", "поединков"])}
                    </MetaItem>
                  </div>
                  {p.description && <p className={styles.description}>{p.description}</p>}
                </LinkCard>
              );
            })}
          </CardGrid>
        )}
        {abilities && !abilities.create && (
          <p className={styles.footnote}>Создавать профили правил могут организаторы. Просматривать и выбирать опубликованные профили можно при создании поединка.</p>
        )}
      </Stack>
    </>
  );
}
