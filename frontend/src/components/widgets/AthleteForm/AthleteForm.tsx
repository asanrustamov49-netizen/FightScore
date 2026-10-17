"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/src/components/ui/Button/Button";
import { Field, FormActions, FormGrid, formClass, Input, Select } from "@/src/components/ui/Form/Form";
import { Notice } from "@/src/components/ui/Notice/Notice";
import { errorText } from "@/src/lib/api";
import type { Athlete, Country } from "@/src/lib/types";

export interface AthleteInput {
  firstName: string;
  lastName: string;
  birthDate: string | null;
  birthYear: number | null;
  countryId: string;
  clubName: string | null;
  updatedAt?: string;
}

export function athleteToInput(a: Athlete): AthleteInput {
  return {
    firstName: a.first_name,
    lastName: a.last_name,
    birthDate: a.birth_date,
    birthYear: a.birth_year,
    countryId: a.country_id,
    clubName: a.club_name,
    updatedAt: a.updated_at,
  };
}

interface Props {
  countries: Country[];
  initial?: AthleteInput;
  submitLabel: string;
  onSubmit: (v: AthleteInput) => Promise<void>;
  onCancel: () => void;
}

/** Only the data PROJECT_SPEC §8.4 asks for: name, birth date or year, country, club. */
export function AthleteForm({ countries, initial, submitLabel, onSubmit, onCancel }: Props) {
  const [v, setV] = useState<AthleteInput>(
    initial ?? { firstName: "", lastName: "", birthDate: null, birthYear: null, countryId: "", clubName: null },
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

  return (
    <form onSubmit={submit} className={formClass}>
      {error && <Notice tone="error">{error}</Notice>}
      <FormGrid cols={3}>
        <Field label="Фамилия">{(id) => <Input id={id} value={v.lastName} onChange={(e) => setV({ ...v, lastName: e.target.value })} required maxLength={80} />}</Field>
        <Field label="Имя">{(id) => <Input id={id} value={v.firstName} onChange={(e) => setV({ ...v, firstName: e.target.value })} required maxLength={80} />}</Field>
        <Field label="Страна">
          {(id) => (
            <Select id={id} value={v.countryId} onChange={(e) => setV({ ...v, countryId: e.target.value })} required>
              <option value="">— выберите —</option>
              {countries.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Дата рождения" hint="Или укажите только год">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={v.birthDate ?? ""}
              onChange={(e) => setV({ ...v, birthDate: e.target.value || null, birthYear: e.target.value ? Number(e.target.value.slice(0, 4)) : v.birthYear })}
            />
          )}
        </Field>
        <Field label="Год рождения">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1900}
              max={2100}
              value={v.birthYear ?? ""}
              onChange={(e) => setV({ ...v, birthYear: e.target.value ? Number(e.target.value) : null })}
            />
          )}
        </Field>
        <Field label="Клуб или команда">
          {(id) => <Input id={id} value={v.clubName ?? ""} onChange={(e) => setV({ ...v, clubName: e.target.value || null })} maxLength={120} />}
        </Field>
      </FormGrid>
      <FormActions>
        <Button variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {submitLabel}
        </Button>
      </FormActions>
    </form>
  );
}
