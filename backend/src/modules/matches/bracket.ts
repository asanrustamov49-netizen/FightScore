/**
 * Single-elimination bracket layout (pure functions, no I/O). Positions are 0-based.
 * Round r has size / 2^r matches; the winner of (r, slot) plays in (r + 1, floor(slot / 2)), red for an even slot.
 */

export const MAX_BRACKET_SIZE = 64;

/** Smallest power of two that fits `n` athletes (n >= 2). */
export function bracketSize(n: number): number {
  let size = 2;
  while (size < n) size *= 2;
  return size;
}

export function roundsOf(size: number): number {
  return Math.log2(size);
}

/**
 * Standard seeding order: seed indices in bracket order, paired two by two, so that seeds 1 and 2 can only meet in
 * the final. For 8: [0, 7, 3, 4, 1, 6, 2, 5] → pairs 1–8, 4–5, 2–7, 3–6.
 */
export function seedOrder(size: number): number[] {
  let order = [0];
  while (order.length < size) {
    const m = order.length * 2;
    order = order.flatMap((x) => [x, m - 1 - x]);
  }
  return order;
}

export type Side = 'red' | 'blue';

export interface FirstRoundPair<T> {
  slot: number;
  red: T | null;
  blue: T | null;
}

/**
 * First-round pairs for `entries` given in seeding order (best first). Missing seeds are byes; with the smallest
 * fitting size every pair has at least one athlete, and byes go to the top seeds.
 */
export function firstRound<T>(entries: T[]): FirstRoundPair<T>[] {
  const size = bracketSize(entries.length);
  const order = seedOrder(size);
  const pairs: FirstRoundPair<T>[] = [];
  for (let slot = 0; slot < size / 2; slot++) {
    const a = order[slot * 2];
    const b = order[slot * 2 + 1];
    pairs.push({ slot, red: entries[a] ?? null, blue: entries[b] ?? null });
  }
  return pairs;
}

/** Where the winner of (round, slot) goes. */
export function nextPosition(round: number, slot: number): { round: number; slot: number; side: Side } {
  return { round: round + 1, slot: Math.floor(slot / 2), side: slot % 2 === 0 ? 'red' : 'blue' };
}
