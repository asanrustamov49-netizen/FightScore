"use client";

import { useMemo, useState } from "react";
import { Button } from "@/src/components/ui/Button/Button";
import { Field, Input, SearchField } from "@/src/components/ui/Form/Form";
import { Flag } from "@/src/components/ui/Flag/Flag";
import { Icon } from "@/src/components/ui/Icon/Icon";
import { Notice } from "@/src/components/ui/Notice/Notice";
import { errorText } from "@/src/lib/api";
import { personName } from "@/src/lib/format";
import type { Athlete } from "@/src/lib/types";
import styles from "./BulkAthletePicker.module.scss";

export interface BulkResult {
  registered: { athleteId: string; entryId: string }[];
  skipped: { athleteId: string; reason: "not_found" | "already_registered" }[];
}

const REASON: Record<BulkResult["skipped"][number]["reason"], string> = {
  not_found: "нет в доступной вам базе",
  already_registered: "уже зарегистрирован",
};

interface Props {
  /** Athletes this user can see (GET /athletes). */
  athletes: Athlete[];
  /** Athlete ids already registered in the tournament. */
  registered: Set<string>;
  /** Several athletes: one bulk request. */
  onRegisterMany: (ids: string[]) => Promise<BulkResult>;
  /** Exactly one athlete with a registration number: the existing single endpoint. */
  onRegisterOne: (id: string, registrationNumber: string | null) => Promise<void>;
}

/**
 * Picks athletes from the base and registers them in one go. Registered athletes stay in the list, marked and
 * disabled, so the organizer sees who is in already. The server re-checks everything; the summary shows its answer.
 */
export function BulkAthletePicker({ athletes, registered, onRegisterMany, onRegisterOne }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [regNumber, setRegNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => athletes.filter((a) => !q || `${a.last_name} ${a.first_name} ${a.club_name ?? ""} ${a.country_name} ${a.country_code}`.toLowerCase().includes(q)),
    [athletes, q],
  );
  const selectable = shown.filter((a) => !registered.has(a.id));
  const allShownSelected = selectable.length > 0 && selectable.every((a) => selected.has(a.id));
  const nameOf = (id: string) => {
    const a = athletes.find((x) => x.id === id);
    return a ? personName(a) : "Спортсмен";
  };

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleAllShown() {
    setSelected((s) => {
      const n = new Set(s);
      for (const a of selectable) {
        if (allShownSelected) n.delete(a.id);
        else n.add(a.id);
      }
      return n;
    });
  }

  async function submit() {
    if (busy || !selected.size) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const ids = [...selected];
    try {
      if (ids.length === 1 && regNumber.trim()) {
        await onRegisterOne(ids[0], regNumber.trim());
        setResult({ registered: [{ athleteId: ids[0], entryId: "" }], skipped: [] });
      } else {
        setResult(await onRegisterMany(ids));
      }
      setSelected(new Set());
      setRegNumber("");
    } catch (e) {
      // Nothing was registered by this request: the selection stays so the organizer can retry.
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.picker}>
      <div className={styles.toolbar}>
        <SearchField label="Поиск спортсмена по фамилии, имени, клубу или стране" placeholder="Фамилия, клуб или страна" value={query} onChange={setQuery} />
        <Button size="sm" variant="ghost" onClick={toggleAllShown} disabled={!selectable.length}>
          <Icon name="check" size={16} />
          {allShownSelected ? "Снять выбор с найденных" : `Выбрать найденных (${selectable.length})`}
        </Button>
      </div>

      {athletes.length === 0 ? (
        <p className={styles.empty}>В доступной вам базе пока нет спортсменов. Добавьте нового спортсмена ниже.</p>
      ) : shown.length === 0 ? (
        <p className={styles.empty}>Никого не найдено. Измените запрос.</p>
      ) : (
        <ul className={styles.list} aria-label="Спортсмены из базы">
          {shown.map((a) => {
            const inTournament = registered.has(a.id);
            return (
              <li key={a.id}>
                <label className={`${styles.row} ${inTournament ? styles.rowDisabled : ""} ${selected.has(a.id) ? styles.rowChecked : ""}`}>
                  <input type="checkbox" checked={inTournament || selected.has(a.id)} disabled={inTournament || busy} onChange={() => toggle(a.id)} />
                  <span className={styles.name}>
                    <strong>{personName(a)}</strong>
                    {a.club_name && <small>{a.club_name}</small>}
                  </span>
                  <Flag code={a.country_code} name={a.country_name} />
                  {inTournament && <span className={styles.tag}>В турнире</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.footer}>
        {selected.size === 1 && (
          <Field label="Регистрационный номер" optional>
            {(id) => <Input id={id} value={regNumber} onChange={(e) => setRegNumber(e.target.value)} maxLength={40} />}
          </Field>
        )}
        <div className={styles.submit}>
          <span className={styles.count} aria-live="polite">
            Выбрано: <strong>{selected.size}</strong>
          </span>
          <Button variant="primary" onClick={() => void submit()} disabled={!selected.size} loading={busy}>
            {selected.size > 1 ? `Зарегистрировать (${selected.size})` : "Зарегистрировать"}
          </Button>
        </div>
      </div>

      <div aria-live="polite">
        {error && <Notice tone="error">{error}</Notice>}
        {result && (
          <Notice
            tone={result.skipped.length ? (result.registered.length ? "warning" : "error") : "success"}
            title={`Зарегистрировано: ${result.registered.length}${result.skipped.length ? `, пропущено: ${result.skipped.length}` : ""}`}
          >
            {result.skipped.length > 0 && (
              <ul className={styles.skipped}>
                {result.skipped.map((s) => (
                  <li key={s.athleteId}>
                    {nameOf(s.athleteId)} — {REASON[s.reason]}
                  </li>
                ))}
              </ul>
            )}
          </Notice>
        )}
      </div>
    </div>
  );
}
