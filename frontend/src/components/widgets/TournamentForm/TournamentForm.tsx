"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/src/components/ui/Button/Button";
import { Checkbox, Checks, Field, Fieldset, FormActions, FormGrid, formClass, Input, Select } from "@/src/components/ui/Form/Form";
import { Notice } from "@/src/components/ui/Notice/Notice";
import { errorText } from "@/src/lib/api";
import { TOURNAMENT_STATUS_LABEL } from "@/src/lib/format";
import type { Discipline } from "@/src/lib/types";

export interface TournamentInput {
  name: string;
  startsOn: string;
  endsOn: string;
  venue: string;
  status: keyof typeof TOURNAMENT_STATUS_LABEL;
  disciplineIds: string[];
}

interface Props {
  disciplines: Discipline[];
  initial?: TournamentInput;
  submitLabel: string;
  onSubmit: (value: TournamentInput) => Promise<void>;
  onCancel?: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export function TournamentForm({ disciplines, initial, submitLabel, onSubmit, onCancel }: Props) {
  const [v, setV] = useState<TournamentInput>(
    initial ?? { name: "", startsOn: today(), endsOn: today(), venue: "", status: "draft", disciplineIds: [] },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const toggle = (id: string) =>
    setV((s) => ({ ...s, disciplineIds: s.disciplineIds.includes(id) ? s.disciplineIds.filter((x) => x !== id) : [...s.disciplineIds, id] }));

  return (
    <form onSubmit={submit} className={formClass}>
      {error && <Notice tone="error">{error}</Notice>}
      <FormGrid cols={2}>
        <Field label="Название">{(id) => <Input id={id} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required maxLength={160} />}</Field>
        <Field label="Место проведения">{(id) => <Input id={id} value={v.venue} onChange={(e) => setV({ ...v, venue: e.target.value })} maxLength={200} />}</Field>
        <Field label="Дата начала">{(id) => <Input id={id} type="date" value={v.startsOn} onChange={(e) => setV({ ...v, startsOn: e.target.value })} required />}</Field>
        <Field label="Дата окончания">{(id) => <Input id={id} type="date" value={v.endsOn} min={v.startsOn} onChange={(e) => setV({ ...v, endsOn: e.target.value })} required />}</Field>
        <Field label="Статус">
          {(id) => (
            <Select id={id} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as TournamentInput["status"] })}>
              {Object.entries(TOURNAMENT_STATUS_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </FormGrid>
      <Fieldset legend="Дисциплины">
        <Checks>
          {disciplines.map((d) => (
            <Checkbox key={d.id} label={d.name} checked={v.disciplineIds.includes(d.id)} onChange={() => toggle(d.id)} />
          ))}
        </Checks>
      </Fieldset>
      <FormActions>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Отмена
          </Button>
        )}
        <Button type="submit" variant="primary" loading={busy} disabled={!v.disciplineIds.length}>
          {submitLabel}
        </Button>
      </FormActions>
    </form>
  );
}
