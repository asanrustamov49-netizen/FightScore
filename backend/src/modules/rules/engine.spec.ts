import { definitionSchema, type RuleDefinition } from './definition.js';
import { apply, initialState, remainingAt, replay, RuleError, type Command, type MatchState } from './engine.js';

// Test fixture only: arbitrary values, not a sports regulation.
const def: RuleDefinition = definitionSchema.parse({
  periods: { count: 2, durationSec: 60 },
  scoring: [
    { code: 'a', label: 'A', points: 1 },
    { code: 'b', label: 'B', points: 3 },
  ],
  penalties: [{ code: 'w', label: 'W', public: true, opponentPoints: 2 }],
  endMethods: [
    { code: 'points', label: 'P', requiresWinner: true },
    { code: 'draw', label: 'D', requiresWinner: false },
  ],
  roles: { chief_judge: ['score', 'penalty', 'timer', 'period', 'correct', 'end', 'confirm'], judge: ['score'] },
  timeAdjust: { maxSec: 30 },
});

function run(cmds: [Command, number][], from: MatchState = initialState()) {
  return cmds.reduce((s, [c, t]) => apply(def, s, c, t), from);
}

const live = () => run([[{ type: 'match.ready' }, 0], [{ type: 'match.start' }, 0]]);

describe('generic-points engine', () => {
  it('starts the first period with the profile duration and a stopped timer', () => {
    const s = live();
    expect(s.status).toBe('live');
    expect(s.periodIndex).toBe(1);
    expect(s.timer).toEqual({ status: 'stopped', remainingMs: 60_000, startedAt: null });
  });

  it('counts time from server timestamps and keeps the remainder on stop', () => {
    let s = run([[{ type: 'timer.start' }, 1_000]], live());
    expect(remainingAt(s.timer, 11_000)).toBe(50_000);
    s = apply(def, s, { type: 'timer.stop' }, 21_500);
    expect(s.timer).toEqual({ status: 'stopped', remainingMs: 39_500, startedAt: null });
  });

  it('rejects double start and expiry before zero', () => {
    const s = run([[{ type: 'timer.start' }, 0]], live());
    expect(() => apply(def, s, { type: 'timer.start' }, 5)).toThrow(RuleError);
    expect(() => apply(def, s, { type: 'timer.expire' }, 59_999)).toThrow(RuleError);
    expect(apply(def, s, { type: 'timer.expire' }, 60_000).timer.remainingMs).toBe(0);
  });

  it('never reports negative remaining time', () => {
    const s = run([[{ type: 'timer.start' }, 0]], live());
    expect(remainingAt(s.timer, 10_000_000)).toBe(0);
  });

  it('limits time adjustments to the profile values', () => {
    const s = live();
    expect(() => apply(def, s, { type: 'timer.set', remainingMs: 20_000, reason: 'x' }, 0)).toThrow(/Корректировка/);
    expect(() => apply(def, s, { type: 'timer.set', remainingMs: 61_000, reason: 'x' }, 0)).toThrow(RuleError);
    expect(apply(def, s, { type: 'timer.set', remainingMs: 45_000, reason: 'x' }, 0).timer.remainingMs).toBe(45_000);
  });

  it('adds and subtracts points defined by the profile only', () => {
    let s = apply(def, live(), { type: 'score.add', side: 'red', code: 'b' }, 0);
    expect(s.score).toEqual({ red: 3, blue: 0 });
    s = apply(def, s, { type: 'score.subtract', side: 'red', code: 'a' }, 0);
    expect(s.score.red).toBe(2);
    expect(() => apply(def, s, { type: 'score.subtract', side: 'blue', code: 'a' }, 0)).toThrow(/отрицательным/);
    expect(() => apply(def, s, { type: 'score.add', side: 'red', code: 'zzz' }, 0)).toThrow(/не предусмотрено/);
  });

  it('records penalties and awards opponent points from the profile', () => {
    const s = apply(def, live(), { type: 'penalty.add', side: 'blue', code: 'w' }, 0);
    expect(s.penalties.blue).toEqual({ w: 1 });
    expect(s.score).toEqual({ red: 2, blue: 0 });
  });

  it('does not allow scoring before the match is live', () => {
    expect(() => apply(def, initialState(), { type: 'score.add', side: 'red', code: 'a' }, 0)).toThrow(/статусе/);
  });

  it('moves to the next period only while stopped and not past the last one', () => {
    let s = run([[{ type: 'timer.start' }, 0]], live());
    expect(() => apply(def, s, { type: 'period.next' }, 1)).toThrow(RuleError);
    s = apply(def, s, { type: 'timer.stop' }, 10);
    s = apply(def, s, { type: 'period.next' }, 10);
    expect(s.periodIndex).toBe(2);
    expect(s.timer.remainingMs).toBe(60_000);
    expect(() => apply(def, s, { type: 'period.next' }, 10)).toThrow(/последний/);
  });

  it('ends with a pending result, can resume, and completes on confirmation', () => {
    let s = run([[{ type: 'timer.start' }, 0]], live());
    expect(() => apply(def, s, { type: 'match.end', outcomeCode: 'points', winnerSide: null }, 5)).toThrow(/победителя/);
    s = apply(def, s, { type: 'match.end', outcomeCode: 'points', winnerSide: 'red' }, 5_000);
    expect(s.status).toBe('awaiting_confirmation');
    expect(s.timer).toEqual({ status: 'stopped', remainingMs: 55_000, startedAt: null });
    expect(apply(def, s, { type: 'match.resume' }, 6_000).status).toBe('live');
    expect(apply(def, s, { type: 'result.confirm' }, 6_000).status).toBe('completed');
  });

  it('replays the log to the same state and skips voided events', () => {
    const log = [
      { id: 'e1', command: { type: 'match.ready' } as Command, at: 0 },
      { id: 'e2', command: { type: 'match.start' } as Command, at: 0 },
      { id: 'e3', command: { type: 'timer.start' } as Command, at: 1_000 },
      { id: 'e4', command: { type: 'score.add', side: 'red', code: 'b' } as Command, at: 2_000 },
      { id: 'e5', command: { type: 'score.add', side: 'blue', code: 'a' } as Command, at: 3_000 },
    ];
    const direct = log.reduce((s, e) => apply(def, s, e.command, e.at), initialState());
    expect(replay(def, log)).toEqual(direct);
    const corrected = replay(def, [...log, { id: 'e6', command: { type: 'event.void', eventId: 'e4', reason: 'ошибка' }, at: 4_000 }]);
    expect(corrected.score).toEqual({ red: 0, blue: 1 });
    expect(corrected.timer).toEqual(direct.timer);
  });
});
