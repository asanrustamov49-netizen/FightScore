import { bracketSize, firstRound, nextPosition, roundsOf, seedOrder } from './bracket.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);

describe('bracket layout', () => {
  it.each([
    [2, 2, 1, 0],
    [3, 4, 2, 1],
    [5, 8, 3, 3],
    [8, 8, 3, 0],
  ])('%i athletes: size %i, %i rounds, %i byes', (n, size, rounds, byes) => {
    expect(bracketSize(n)).toBe(size);
    expect(roundsOf(size)).toBe(rounds);
    const pairs = firstRound(ids(n));
    expect(pairs).toHaveLength(size / 2);
    expect(pairs.filter((p) => !p.red || !p.blue)).toHaveLength(byes);
    // Every pair has at least one athlete, every athlete appears exactly once.
    expect(pairs.every((p) => p.red || p.blue)).toBe(true);
    const seated = pairs.flatMap((p) => [p.red, p.blue]).filter(Boolean);
    expect(new Set(seated).size).toBe(n);
  });

  it('uses standard seeding: 1 and 2 can only meet in the final', () => {
    expect(seedOrder(8)).toEqual([0, 7, 3, 4, 1, 6, 2, 5]);
    const pairs = firstRound(ids(8));
    expect(pairs[0]).toMatchObject({ red: 's1', blue: 's8' });
    // s1 is in the top half (slots 0-1), s2 in the bottom half (slots 2-3).
    expect(pairs.slice(0, 2).some((p) => p.red === 's2' || p.blue === 's2')).toBe(false);
  });

  it('gives byes to the top seeds', () => {
    const pairs = firstRound(ids(5));
    const byes = pairs.filter((p) => !p.red || !p.blue).map((p) => p.red ?? p.blue);
    expect(byes.sort()).toEqual(['s1', 's2', 's3']);
  });

  it('sends neighbouring winners to opposite corners of the same next match', () => {
    expect(nextPosition(1, 0)).toEqual({ round: 2, slot: 0, side: 'red' });
    expect(nextPosition(1, 1)).toEqual({ round: 2, slot: 0, side: 'blue' });
    expect(nextPosition(2, 3)).toEqual({ round: 3, slot: 1, side: 'blue' });
  });
});
