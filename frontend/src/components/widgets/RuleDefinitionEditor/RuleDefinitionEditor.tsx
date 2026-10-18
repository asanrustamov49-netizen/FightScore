"use client";

import { Button } from "@/src/components/ui/Button/Button";
import { Checkbox, Field, FormGrid, Input } from "@/src/components/ui/Form/Form";
import { Icon } from "@/src/components/ui/Icon/Icon";
import type { OfficialAction, RuleDefinition } from "@/src/lib/types";
import styles from "./RuleDefinitionEditor.module.scss";

export const ACTION_LABEL: Record<OfficialAction, string> = {
  score: "Начислять баллы",
  penalty: "Фиксировать нарушения",
  timer: "Управлять таймером",
  period: "Переключать периоды",
  correct: "Исправлять действия",
  end: "Завершать поединок",
  confirm: "Подтверждать результат",
};

const ACTIONS = Object.keys(ACTION_LABEL) as OfficialAction[];
/** The engine needs these from the chief judge to start and finish a match (server checks the same). */
export const REQUIRED_CHIEF: OfficialAction[] = ["timer", "end", "confirm"];

/** A neutral starting point: every value is meant to be changed by the organizer, none comes from a federation. */
export const BLANK_DEFINITION: RuleDefinition = {
  periods: { count: 1, durationSec: 300 },
  scoring: [{ code: "s1", label: "+1", points: 1 }],
  penalties: [],
  endMethods: [
    { code: "points", label: "Победа по очкам", requiresWinner: true },
    { code: "draw", label: "Ничья", requiresWinner: false },
  ],
  roles: { chief_judge: ["score", "penalty", "timer", "period", "correct", "end", "confirm"], judge: ["score", "penalty"] },
  timeAdjust: { maxSec: 30 },
};

