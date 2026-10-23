import { BUILTIN_DQ, definitionSchema, withDisqualification } from './definition.js';
import { apply, initialState } from './engine.js';

// Test fixture only: arbitrary values, not a sports regulation.
const base = {
  periods: { count: 1, durationSec: 60 },
  scoring: [{ code: 'a', label: 'A', points: 1 }],
  penalties: [],
  endMethods: [{ code: 'points', label: 'P', requiresWinner: true }],
  roles: { chief_judge: ['score', 'timer', 'end', 'confirm'], judge: ['score'] },
  timeAdjust: { maxSec: 30 },
};

describe('withDisqualification', () => {
  it('adds disqualification to a profile without it, and the engine accepts it', () => {
    const def = withDisqualification(definitionSchema.parse(base));
    expect(def.endMethods.map((m) => m.code)).toEqual(['points', BUILTIN_DQ.code]);
    let s = apply(def, initialState(), { type: 'match.ready' }, 0);
    s = apply(def, s, { type: 'match.start' }, 0);
    s = apply(def, s, { type: 'match.end', outcomeCode: 'dq', winnerSide: 'blue' }, 1000);
    expect(s.pendingResult).toEqual({ outcomeCode: 'dq', winnerSide: 'blue' });
  });

  it("keeps the profile's own disqualification method as is", () => {
    const own = { code: 'fatal', label: 'Дисквалификация за фол', requiresWinner: true };
    const def = withDisqualification(definitionSchema.parse({ ...base, endMethods: [...base.endMethods, own] }));
    expect(def.endMethods).toEqual([...base.endMethods, own]);
  });
});
