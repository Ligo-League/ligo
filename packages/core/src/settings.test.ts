import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  pointsSchema,
  rulesetSchema,
  schedulingSchema,
  seasonSettingsSchema,
  stageConfigSchema,
  tiebreakSchema,
  TIEBREAK_CRITERIA,
  UNRESOLVED_TIE_MODES,
} from './settings.ts';

// LFR Season 3, from design doc section 5 ("Points and standings") and section 16 ("Settled").
const LFR_S3 = {
  points: {
    outcomes: { win: 3, loss: 0 },
    forfeit: { winner: 3, loser: 0, counts_as_played: true },
  },
  tiebreak: { criteria: ['points', 'diff'], unresolved_tie: 'shared' },
  ruleset: { result_validation: 'staff', game_score: { win_at: 7, overtime_rounds: 3 } },
  scheduling: { rounds_per_week: 1 },
  season: { forfeit_score: [0, 0], map_pool: [] },
  stage: { seed: 20261019 },
};

const accepts = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;

describe('LFR Season 3 settings', () => {
  it.each([
    ['points', pointsSchema, LFR_S3.points],
    ['tiebreak', tiebreakSchema, LFR_S3.tiebreak],
    ['ruleset', rulesetSchema, LFR_S3.ruleset],
    ['scheduling', schedulingSchema, LFR_S3.scheduling],
    ['season', seasonSettingsSchema, LFR_S3.season],
    ['stage', stageConfigSchema, LFR_S3.stage],
  ])('%s settings are valid and returned unchanged', (_name, schema, value) => {
    expect(schema.parse(value)).toEqual(value);
  });

  it('accepts the Season 2 forfeit score of 7-0', () => {
    expect(accepts(seasonSettingsSchema, { forfeit_score: [7, 0], map_pool: [] })).toBe(true);
  });
});

describe('unknown keys are refused, so a typo cannot silently change a rule', () => {
  it.each([
    ['points', pointsSchema, { ...LFR_S3.points, draw: 1 }],
    ['points.outcomes', pointsSchema, { ...LFR_S3.points, outcomes: { win: 1, loss: 0, draw: 0 } }],
    [
      'points.forfeit',
      pointsSchema,
      { ...LFR_S3.points, forfeit: { winner: 3, loser: 0, counts_as_playd: false } },
    ],
    ['tiebreak', tiebreakSchema, { ...LFR_S3.tiebreak, unresolved: 'shared' }],
    ['ruleset', rulesetSchema, { ...LFR_S3.ruleset, validation: 'staff' }],
    [
      'ruleset.game_score',
      rulesetSchema,
      { ...LFR_S3.ruleset, game_score: { win_at: 7, overtime_rounds: 3, overtime: 'bo3' } },
    ],
    ['scheduling', schedulingSchema, { ...LFR_S3.scheduling, rounds_per_weak: 2 }],
    ['season', seasonSettingsSchema, { ...LFR_S3.season, forfeit: [7, 0] }],
    ['stage', stageConfigSchema, { seed: 1, sed: 2 }],
  ])('%s', (_name, schema, value) => {
    expect(accepts(schema, value)).toBe(false);
  });
});

describe('pointsSchema', () => {
  it.each([
    ['a missing outcome', { outcomes: { win: 1 }, forfeit: { winner: 1, loser: 0 } }],
    ['fractional points', { outcomes: { win: 0.5, loss: 0 }, forfeit: { winner: 1, loser: 0 } }],
    ['points as text', { outcomes: { win: '1', loss: 0 }, forfeit: { winner: 1, loser: 0 } }],
    ['a missing forfeit block', { outcomes: { win: 1, loss: 0 } }],
    [
      'counts_as_played as text',
      { outcomes: { win: 1, loss: 0 }, forfeit: { winner: 1, loser: 0, counts_as_played: 'no' } },
    ],
  ])('refuses %s', (_label, value) => {
    expect(accepts(pointsSchema, value)).toBe(false);
  });

  it('accepts a negative forfeit penalty, which some leagues use', () => {
    const value = { outcomes: { win: 3, loss: 0 }, forfeit: { winner: 3, loser: -1 } };
    expect(accepts(pointsSchema, value)).toBe(true);
  });

  it('counts a forfeit as a played match unless the league says otherwise', () => {
    // Settings stored before this key existed must keep reading.
    const stored = { outcomes: { win: 1, loss: 0 }, forfeit: { winner: 1, loser: 0 } };
    expect(pointsSchema.parse(stored).forfeit.counts_as_played).toBe(true);
    const off = { ...stored, forfeit: { ...stored.forfeit, counts_as_played: false } };
    expect(pointsSchema.parse(off).forfeit.counts_as_played).toBe(false);
  });
});

describe('tiebreakSchema', () => {
  it('knows the criteria and unresolved-tie modes of design doc section 5', () => {
    expect(TIEBREAK_CRITERIA).toEqual([
      'points',
      'diff',
      'h2h_points',
      'h2h_diff',
      'score_for',
      'wins',
      'staff_decision',
    ]);
    expect(UNRESOLVED_TIE_MODES).toEqual(['shared', 'tiebreak_match', 'staff_decision']);
  });

  it.each(UNRESOLVED_TIE_MODES)('accepts unresolved_tie = %s', (mode) => {
    expect(accepts(tiebreakSchema, { criteria: ['points', 'diff'], unresolved_tie: mode })).toBe(
      true,
    );
  });

  it.each([
    ['an empty criteria list', { criteria: [], unresolved_tie: 'shared' }],
    ['an unknown criterion', { criteria: ['points', 'goal_average'], unresolved_tie: 'shared' }],
    ['a repeated criterion', { criteria: ['points', 'diff', 'points'], unresolved_tie: 'shared' }],
    ['an unknown unresolved_tie', { criteria: ['points'], unresolved_tie: 'coin_toss' }],
    ['a missing unresolved_tie', { criteria: ['points', 'diff'] }],
  ])('refuses %s', (_label, value) => {
    expect(accepts(tiebreakSchema, value)).toBe(false);
  });
});

