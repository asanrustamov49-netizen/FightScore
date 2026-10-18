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
  /** create: "save draft" / "create and publish" buttons; edit: the status stays editable for corrections. */
  mode: "create" | "edit";
  disciplines: Discipline[];
  initial?: TournamentInput;
  onSubmit: (value: TournamentInput) => Promise<void>;
  onCancel?: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export function TournamentForm({ mode, disciplines, initial, onSubmit, onCancel }: Props) {
  const [v, setV] = useState<TournamentInput>(
    initial ?? { name: "", startsOn: today(), endsOn: today(), venue: "", status: "draft", disciplineIds: [] },
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(status: TournamentInput["status"], key: string) {
    setBusy(key);
    setError(null);
    try {
      await onSubmit({ ...v, status });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void save(mode === "create" ? "draft" : v.status, "main");
  }

  const toggle = (id: string) =>
    setV((s) => ({ ...s, disciplineIds: s.disciplineIds.includes(id) ? s.disciplineIds.filter((x) => x !== id) : [...s.disciplineIds, id] }));
  const incomplete = !v.name.trim() || !v.disciplineIds.length;

  return (
    <form onSubmit={submit} className={formClass}>
      {error && <Notice tone="error">{error}</Notice>}
      <FormGrid cols={2}>
        <Field label="Название" hint="Например: «Кубок города по MMA 2026»">
          {(id) => <Input id={id} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required maxLength={160} autoFocus={mode === "create"} />}
        </Field>
        <Field label="Место проведения" hint="Необязательно">
          {(id) => <Input id={id} value={v.venue} onChange={(e) => setV({ ...v, venue: e.target.value })} maxLength={200} />}
        </Field>
        <Field label="Дата начала">{(id) => <Input id={id} type="date" value={v.startsOn} onChange={(e) => setV({ ...v, startsOn: e.target.value })} required />}</Field>
        <Field label="Дата окончания" error={v.endsOn < v.startsOn ? "Дата окончания раньше даты начала" : null}>
          {(id) => <Input id={id} type="date" value={v.endsOn} min={v.startsOn} onChange={(e) => setV({ ...v, endsOn: e.target.value })} required aria-invalid={v.endsOn < v.startsOn} />}
        </Field>
        {mode === "edit" && (
          <Field label="Статус" hint="Обычно статус меняется кнопками на странице турнира">
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
        )}
      </FormGrid>
      <Fieldset legend="Дисциплины (хотя бы одна)">
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
        {mode === "create" ? (
          <>
            <Button type="submit" loading={busy === "main"} disabled={incomplete || !!busy}>
              Сохранить черновик
            </Button>
            <Button variant="primary" loading={busy === "publish"} disabled={incomplete || !!busy} onClick={() => save("scheduled", "publish")}>
              Создать и опубликовать
            </Button>
          </>
        ) : (
          <Button type="submit" variant="primary" loading={busy === "main"} disabled={incomplete || !!busy}>
            Сохранить изменения
          </Button>
        )}
      </FormActions>
    </form>
  );
}
