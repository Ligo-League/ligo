import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { roundRobin, type RoundRobinRound } from './round-robin.ts';

// The round robin by the circle method (design doc section 5, "Scheduling"; M-45).

const teams = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

function scheduled(n: number, seed: number, legs: 1 | 2 = 1): RoundRobinRound<number>[] {
  const result = roundRobin(teams(n), { seed, legs });
  if (!result.ok) throw new Error(result.error);
  return result.rounds;
}

const sizes = fc.integer({ min: 2, max: 20 });
const seeds = fc.integer({ min: -2_147_483_648, max: 2_147_483_647 });

describe('roundRobin', () => {
  it('gives 10 teams 9 rounds of 5 matches, and 12 teams 11 rounds of 6', () => {
    expect(scheduled(10, 1)).toHaveLength(9);
    expect(scheduled(10, 1).every((round) => round.matches.length === 5)).toBe(true);
    expect(scheduled(12, 1)).toHaveLength(11);
    expect(scheduled(12, 1).every((round) => round.matches.length === 6)).toBe(true);
  });

  it('numbers rounds from 1 in order', () => {
    expect(scheduled(6, 3).map((round) => round.round)).toEqual([1, 2, 3, 4, 5]);
  });

  it('every pair meets exactly once per leg', () => {
    fc.assert(
      fc.property(sizes, seeds, fc.constantFrom(1 as const, 2 as const), (n, seed, legs) => {
        const counts = new Map<string, number>();
        for (const round of scheduled(n, seed, legs))
          for (const { a, b } of round.matches) {
            expect(a).not.toBe(b);
            counts.set(pairKey(a, b), (counts.get(pairKey(a, b)) ?? 0) + 1);
          }
        expect(counts.size).toBe((n * (n - 1)) / 2);
        expect([...counts.values()].every((count) => count === legs)).toBe(true);
      }),
    );
  });

  it('gives every team one match per round, or the rest when the count is odd', () => {
    fc.assert(
      fc.property(sizes, seeds, (n, seed) => {
        const rounds = scheduled(n, seed);
        expect(rounds).toHaveLength(n % 2 === 0 ? n - 1 : n);
        for (const round of rounds) {
          const seen = round.matches.flatMap(({ a, b }) => [a, b]);
          if (round.rest !== null) seen.push(round.rest);
          expect(seen.sort((x, y) => x - y)).toEqual(teams(n));
          expect(round.rest === null).toBe(n % 2 === 0);
        }
      }),
    );
  });

  it('rests each team exactly once per leg when the count is odd', () => {
    fc.assert(
      fc.property(
        sizes.filter((n) => n % 2 === 1),
        seeds,
        (n, seed) => {
          const rests = scheduled(n, seed).map((round) => round.rest);
          expect([...rests].sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual(teams(n));
        },
      ),
    );
  });

  it('balances sides: each team is side A as often as side B, give or take one, per leg', () => {
    fc.assert(
      fc.property(sizes, seeds, (n, seed) => {
        const sideA = new Map<number, number>();
        const played = new Map<number, number>();
        for (const round of scheduled(n, seed))
          for (const { a, b } of round.matches) {
            sideA.set(a, (sideA.get(a) ?? 0) + 1);
            played.set(a, (played.get(a) ?? 0) + 1);
            played.set(b, (played.get(b) ?? 0) + 1);
          }
        for (const team of teams(n)) {
          const asA = sideA.get(team) ?? 0;
          const asB = (played.get(team) ?? 0) - asA;
          expect(Math.abs(asA - asB)).toBeLessThanOrEqual(1);
        }
      }),
    );
  });

  it('plays the second leg as the first with the sides swapped', () => {
    fc.assert(
      fc.property(sizes, seeds, (n, seed) => {
        const rounds = scheduled(n, seed, 2);
        const half = rounds.length / 2;
        expect(rounds.map((round) => round.round)).toEqual(
          Array.from({ length: rounds.length }, (_, i) => i + 1),
        );
        for (let i = 0; i < half; i += 1) {
          const first = rounds[i];
          const second = rounds[i + half];
          expect(second?.rest).toBe(first?.rest);
          expect(second?.matches).toEqual(first?.matches.map(({ a, b }) => ({ a: b, b: a })));
        }
      }),
    );
  });

  it('gives the same schedule for the same seed, and usually another for another seed', () => {
    fc.assert(
      fc.property(sizes, seeds, (n, seed) => {
        expect(scheduled(n, seed)).toEqual(scheduled(n, seed));
      }),
    );
    const distinct = new Set([1, 2, 3, 4, 5].map((seed) => JSON.stringify(scheduled(10, seed))));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('works with any entry, not only numbers, and leaves the input as it was', () => {
    const entries = ['Civitas', 'Greed', 'RCK', 'Nova'];
    const before = [...entries];
    const result = roundRobin(entries, { seed: 7, legs: 1 });
    expect(entries).toEqual(before);
    expect(result.ok && result.rounds.flatMap((round) => round.matches)).toHaveLength(6);
  });

  it('refuses fewer than two entries, and an entry given twice', () => {
    expect(roundRobin([], { seed: 1, legs: 1 })).toEqual({ ok: false, error: 'too_few_entries' });
    expect(roundRobin([1], { seed: 1, legs: 1 })).toEqual({ ok: false, error: 'too_few_entries' });
    expect(roundRobin([1, 2, 1], { seed: 1, legs: 1 })).toEqual({
      ok: false,
      error: 'duplicate_entries',
    });
  });
});
