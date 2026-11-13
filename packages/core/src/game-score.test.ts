import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { describeGameScores, isPossibleGameScore } from './game-score.ts';
import type { GameScoreSettings } from './settings.ts';

const R6: GameScoreSettings = { win_at: 7, overtime_rounds: 3 };
const VALORANT: GameScoreSettings = { win_at: 13, overtime_rounds: 2 };
const CS2: GameScoreSettings = { win_at: 13, overtime_rounds: 6 };
const GOLDEN_ROUND: GameScoreSettings = { win_at: 7, overtime_rounds: 1 };

const possible = (rule: GameScoreSettings | null, [a, b]: readonly [number, number]) =>
  isPossibleGameScore(rule, a, b);

describe('isPossibleGameScore', () => {
  it.each([
    [
      'R6',
      R6,
      [
        [7, 0],
        [7, 5],
        [8, 6],
        [8, 7],
        [3, 7],
        [6, 8],
        [7, 8],
      ],
    ],
    [
      'Valorant',
      VALORANT,
      [
        [13, 0],
        [13, 11],
        [14, 12],
        [15, 13],
        [12, 14],
        [31, 29],
      ],
    ],
    [
      'CS2',
      CS2,
      [
        [13, 11],
        [16, 12],
        [16, 14],
        [19, 15],
        [19, 17],
        [22, 20],
        [14, 16],
      ],
    ],
    [
      'a single deciding round',
      GOLDEN_ROUND,
      [
        [7, 0],
        [7, 5],
        [7, 6],
        [6, 7],
      ],
    ],
  ] as const)('accepts the scores a map of %s can end on', (_name, rule, scores) => {
    for (const score of scores) expect(possible(rule, score), score.join('-')).toBe(true);
  });

  it.each([
    // 7-6 cannot happen: 6-6 goes to overtime, which ends 8-6 or 8-7.
    [
      'R6',
      R6,
      [
        [7, 6],
        [6, 7],
        [6, 5],
        [8, 5],
        [9, 7],
        [8, 8],
        [9, 8],
        [12, 4],
        [0, 0],
      ],
    ],
    [
      'Valorant',
      VALORANT,
      [
        [13, 12],
        [14, 13],
        [14, 11],
        [15, 12],
        [16, 13],
        [12, 10],
      ],
    ],
    [
      'CS2',
      CS2,
      [
        [13, 12],
        [16, 15],
        [16, 11],
        [17, 13],
        [19, 14],
        [19, 18],
        [18, 15],
      ],
    ],
    [
      'a single deciding round',
      GOLDEN_ROUND,
      [
        [8, 6],
        [8, 7],
        [7, 7],
        [6, 4],
      ],
    ],
  ] as const)('refuses the scores a map of %s cannot end on', (_name, rule, scores) => {
    for (const score of scores) expect(possible(rule, score), score.join('-')).toBe(false);
  });

  it('accepts any score with a winner when the league sets no rule (Rocket League goals)', () => {
    expect(possible(null, [3, 2])).toBe(true);
    expect(possible(null, [0, 11])).toBe(true);
    expect(possible(null, [1, 0])).toBe(true);
  });

  it.each([
    [null, [2, 2]],
    [null, [-1, 3]],
    [null, [2.5, 1]],
    [R6, [7.5, 3]],
    [R6, [-7, 0]],
    [R6, [Number.NaN, 0]],
    [R6, [Number.POSITIVE_INFINITY, 0]],
  ] as const)(
    'never accepts a draw or a score that is not two whole numbers: %j %j',
    (rule, score) => {
      expect(possible(rule, score)).toBe(false);
    },
  );

  // Plays every way a game can go, round by round, and collects the scores it can end on.
  function finalScores(rule: GameScoreSettings, periods: number): Set<string> {
    const finals = new Set<string>();
    const level = rule.win_at - 1;
    const need = Math.floor(rule.overtime_rounds / 2) + 1;

    const regulation = (a: number, b: number): void => {
      if (a === rule.win_at || b === rule.win_at) {
        finals.add(`${a}-${b}`);
      } else if (a === level && b === level) {
        overtime(a, b, 0, 0, periods);
      } else {
        regulation(a + 1, b);
        regulation(a, b + 1);
      }
    };
    const overtime = (a: number, b: number, wonA: number, wonB: number, left: number): void => {
      if (wonA === need || wonB === need) {
        finals.add(`${a}-${b}`);
      } else if (wonA + wonB === rule.overtime_rounds) {
        // The period ended level: another one, while the simulation has some left.
        if (left > 1) overtime(a, b, 0, 0, left - 1);
      } else {
        overtime(a + 1, b, wonA + 1, wonB, left);
        overtime(a, b + 1, wonA, wonB + 1, left);
      }
    };
    regulation(0, 0);
    return finals;
  }

  it('accepts exactly the scores reachable by playing rounds', () => {
    const rule = fc.record({
      win_at: fc.integer({ min: 2, max: 6 }),
      overtime_rounds: fc.integer({ min: 1, max: 6 }),
    });
    const PERIODS = 3;
    fc.assert(
      fc.property(rule, (settings) => {
        const reachable = finalScores(settings, PERIODS);
        // Every score within the first two overtime periods is settled by three simulated ones.
        const limit = settings.win_at - 1 + 2 * settings.overtime_rounds;
        for (let a = 0; a <= limit; a += 1) {
          for (let b = 0; b <= limit; b += 1) {
            expect(isPossibleGameScore(settings, a, b), `${a}-${b}`).toBe(
              reachable.has(`${a}-${b}`),
            );
          }
        }
      }),
      { numRuns: 60 },
    );
  });

  it('gives the same answer whichever side is named first', () => {
    const score = fc.integer({ min: 0, max: 40 });
    const rule = fc.constantFrom(R6, VALORANT, CS2, GOLDEN_ROUND, null);
    fc.assert(
      fc.property(rule, score, score, (settings, a, b) => {
        expect(isPossibleGameScore(settings, a, b)).toBe(isPossibleGameScore(settings, b, a));
      }),
    );
  });
});

describe('describeGameScores', () => {
  it('lists every overtime score when overtime is a single period', () => {
    expect(describeGameScores(R6)).toEqual({
      regulation: { from: [7, 0], to: [7, 5] },
      overtime: [
        [8, 6],
        [8, 7],
      ],
      endless: false,
    });
    expect(describeGameScores(GOLDEN_ROUND)).toEqual({
      regulation: { from: [7, 0], to: [7, 5] },
      overtime: [[7, 6]],
      endless: false,
    });
  });

  it('lists the first period and the start of the next when overtime can repeat', () => {
    expect(describeGameScores(VALORANT)).toEqual({
      regulation: { from: [13, 0], to: [13, 11] },
      overtime: [
        [14, 12],
        [15, 13],
      ],
      endless: true,
    });
    expect(describeGameScores(CS2)).toMatchObject({
      overtime: [
        [16, 12],
        [16, 13],
        [16, 14],
        [19, 15],
      ],
      endless: true,
    });
  });

  it('only lists scores isPossibleGameScore accepts', () => {
    for (const rule of [R6, VALORANT, CS2, GOLDEN_ROUND]) {
      const { regulation, overtime } = describeGameScores(rule);
      for (const score of [regulation.from, regulation.to, ...overtime]) {
        expect(possible(rule, score), score.join('-')).toBe(true);
      }
    }
  });
});
