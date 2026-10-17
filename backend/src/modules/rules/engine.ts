import type { OfficialAction, RuleDefinition } from './definition.js';

/**
 * `generic-points@1` engine: pure functions, no I/O. All sports values come from the
 * rule definition. Time is passed in explicitly so replaying the event log is deterministic.
 */

export type Side = 'red' | 'blue';
export type MatchStatus = 'prepared' | 'ready' | 'live' | 'awaiting_confirmation' | 'completed' | 'cancelled';

export interface MatchState {
  status: MatchStatus;
  periodIndex: number;
  timer: { status: 'stopped' | 'running'; remainingMs: number; startedAt: number | null };
  score: Record<Side, number>;
  penalties: Record<Side, Record<string, number>>;
  pendingResult: { outcomeCode: string; winnerSide: Side | null } | null;
}

export type Command =
  | { type: 'match.ready' }
  | { type: 'match.cancel'; reason: string }
  | { type: 'match.start' }
  | { type: 'timer.start' }
  | { type: 'timer.stop' }
  | { type: 'timer.set'; remainingMs: number; reason: string }
  | { type: 'timer.expire' }
  | { type: 'period.next' }
  | { type: 'score.add'; side: Side; code: string }
  | { type: 'score.subtract'; side: Side; code: string }
  | { type: 'penalty.add'; side: Side; code: string }
  | { type: 'event.void'; eventId: string; reason: string }
  | { type: 'match.end'; outcomeCode: string; winnerSide: Side | null }
  | { type: 'match.resume' }
  | { type: 'result.confirm' };

export type CommandType = Command['type'];

export class RuleError extends Error {
  constructor(
    readonly code: 'RULE_VIOLATION' | 'INVALID_TRANSITION',
    message: string,
  ) {
    super(message);
  }
}

/** Commands whose effect does not depend on the exact state version (docs/ARCHITECTURE.md §6.3). */
export const ADDITIVE_COMMANDS: ReadonlySet<CommandType> = new Set(['score.add', 'score.subtract', 'penalty.add']);

/** Which official action a command needs; `organizer` and `system` commands are authorized elsewhere. */
export const COMMAND_ACTION: Record<CommandType, OfficialAction | 'organizer' | 'system'> = {
  'match.ready': 'organizer',
  'match.cancel': 'organizer',
  'match.start': 'timer',
  'timer.start': 'timer',
  'timer.stop': 'timer',
  'timer.set': 'timer',
  'timer.expire': 'system',
  'period.next': 'period',
  'score.add': 'score',
  'score.subtract': 'score',
  'penalty.add': 'penalty',
  'event.void': 'correct',
  'match.end': 'end',
  'match.resume': 'end',
  'result.confirm': 'confirm',
};

/** Event types that can be voided by a correction. */
export const VOIDABLE: ReadonlySet<CommandType> = new Set(['score.add', 'score.subtract', 'penalty.add']);

export function initialState(): MatchState {
  return {
    status: 'prepared',
    periodIndex: 0,
    timer: { status: 'stopped', remainingMs: 0, startedAt: null },
    score: { red: 0, blue: 0 },
    penalties: { red: {}, blue: {} },
    pendingResult: null,
  };
}

export function remainingAt(timer: MatchState['timer'], now: number): number {
  if (timer.status !== 'running' || timer.startedAt === null) return timer.remainingMs;
  return Math.max(0, timer.remainingMs - (now - timer.startedAt));
}

const other = (s: Side): Side => (s === 'red' ? 'blue' : 'red');

function requireStatus(state: MatchState, ...allowed: MatchStatus[]) {
  if (!allowed.includes(state.status)) {
    throw new RuleError('INVALID_TRANSITION', `Действие недоступно в статусе «${state.status}»`);
  }
}

function stopTimer(state: MatchState, now: number): MatchState['timer'] {
  return { status: 'stopped', remainingMs: remainingAt(state.timer, now), startedAt: null };
}

