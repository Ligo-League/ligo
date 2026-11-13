import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { countForfeits, forfeitConsequence } from './forfeits.ts';
import type { StandingsMatch } from './standings.ts';

let nextId = 1;
const played = (a: number, b: number): StandingsMatch => ({
  id: nextId++,
  a,
  b,
  result: { kind: 'played', games: [{ a: 7, b: 4 }] },
});
const forfeit = (a: number, b: number, forfeitedBy: 'a' | 'b'): StandingsMatch => ({
  id: nextId++,
  a,
  b,
  result: { kind: 'forfeit', forfeitedBy },
});

describe('countForfeits', () => {
  const season = [
    forfeit(1, 2, 'a'),
    forfeit(3, 1, 'b'),
    forfeit(1, 4, 'b'),
    played(1, 5),
    forfeit(2, 3, 'a'),
  ];

  it('counts the matches an entry forfeited, on either side', () => {
    expect(countForfeits(season, 1)).toBe(2);
    expect(countForfeits(season, 2)).toBe(1);
  });

  it('does not count a forfeit by the opponent, nor a played match', () => {
    expect(countForfeits(season, 3)).toBe(0);
    expect(countForfeits(season, 4)).toBe(1);
    expect(countForfeits(season, 5)).toBe(0);
    expect(countForfeits([], 1)).toBe(0);
  });
});

describe('forfeitConsequence', () => {
  const LFR = { warning_at: 2, exclusion_at: 3 };

  it.each([
    [0, 'none'],
    [1, 'none'],
    [2, 'warning'],
    [3, 'exclusion'],
    [4, 'exclusion'],
    [8, 'exclusion'],
  ] as const)('gives LFR %i forfeit(s): %s', (count, consequence) => {
    expect(forfeitConsequence(count, LFR)).toBe(consequence);
  });

  it('warns only on the forfeit that reaches the threshold, not on later ones', () => {
    const lenient = { warning_at: 2, exclusion_at: 5 };
    expect([1, 2, 3, 4, 5].map((count) => forfeitConsequence(count, lenient))).toEqual([
      'none',
      'warning',
      'none',
      'none',
      'exclusion',
    ]);
  });

  it('follows the season: either threshold can be absent', () => {
    expect(forfeitConsequence(2, { warning_at: null, exclusion_at: 3 })).toBe('none');
    expect(forfeitConsequence(9, { warning_at: 2, exclusion_at: null })).toBe('none');
    expect(forfeitConsequence(2, { warning_at: 2, exclusion_at: null })).toBe('warning');
    expect(forfeitConsequence(9, { warning_at: null, exclusion_at: null })).toBe('none');
  });

  it('lets exclusion win when both thresholds are the same', () => {
    expect(forfeitConsequence(2, { warning_at: 2, exclusion_at: 2 })).toBe('exclusion');
  });

  it('never goes back from exclusion as forfeits add up', () => {
    const threshold = fc.option(fc.integer({ min: 1, max: 10 }), { nil: null });
    fc.assert(
      fc.property(
        threshold,
        threshold,
        fc.integer({ min: 0, max: 20 }),
        (warning, exclusion, n) => {
          const thresholds = { warning_at: warning, exclusion_at: exclusion };
          if (forfeitConsequence(n, thresholds) === 'exclusion') {
            expect(forfeitConsequence(n + 1, thresholds)).toBe('exclusion');
          }
        },
      ),
    );
  });
});