describe('rulesetSchema', () => {
  it.each(['staff', 'opponent'])('accepts result_validation = %s', (mode) => {
    expect(accepts(rulesetSchema, { result_validation: mode })).toBe(true);
  });

  it.each([
    ['an unknown mode', { result_validation: 'nobody' }],
    ['a missing mode', {}],
  ])('refuses %s', (_label, value) => {
    expect(accepts(rulesetSchema, value)).toBe(false);
  });

  it('checks no score unless the league sets a rule', () => {
    // Settings stored before this key existed must keep reading.
    expect(rulesetSchema.parse({ result_validation: 'staff' }).game_score).toBeNull();
    expect(accepts(rulesetSchema, { result_validation: 'staff', game_score: null })).toBe(true);
  });

  it.each([
    ['a game won at one round', { win_at: 1, overtime_rounds: 3 }],
    ['an overtime of no round', { win_at: 7, overtime_rounds: 0 }],
    ['a fractional target', { win_at: 6.5, overtime_rounds: 3 }],
    ['a missing overtime', { win_at: 7 }],
  ])('refuses %s', (_label, game_score) => {
    expect(accepts(rulesetSchema, { result_validation: 'staff', game_score })).toBe(false);
  });
});

describe('schedulingSchema', () => {
  it.each([0, -1, 1.5, '1'])('refuses rounds_per_week = %j', (rounds) => {
    expect(accepts(schedulingSchema, { rounds_per_week: rounds })).toBe(false);
  });
});

describe('seasonSettingsSchema', () => {
  it('accepts a map pool of distinct names', () => {
    const value = { forfeit_score: [0, 0], map_pool: ['Map A', 'Map B', 'Map C'] };
    expect(seasonSettingsSchema.parse(value)).toEqual(value);
  });

  it.each([
    ['a negative forfeit score', { forfeit_score: [-1, 0], map_pool: [] }],
    ['a fractional forfeit score', { forfeit_score: [7.5, 0], map_pool: [] }],
    ['a forfeit score with one number', { forfeit_score: [7], map_pool: [] }],
    ['a forfeit score with three numbers', { forfeit_score: [7, 0, 0], map_pool: [] }],
    ['a missing forfeit score', { map_pool: [] }],
    ['a missing map pool', { forfeit_score: [0, 0] }],
    ['an empty map name', { forfeit_score: [0, 0], map_pool: [''] }],
    ['the same map twice', { forfeit_score: [0, 0], map_pool: ['Map A', 'Map A'] }],
  ])('refuses %s', (_label, value) => {
    expect(accepts(seasonSettingsSchema, value)).toBe(false);
  });
});

describe('stageConfigSchema', () => {
  it('accepts a stage with no seed yet', () => {
    expect(stageConfigSchema.parse({})).toEqual({});
  });

  it.each([1.5, '7', Number.MAX_SAFE_INTEGER + 1, null])('refuses seed = %j', (seed) => {
    expect(accepts(stageConfigSchema, { seed })).toBe(false);
  });
});

// Settings are stored as JSON text: whatever a schema accepts must come back identical.
describe('JSON round trip', () => {
  const int = fc.integer({ min: -1000, max: 1000 });
  const positive = fc.integer({ min: 1, max: 50 });
  const score = fc.integer({ min: 0, max: 50 });

  const arbitraries = [
    [
      'points',
      pointsSchema,
      fc.record({
        outcomes: fc.record({ win: int, loss: int }),
        forfeit: fc.record({ winner: int, loser: int, counts_as_played: fc.boolean() }),
      }),
    ],
    [
      'tiebreak',
      tiebreakSchema,
      fc.record({
        criteria: fc.uniqueArray(fc.constantFrom(...TIEBREAK_CRITERIA), { minLength: 1 }),
        unresolved_tie: fc.constantFrom(...UNRESOLVED_TIE_MODES),
      }),
    ],
    [
      'ruleset',
      rulesetSchema,
      fc.record({
        result_validation: fc.constantFrom('staff' as const, 'opponent' as const),
        game_score: fc.option(
          fc.record({ win_at: fc.integer({ min: 2, max: 50 }), overtime_rounds: positive }),
        ),
      }),
    ],
    ['scheduling', schedulingSchema, fc.record({ rounds_per_week: positive })],
    [
      'season',
      seasonSettingsSchema,
      fc.record({
        forfeit_score: fc.tuple(score, score),
        map_pool: fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 12 }),
      }),
    ],
    ['stage', stageConfigSchema, fc.record({ seed: fc.maxSafeInteger() }, { requiredKeys: [] })],
  ] as const;

  it.each(arbitraries)('%s settings survive JSON storage', (_name, schema, arbitrary) => {
    fc.assert(
      fc.property(arbitrary, (value) => {
        const stored: unknown = JSON.parse(JSON.stringify(value));
        expect(schema.parse(stored)).toEqual(value);
      }),
    );
  });
});