export function apply(def: RuleDefinition, state: MatchState, cmd: Command, now: number): MatchState {
  const s: MatchState = structuredClone(state);
  switch (cmd.type) {
    case 'match.ready':
      requireStatus(s, 'prepared');
      s.status = 'ready';
      return s;
    case 'match.cancel':
      requireStatus(s, 'prepared', 'ready', 'live', 'awaiting_confirmation');
      s.timer = stopTimer(s, now);
      s.status = 'cancelled';
      return s;
    case 'match.start':
      requireStatus(s, 'ready');
      s.status = 'live';
      s.periodIndex = 1;
      s.timer = { status: 'stopped', remainingMs: def.periods.durationSec * 1000, startedAt: null };
      return s;
    case 'timer.start':
      requireStatus(s, 'live');
      if (s.timer.status === 'running') throw new RuleError('INVALID_TRANSITION', 'Таймер уже запущен');
      if (s.timer.remainingMs <= 0) throw new RuleError('RULE_VIOLATION', 'Время периода истекло');
      s.timer = { status: 'running', remainingMs: s.timer.remainingMs, startedAt: now };
      return s;
    case 'timer.stop':
      requireStatus(s, 'live');
      if (s.timer.status !== 'running') throw new RuleError('INVALID_TRANSITION', 'Таймер уже остановлен');
      s.timer = stopTimer(s, now);
      return s;
    case 'timer.expire':
      requireStatus(s, 'live');
      if (s.timer.status !== 'running' || remainingAt(s.timer, now) > 0) {
        throw new RuleError('INVALID_TRANSITION', 'Таймер ещё не истёк');
      }
      s.timer = { status: 'stopped', remainingMs: 0, startedAt: null };
      return s;
    case 'timer.set': {
      requireStatus(s, 'live');
      if (s.timer.status === 'running') throw new RuleError('INVALID_TRANSITION', 'Остановите таймер перед корректировкой');
      const max = def.periods.durationSec * 1000;
      if (!Number.isInteger(cmd.remainingMs) || cmd.remainingMs < 0 || cmd.remainingMs > max) {
        throw new RuleError('RULE_VIOLATION', 'Время вне допустимого диапазона периода');
      }
      if (Math.abs(cmd.remainingMs - s.timer.remainingMs) > def.timeAdjust.maxSec * 1000) {
        throw new RuleError('RULE_VIOLATION', `Корректировка больше разрешённых ${def.timeAdjust.maxSec} с`);
      }
      s.timer = { status: 'stopped', remainingMs: cmd.remainingMs, startedAt: null };
      return s;
    }
    case 'period.next':
      requireStatus(s, 'live');
      if (s.timer.status === 'running') throw new RuleError('INVALID_TRANSITION', 'Остановите таймер');
      if (s.periodIndex >= def.periods.count) throw new RuleError('RULE_VIOLATION', 'Это последний период');
      s.periodIndex += 1;
      s.timer = { status: 'stopped', remainingMs: def.periods.durationSec * 1000, startedAt: null };
      return s;
    case 'score.add':
    case 'score.subtract': {
      requireStatus(s, 'live');
      const action = def.scoring.find((a) => a.code === cmd.code);
      if (!action) throw new RuleError('RULE_VIOLATION', 'Такое действие не предусмотрено профилем правил');
      const delta = cmd.type === 'score.add' ? action.points : -action.points;
      if (s.score[cmd.side] + delta < 0) throw new RuleError('RULE_VIOLATION', 'Счёт не может стать отрицательным');
      s.score[cmd.side] += delta;
      return s;
    }
    case 'penalty.add': {
      requireStatus(s, 'live');
      const p = def.penalties.find((x) => x.code === cmd.code);
      if (!p) throw new RuleError('RULE_VIOLATION', 'Такое нарушение не предусмотрено профилем правил');
      s.penalties[cmd.side][p.code] = (s.penalties[cmd.side][p.code] ?? 0) + 1;
      s.score[other(cmd.side)] += p.opponentPoints;
      return s;
    }
    case 'event.void':
      // Handled by the service through replay; the event itself does not change state.
      return s;
    case 'match.end': {
      requireStatus(s, 'live');
      const m = def.endMethods.find((x) => x.code === cmd.outcomeCode);
      if (!m) throw new RuleError('RULE_VIOLATION', 'Способ завершения не предусмотрен профилем правил');
      if (m.requiresWinner && !cmd.winnerSide) throw new RuleError('RULE_VIOLATION', 'Укажите победителя');
      if (!m.requiresWinner && cmd.winnerSide) throw new RuleError('RULE_VIOLATION', 'Этот способ завершения без победителя');
      s.timer = stopTimer(s, now);
      s.status = 'awaiting_confirmation';
      s.pendingResult = { outcomeCode: m.code, winnerSide: cmd.winnerSide };
      return s;
    }
    case 'match.resume':
      requireStatus(s, 'awaiting_confirmation');
      s.status = 'live';
      s.pendingResult = null;
      return s;
    case 'result.confirm':
      requireStatus(s, 'awaiting_confirmation');
      s.status = 'completed';
      return s;
  }
}

/** Folds an event log into state, skipping voided events (docs/ARCHITECTURE.md §6.4). */
export function replay(
  def: RuleDefinition,
  events: { id: string; command: Command; at: number }[],
): MatchState {
  const voided = new Set(events.flatMap((e) => (e.command.type === 'event.void' ? [e.command.eventId] : [])));
  return events.reduce((st, e) => (voided.has(e.id) ? st : apply(def, st, e.command, e.at)), initialState());
}
