"use client";

import { useState } from "react";
import { Button } from "@/src/components/ui/Button/Button";
import { Field, FormActions, FormGrid, formClass, Select } from "@/src/components/ui/Form/Form";
import { Notice } from "@/src/components/ui/Notice/Notice";
import { errorText } from "@/src/lib/api";
import type { MatchSnapshot } from "@/src/lib/types";

interface Official {
  id: string;
  login: string;
  display_name: string;
}

interface Props {
  candidates: Official[];
  current: MatchSnapshot["officials"];
  onSave: (officials: { userId: string; role: "chief_judge" | "judge" }[]) => Promise<void>;
}

/** Chief judge + up to two side judges. Their exact rights come from the match rule profile. */
export function OfficialsEditor({ candidates, current, onSave }: Props) {
  const [chief, setChief] = useState(current.find((o) => o.official_role === "chief_judge")?.user_id ?? "");
  const [judges, setJudges] = useState<string[]>(() => {
    const j = current.filter((o) => o.official_role === "judge").map((o) => o.user_id);
    return [j[0] ?? "", j[1] ?? ""];
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSave([
        ...(chief ? [{ userId: chief, role: "chief_judge" as const }] : []),
        ...judges.filter(Boolean).map((userId) => ({ userId, role: "judge" as const })),
      ]);
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const options = (exclude: string[]) =>
    candidates
      .filter((c) => !exclude.includes(c.id))
      .map((c) => (
        <option key={c.id} value={c.id}>
          {c.display_name} ({c.login})
        </option>
      ));

  return (
    <div className={formClass}>
      {error && <Notice tone="error">{error}</Notice>}
      {saved && <Notice tone="success">Судьи назначены</Notice>}
      <FormGrid cols={3}>
        <Field label="Главный судья">
          {(id) => (
            <Select id={id} value={chief} onChange={(e) => setChief(e.target.value)}>
              <option value="">— не назначен —</option>
              {options(judges)}
            </Select>
          )}
        </Field>
        {judges.map((j, i) => (
          <Field key={i} label={`Судья ${i + 1}`}>
            {(id) => (
              <Select id={id} value={j} onChange={(e) => setJudges(judges.map((x, k) => (k === i ? e.target.value : x)))}>
                <option value="">— не назначен —</option>
                {options([chief, ...judges.filter((_, k) => k !== i)])}
              </Select>
            )}
          </Field>
        ))}
      </FormGrid>
      <FormActions>
        <Button variant="primary" onClick={save} loading={busy}>
          Сохранить судей
        </Button>
      </FormActions>
    </div>
  );
}
