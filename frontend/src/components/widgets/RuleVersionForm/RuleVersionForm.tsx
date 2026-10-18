"use client";

import { Card } from "@/src/components/ui/Card/Card";
import { Checkbox, Field, FormGrid, Input, Textarea } from "@/src/components/ui/Form/Form";
import { Notice } from "@/src/components/ui/Notice/Notice";
import type { RuleDefinition } from "@/src/lib/types";
import { RuleDefinitionEditor, validateDefinition } from "../RuleDefinitionEditor/RuleDefinitionEditor";
import { RulePreview } from "../RulePreview/RulePreview";
import styles from "./RuleVersionForm.module.scss";

export interface RuleVersionValue {
  official: boolean;
  definition: RuleDefinition;
  changeSummary: string;
  sourceTitle: string;
  sourceEdition: string;
  sourceUrl: string;
  sourcePublishedOn: string;
  effectiveFrom: string;
}

/** Request body for POST /rule-profiles and PUT /rule-versions/:id. */
export function versionPayload(v: RuleVersionValue) {
  return {
    official: v.official,
    definition: v.definition,
    changeSummary: v.changeSummary.trim() || null,
    source: v.official ? { title: v.sourceTitle.trim(), edition: v.sourceEdition.trim(), url: v.sourceUrl.trim(), publishedOn: v.sourcePublishedOn || null } : null,
    effectiveFrom: v.effectiveFrom || null,
  };
}

export function versionErrors(v: RuleVersionValue): string[] {
  const errors = validateDefinition(v.definition);
  if (v.official && (!v.sourceTitle.trim() || !v.sourceEdition.trim())) errors.unshift("Для официального регламента укажите название документа и его редакцию.");
  return errors;
}

interface Props {
  value: RuleVersionValue;
  onChange: (v: RuleVersionValue) => void;
  /** Only rule managers may mark a profile as an official regulation. */
  canMarkOfficial: boolean;
  disabled?: boolean;
  /** Extra fields above the definition (profile name, discipline...). */
  header?: React.ReactNode;
}

export function RuleVersionForm({ value: v, onChange, canMarkOfficial, disabled, header }: Props) {
  const set = (patch: Partial<RuleVersionValue>) => onChange({ ...v, ...patch });
  const errors = versionErrors(v);
  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        {header}
        <Card title="Тип профиля">
          <div className={styles.stack}>
            <div className={styles.kind}>
              <Checkbox
                label="Официальный регламент федерации"
                checked={v.official}
                disabled={disabled || !canMarkOfficial}
                onChange={() => set({ official: !v.official })}
              />
              <p className={styles.hint}>
                {v.official
                  ? "Укажите источник. Утвердить официальный регламент может только владелец системы."
                  : "Неофициальный профиль: собственные или демонстрационные правила. На поединках и табло он помечается как неофициальный."}
                {!canMarkOfficial && " Отмечать профиль официальным могут организатор системы и владелец."}
              </p>
            </div>
            {v.official && (
              <FormGrid cols={2}>
                <Field label="Название документа">
                  {(id) => <Input id={id} value={v.sourceTitle} maxLength={200} onChange={(e) => set({ sourceTitle: e.target.value })} disabled={disabled} />}
                </Field>
                <Field label="Редакция / версия документа">
                  {(id) => <Input id={id} value={v.sourceEdition} maxLength={100} onChange={(e) => set({ sourceEdition: e.target.value })} disabled={disabled} />}
                </Field>
                <Field label="Ссылка на документ" hint="Необязательно">
                  {(id) => <Input id={id} type="url" value={v.sourceUrl} maxLength={500} onChange={(e) => set({ sourceUrl: e.target.value })} disabled={disabled} />}
                </Field>
                <Field label="Дата публикации документа" hint="Необязательно">
                  {(id) => <Input id={id} type="date" value={v.sourcePublishedOn} onChange={(e) => set({ sourcePublishedOn: e.target.value })} disabled={disabled} />}
                </Field>
              </FormGrid>
            )}
            <FormGrid cols={2}>
              <Field label="Действует с" hint="Если не указать — с даты публикации версии">
                {(id) => <Input id={id} type="date" value={v.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} disabled={disabled} />}
              </Field>
              <Field label="Что изменилось в этой версии" hint="Видно в истории версий">
                {(id) => <Textarea id={id} rows={2} value={v.changeSummary} maxLength={500} onChange={(e) => set({ changeSummary: e.target.value })} disabled={disabled} />}
              </Field>
            </FormGrid>
          </div>
        </Card>
        <Card title="Параметры правил" subtitle="Только параметры, которые поддерживает движок generic-points@1">
          <RuleDefinitionEditor value={v.definition} onChange={(definition) => set({ definition })} disabled={disabled} />
        </Card>
      </div>
      <aside className={styles.side} aria-label="Предпросмотр">
        <Card title="Предпросмотр" subtitle="Так профиль увидят судьи">
          <RulePreview definition={v.definition} />
        </Card>
        {errors.length > 0 && (
          <Notice tone="warning" title="Перед публикацией исправьте">
            <ul className={styles.errors}>
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Notice>
        )}
      </aside>
    </div>
  );
}
