"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/src/components/ui/Button/Button";
import { Card } from "@/src/components/ui/Card/Card";
import { Field, FormActions, FormGrid, Input, Select, Textarea } from "@/src/components/ui/Form/Form";
import { Empty, ErrorState, Loading, Notice } from "@/src/components/ui/Notice/Notice";
import { PageHeader } from "@/src/components/ui/PageHeader/PageHeader";
import { useToast } from "@/src/components/ui/Toast/Toast";
import { BLANK_DEFINITION } from "@/src/components/widgets/RuleDefinitionEditor/RuleDefinitionEditor";
import { RuleVersionForm, versionErrors, versionPayload, type RuleVersionValue } from "@/src/components/widgets/RuleVersionForm/RuleVersionForm";
import { api, errorText } from "@/src/lib/api";
import type { Discipline, RuleAbilities, RuleProfileSummary, RuleVersion } from "@/src/lib/types";
import { useResource } from "@/src/lib/use-resource";
import styles from "./RuleEditorPage.module.scss";

const EMPTY_VERSION: RuleVersionValue = {
  official: false,
  definition: BLANK_DEFINITION,
  changeSummary: "",
  sourceTitle: "",
  sourceEdition: "",
  sourceUrl: "",
  sourcePublishedOn: "",
  effectiveFrom: "",
};

/** New rule profile: saved as a draft, published later on its page. */
export function RuleEditorPage() {
  const router = useRouter();
  const toast = useToast();
  const profiles = useResource<{ abilities: RuleAbilities; profiles: RuleProfileSummary[] }>("/rule-profiles");
  const disciplines = useResource<Discipline[]>("/disciplines");
  const versions = useResource<RuleVersion[]>("/rule-versions");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [disciplineId, setDisciplineId] = useState("");
  const [base, setBase] = useState("");
  const [version, setVersion] = useState<RuleVersionValue>(EMPTY_VERSION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (profiles.loading || disciplines.loading) return <Loading />;
  if (profiles.error || disciplines.error) return <ErrorState message={profiles.error ?? disciplines.error ?? ""} onRetry={profiles.reload} />;
  const abilities = profiles.data!.abilities;
  const crumbs = [{ label: "Профили правил", href: "/rules" }];

  if (!abilities.create) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Новый профиль правил" />
        <Card>
          <Empty icon="lock" title="Создавать профили правил могут организаторы" action={<ButtonLink href="/rules">К профилям правил</ButtonLink>}>
            Опубликованные профили можно просматривать и выбирать при создании поединка.
          </Empty>
        </Card>
      </>
    );
  }

  const approved = (versions.data ?? []).filter((v) => v.status === "approved" && !v.profile_archived_at);
  const discipline = disciplineId || disciplines.data?.[0]?.id || "";
  const nameError = name.trim().length > 0 && name.trim().length < 3 ? "Не короче 3 символов" : null;
  const blocking = name.trim().length < 3 || !discipline || versionErrors(version).length > 0;

  function applyBase(id: string) {
    setBase(id);
    const src = approved.find((v) => v.id === id);
    // A copy starts as a non-official draft: it becomes the organizer's own edit, not the source regulation.
    setVersion({ ...EMPTY_VERSION, definition: src ? structuredClone(src.definition) : BLANK_DEFINITION, changeSummary: src ? `На основе «${src.profile_name}», версия ${src.version_number}` : "" });
    if (src && !disciplineId) setDisciplineId(src.discipline_id);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<{ id: string }>("/rule-profiles", {
        name: name.trim(),
        description: description.trim() || null,
        disciplineId: discipline,
        ...versionPayload(version),
      });
      toast("Черновик профиля сохранён. Проверьте его и опубликуйте");
      router.push(`/rules/${created.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <PageHeader
        breadcrumbs={crumbs}
        title="Новый профиль правил"
        description="Профиль сохранится как черновик. Опубликуйте его на странице профиля — после этого его можно выбрать в поединке."
        actions={
          <>
            <ButtonLink href="/rules" variant="ghost">
              Отмена
            </ButtonLink>
            <Button type="submit" variant="primary" loading={busy} disabled={blocking}>
              Сохранить черновик
            </Button>
          </>
        }
      />
      {error && (
        <div className={styles.error}>
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <RuleVersionForm
        value={version}
        onChange={setVersion}
        canMarkOfficial={abilities.manageAll}
        disabled={busy}
        header={
          <Card title="Профиль">
            <FormGrid cols={2}>
              <Field label="Название" error={nameError} hint="Например: «Клубные правила, 2 раунда по 3 минуты»">
                {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus aria-invalid={!!nameError} />}
              </Field>
              <Field label="Дисциплина" hint="Профиль можно выбрать только в поединках этой дисциплины">
                {(id) => (
                  <Select id={id} value={discipline} onChange={(e) => setDisciplineId(e.target.value)} required>
                    {disciplines.data?.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Начать с" hint="Параметры копируются, исходный профиль не меняется">
                {(id) => (
                  <Select id={id} value={base} onChange={(e) => applyBase(e.target.value)}>
                    <option value="">Нейтральный шаблон</option>
                    {approved.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.profile_name}, версия {v.version_number} ({v.discipline_name})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Описание" hint="Для кого и для каких турниров этот профиль">
                {(id) => <Textarea id={id} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />}
              </Field>
            </FormGrid>
          </Card>
        }
      />
      <div className={styles.footer}>
        <FormActions>
          <ButtonLink href="/rules" variant="ghost">
            Отмена
          </ButtonLink>
          <Button type="submit" variant="primary" loading={busy} disabled={blocking}>
            Сохранить черновик
          </Button>
        </FormActions>
      </div>
    </form>
  );
}
