"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/src/components/ui/Button/Button";
import { Field, FormActions, FormGrid, Select } from "@/src/components/ui/Form/Form";
import { Notice } from "@/src/components/ui/Notice/Notice";
import { errorText } from "@/src/lib/api";
import { personName } from "@/src/lib/format";
import type { Discipline, RuleVersion, TournamentEntry } from "@/src/lib/types";
import styles from "./BracketCreateForm.module.scss";

const sizeFor = (n: number) => {
  let s = 2;
  while (s < n) s *= 2;
  return s;
};

/**
 * Builds a single-elimination bracket. Seeding is the order in which athletes are ticked (first = top seed);
 * top seeds get the byes. The server checks entries, the rule version and that the discipline has no bracket yet.
 */
export function BracketCreateForm({
  disciplines,
  entries,
  ruleVersions,
  onSubmit,
  onCancel,
}: {
  /** Tournament disciplines that do not have a bracket yet. */
  disciplines: Discipline[];
  entries: TournamentEntry[];
  ruleVersions: RuleVersion[];
  onSubmit: (v: { disciplineId: string; ruleVersionId: string; entryIds: string[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const [disciplineId, setDisciplineId] = useState(disciplines[0]?.id ?? "");
  const versions = ruleVersions.filter((v) => v.status === "approved" && !v.profile_archived_at && v.discipline_id === disciplineId);
  const [ruleVersionId, setRuleVersionId] = useState("");
  const [seeds, setSeeds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ruleId = versions.some((v) => v.id === ruleVersionId) ? ruleVersionId : (versions[0]?.id ?? "");
  const registered = entries.filter((e) => e.status === "registered");
  const size = sizeFor(Math.max(seeds.length, 2));

  const toggle = (id: string) => setSeeds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ disciplineId, ruleVersionId: ruleId, entryIds: seeds });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <FormGrid>
        <Field label="Дисциплина">
          {(id) => (
            <Select id={id} value={disciplineId} onChange={(e) => setDisciplineId(e.target.value)}>
              {disciplines.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Версия правил" hint={versions.length ? "Будет назначена всем поединкам сетки" : "Нет утверждённой версии для этой дисциплины"}>
          {(id) => (
            <Select id={id} value={ruleId} onChange={(e) => setRuleVersionId(e.target.value)} disabled={!versions.length}>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.profile_name}, версия {v.version_number}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </FormGrid>

      <fieldset className={styles.fieldset}>
        <legend>Участники и посев</legend>
        <p className={styles.hint}>
          Отмечайте спортсменов по силе: первый отмеченный — первый номер посева. Сильнейшие получают проход без боя, если участников меньше размера сетки.
        </p>
        <ul className={styles.list}>
          {registered.map((e) => {
            const seed = seeds.indexOf(e.id);
            return (
              <li key={e.id}>
                <label className={`${styles.row} ${seed >= 0 ? styles.checked : ""}`}>
                  <input type="checkbox" checked={seed >= 0} onChange={() => toggle(e.id)} />
                  <span className={styles.seed} aria-hidden>
                    {seed >= 0 ? seed + 1 : ""}
                  </span>
                  <span className={styles.name}>
                    {personName(e)}
                    {seed >= 0 && <span className="visually-hidden">, посев {seed + 1}</span>}
                  </span>
                  <span className={styles.country}>{e.country_code}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {error && <Notice tone="error">{error}</Notice>}
      <FormActions>
        <span className={styles.summary} aria-live="polite">
          {seeds.length >= 2 ? `Сетка на ${size}: ${seeds.length} участников, проходов без боя — ${size - seeds.length}` : "Выберите хотя бы двух участников"}
        </span>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Отмена
        </Button>
        <Button type="submit" variant="primary" loading={busy} disabled={seeds.length < 2 || !ruleId || !disciplineId}>
          Создать сетку
        </Button>
      </FormActions>
    </form>
  );
}