function nextCode(prefix: string, used: string[]) {
  let n = used.length + 1;
  while (used.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

const int = (v: string) => (v.trim() === "" ? NaN : Math.trunc(Number(v)));
/** Empty field while the user is typing, instead of NaN. */
const show = (n: number) => (Number.isNaN(n) ? "" : n);
const inRange = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;

/** Same limits as the server schema (backend/src/modules/rules/definition.ts, rules.controller.ts). */
export function validateDefinition(d: RuleDefinition): string[] {
  const errors: string[] = [];
  if (!inRange(d.periods.count, 1, 20)) errors.push("Количество периодов — от 1 до 20.");
  if (!inRange(d.periods.durationSec, 1, 3600)) errors.push("Длительность периода — от 1 секунды до 60 минут.");
  if (!d.scoring.length) errors.push("Добавьте хотя бы одно начисление баллов.");
  d.scoring.forEach((s, i) => {
    if (!s.label.trim() || s.label.length > 40) errors.push(`Начисление ${i + 1}: подпись от 1 до 40 символов.`);
    if (!inRange(s.points, 1, 100)) errors.push(`Начисление ${i + 1}: баллы от 1 до 100.`);
  });
  d.penalties.forEach((p, i) => {
    if (!p.label.trim() || p.label.length > 60) errors.push(`Нарушение ${i + 1}: название от 1 до 60 символов.`);
    if (!inRange(p.opponentPoints, 0, 100)) errors.push(`Нарушение ${i + 1}: баллы сопернику от 0 до 100.`);
  });
  if (!d.endMethods.length) errors.push("Добавьте хотя бы один способ завершения.");
  d.endMethods.forEach((e, i) => {
    if (!e.label.trim() || e.label.length > 60) errors.push(`Способ завершения ${i + 1}: название от 1 до 60 символов.`);
  });
  if (REQUIRED_CHIEF.some((a) => !d.roles.chief_judge.includes(a))) {
    errors.push("Главному судье нужны таймер, завершение и подтверждение результата — иначе поединок нельзя провести.");
  }
  if (!inRange(d.timeAdjust.maxSec, 0, 3600)) errors.push("Корректировка времени — от 0 до 3600 секунд.");
  return errors;
}

interface Props {
  value: RuleDefinition;
  onChange: (d: RuleDefinition) => void;
  disabled?: boolean;
}

export function RuleDefinitionEditor({ value: d, onChange, disabled }: Props) {
  const set = (patch: Partial<RuleDefinition>) => onChange({ ...d, ...patch });
  const minutes = Math.floor(d.periods.durationSec / 60);
  const seconds = d.periods.durationSec % 60;
  const setDuration = (m: number, s: number) => set({ periods: { ...d.periods, durationSec: (Number.isNaN(m) ? 0 : m) * 60 + (Number.isNaN(s) ? 0 : s) } });

  const toggleRole = (role: "chief_judge" | "judge", action: OfficialAction) => {
    const list = d.roles[role];
    const next = list.includes(action) ? list.filter((a) => a !== action) : ACTIONS.filter((a) => a === action || list.includes(a));
    set({ roles: { ...d.roles, [role]: next } });
  };

  return (
    <fieldset className={styles.editor} disabled={disabled}>
      <section className={styles.section}>
        <header>
          <h3>Время</h3>
          <p>Сколько периодов (раундов) в поединке и сколько длится каждый.</p>
        </header>
        <FormGrid cols={4}>
          <Field label="Периодов">
            {(id) => (
              <Input id={id} type="number" min={1} max={20} value={show(d.periods.count)} onChange={(e) => set({ periods: { ...d.periods, count: int(e.target.value) } })} />
            )}
          </Field>
          <Field label="Минуты">
            {(id) => <Input id={id} type="number" min={0} max={60} value={show(minutes)} onChange={(e) => setDuration(int(e.target.value), seconds)} />}
          </Field>
          <Field label="Секунды">
            {(id) => <Input id={id} type="number" min={0} max={59} value={show(seconds)} onChange={(e) => setDuration(minutes, int(e.target.value))} />}
          </Field>
          <Field label="Корректировка, с" hint="Насколько судья может поправить время">
            {(id) => (
              <Input id={id} type="number" min={0} max={3600} value={show(d.timeAdjust.maxSec)} onChange={(e) => set({ timeAdjust: { maxSec: int(e.target.value) } })} />
            )}
          </Field>
        </FormGrid>
      </section>

      <section className={styles.section}>
        <header>
          <h3>Начисление баллов</h3>
          <p>Кнопки, которыми судья добавляет баллы стороне. Подпись видна на кнопке, баллы прибавляются к счёту.</p>
        </header>
        <div className={styles.rows}>
          {d.scoring.map((s, i) => (
            <div key={s.code} className={styles.row}>
              <Field label="Подпись">
                {(id) => (
                  <Input id={id} value={s.label} maxLength={40} onChange={(e) => set({ scoring: d.scoring.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                )}
              </Field>
              <Field label="Баллы">
                {(id) => (
                  <Input id={id} type="number" min={1} max={100} value={show(s.points)} onChange={(e) => set({ scoring: d.scoring.map((x, j) => (j === i ? { ...x, points: int(e.target.value) } : x)) })} />
                )}
              </Field>
              <RemoveButton label={`Удалить начисление «${s.label}»`} onClick={() => set({ scoring: d.scoring.filter((_, j) => j !== i) })} disabled={d.scoring.length <= 1} />
            </div>
          ))}
        </div>
        <AddButton
          label="Добавить начисление"
          onClick={() => set({ scoring: [...d.scoring, { code: nextCode("s", d.scoring.map((x) => x.code)), label: `+${d.scoring.length + 1}`, points: d.scoring.length + 1 }] })}
        />
      </section>

      <section className={styles.section}>
        <header>
          <h3>Нарушения и штрафы</h3>
          <p>Предупреждения и штрафы. Штраф может давать баллы сопернику; публичные нарушения видны на табло.</p>
        </header>
        {d.penalties.length ? (
          <div className={styles.rows}>
            {d.penalties.map((p, i) => (
              <div key={p.code} className={styles.row}>
                <Field label="Название">
                  {(id) => (
                    <Input id={id} value={p.label} maxLength={60} onChange={(e) => set({ penalties: d.penalties.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  )}
                </Field>
                <Field label="Баллы сопернику">
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min={0}
                      max={100}
                      value={show(p.opponentPoints)}
                      onChange={(e) => set({ penalties: d.penalties.map((x, j) => (j === i ? { ...x, opponentPoints: int(e.target.value) } : x)) })}
                    />
                  )}
                </Field>
                <div className={styles.checkCell}>
                  <Checkbox label="На табло" checked={p.public} onChange={() => set({ penalties: d.penalties.map((x, j) => (j === i ? { ...x, public: !x.public } : x)) })} />
                </div>
                <RemoveButton label={`Удалить нарушение «${p.label}»`} onClick={() => set({ penalties: d.penalties.filter((_, j) => j !== i) })} />
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>Нарушений нет. Добавьте их, если судья должен их фиксировать.</p>
        )}
        <AddButton
          label="Добавить нарушение"
          onClick={() =>
            set({ penalties: [...d.penalties, { code: nextCode("pen", d.penalties.map((x) => x.code)), label: "Предупреждение", public: true, opponentPoints: 0 }] })
          }
        />
      </section>

      <section className={styles.section}>
        <header>
          <h3>Способы завершения</h3>
          <p>Чем может закончиться поединок. Для некоторых исходов нужен победитель, для других (ничья) — нет.</p>
        </header>
        <div className={styles.rows}>
          {d.endMethods.map((m, i) => (
            <div key={m.code} className={styles.row}>
              <Field label="Название">
                {(id) => (
                  <Input id={id} value={m.label} maxLength={60} onChange={(e) => set({ endMethods: d.endMethods.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                )}
              </Field>
              <div className={styles.checkCell}>
                <Checkbox
                  label="Нужен победитель"
                  checked={m.requiresWinner}
                  onChange={() => set({ endMethods: d.endMethods.map((x, j) => (j === i ? { ...x, requiresWinner: !x.requiresWinner } : x)) })}
                />
              </div>
              <RemoveButton label={`Удалить способ «${m.label}»`} onClick={() => set({ endMethods: d.endMethods.filter((_, j) => j !== i) })} disabled={d.endMethods.length <= 1} />
            </div>
          ))}
        </div>
        <AddButton
          label="Добавить способ завершения"
          onClick={() => set({ endMethods: [...d.endMethods, { code: nextCode("end", d.endMethods.map((x) => x.code)), label: "Досрочная победа", requiresWinner: true }] })}
        />
      </section>

      <section className={styles.section}>
        <header>
          <h3>Полномочия судей</h3>
          <p>Что может делать каждая роль в судейской панели. Сервер проверяет каждое действие по этим полномочиям.</p>
        </header>
        <div className={styles.matrix} role="table" aria-label="Полномочия судей">
          <div role="row" className={styles.matrixHead}>
            <span role="columnheader">Действие</span>
            <span role="columnheader">Главный судья</span>
            <span role="columnheader">Судья</span>
          </div>
          {ACTIONS.map((a) => (
            <div role="row" key={a} className={styles.matrixRow}>
              <span role="rowheader">
                {ACTION_LABEL[a]}
                {REQUIRED_CHIEF.includes(a) && <small> · обязательно для главного судьи</small>}
              </span>
              <span role="cell">
                <input
                  type="checkbox"
                  aria-label={`${ACTION_LABEL[a]} — главный судья`}
                  checked={d.roles.chief_judge.includes(a)}
                  onChange={() => toggleRole("chief_judge", a)}
                />
              </span>
              <span role="cell">
                <input type="checkbox" aria-label={`${ACTION_LABEL[a]} — судья`} checked={d.roles.judge.includes(a)} onChange={() => toggleRole("judge", a)} />
              </span>
            </div>
          ))}
        </div>
      </section>
    </fieldset>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} className={styles.add}>
      <Icon name="plus" size={16} />
      {label}
    </Button>
  );
}

function RemoveButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} disabled={disabled} aria-label={label} title={disabled ? "Нужен хотя бы один пункт" : label} className={styles.remove}>
      <Icon name="trash" size={16} />
    </Button>
  );
}
