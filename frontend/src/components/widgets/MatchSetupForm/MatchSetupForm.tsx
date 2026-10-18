"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { DemoBadge } from "@/src/components/ui/Badge/Badge";
import { Button } from "@/src/components/ui/Button/Button";
import { Field, FormActions, FormGrid, formClass, Select } from "@/src/components/ui/Form/Form";
import { Notice } from "@/src/components/ui/Notice/Notice";
import { errorText } from "@/src/lib/api";
import { personName } from "@/src/lib/format";
import type { Discipline, RuleVersion, TournamentEntry } from "@/src/lib/types";

export interface MatchSetupValue {
  disciplineId: string;
  redEntryId: string | null;
  blueEntryId: string | null;
  ruleVersionId: string | null;
}

interface Props {
  disciplines: Discipline[];
  entries: TournamentEntry[];
  ruleVersions: RuleVersion[];
  initial?: MatchSetupValue;
  submitLabel: string;
  onSubmit: (v: MatchSetupValue) => Promise<void>;
  onCancel?: () => void;
}

/** Participants and rule version of a match in the "prepared" state. The server validates everything. */
export function MatchSetupForm({ disciplines, entries, ruleVersions, initial, submitLabel, onSubmit, onCancel }: Props) {
  const [v, setV] = useState<MatchSetupValue>(
    initial ?? { disciplineId: disciplines[0]?.id ?? "", redEntryId: null, blueEntryId: null, ruleVersionId: null },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only approved versions of active profiles can be bound to a new match (the server checks this too).
  const versions = ruleVersions.filter((r) => r.discipline_id === v.disciplineId && r.status === "approved" && (!r.profile_archived_at || r.id === initial?.ruleVersionId));
  const selected = ruleVersions.find((r) => r.id === v.ruleVersionId);
  const active = entries.filter((e) => e.status === "registered");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(v);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const entryOptions = (exclude: string | null) =>
    active
      .filter((e) => e.id !== exclude)
      .map((e) => (
        <option key={e.id} value={e.id}>
          {personName(e)} ({e.country_code}){e.registration_number ? ` · ${e.registration_number}` : ""}
        </option>
      ));

  return (
    <form onSubmit={submit} className={formClass}>
      {error && <Notice tone="error">{error}</Notice>}
      <FormGrid cols={2}>
        <Field label="Дисциплина">
          {(id) => (
            <Select id={id} value={v.disciplineId} onChange={(e) => setV({ ...v, disciplineId: e.target.value, ruleVersionId: null })} required>
              {disciplines.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Версия правил" hint={versions.length ? "Поединок навсегда сохранит выбранную версию" : "Для этой дисциплины нет опубликованных профилей правил"}>
          {(id) => (
            <Select id={id} value={v.ruleVersionId ?? ""} onChange={(e) => setV({ ...v, ruleVersionId: e.target.value || null })}>
              <option value="">— выбрать позже —</option>
              {versions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.profile_name}, версия {r.version_number}
                  {r.is_demo ? " (ДЕМО)" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Красный угол">
          {(id) => (
            <Select id={id} value={v.redEntryId ?? ""} onChange={(e) => setV({ ...v, redEntryId: e.target.value || null })}>
              <option value="">— не назначен —</option>
              {entryOptions(v.blueEntryId)}
            </Select>
          )}
        </Field>
        <Field label="Синий угол">
          {(id) => (
            <Select id={id} value={v.blueEntryId ?? ""} onChange={(e) => setV({ ...v, blueEntryId: e.target.value || null })}>
              <option value="">— не назначен —</option>
              {entryOptions(v.redEntryId)}
            </Select>
          )}
        </Field>
      </FormGrid>
      {!versions.length && (
        <Notice tone="warning">
          Без правил поединок нельзя отметить готовым к старту. <Link href="/rules/new">Создайте профиль правил</Link> для этой дисциплины и опубликуйте его.
        </Notice>
      )}
      {selected?.is_demo && (
        <Notice tone="warning">
          <DemoBadge /> Выбран неофициальный профиль (демонстрационный или собственный). Он не является регламентом федерации.
        </Notice>
      )}
      <FormActions>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Отмена
          </Button>
        )}
        <Button type="submit" variant="primary" loading={busy} disabled={!v.disciplineId}>
          {submitLabel}
        </Button>
      </FormActions>
    </form>
  );
}
