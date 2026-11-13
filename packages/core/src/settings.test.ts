import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  DEFAULT_DISPUTE_REASONS,
  DEFAULT_VETO,
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
  ruleset: {
    result_validation: 'staff',
    game_score: { win_at: 7, overtime_rounds: 3 },
    team_roles: { managers_max: 3, coaches_max: 1 },
    requests: {
      approval: { team_owner: 'staff', team_member_add: 'staff', team_member_remove: 'auto' },
      answer_within_hours: 24,
      remind_before_hours: 6,
    },
    dispute_reasons: DEFAULT_DISPUTE_REASONS,
    veto: DEFAULT_VETO,
    promotion: { relegated: 2, relegation_barrage: 1, barrage_opponent_place: 3 },
  },
  scheduling: {
    rounds_per_week: 1,
    time_zone: 'Europe/Paris',
    extension_weeks: 1,
    auto_slot: { weekday: 7, time: '21:00' },
  },
  season: { forfeit_score: [0, 0], map_pool: [], forfeits: { warning_at: 2, exclusion_at: 3 } },
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

  it('allows 3 managers and 1 coach, and staff approval of additions, unless set otherwise', () => {
    const parsed = rulesetSchema.parse({ result_validation: 'staff' });
    expect(parsed.team_roles).toEqual({ managers_max: 3, coaches_max: 1 });
    expect(parsed.requests.approval.team_member_add).toBe('staff');
    const custom = { result_validation: 'staff', team_roles: { managers_max: 0 } };
    expect(accepts(rulesetSchema, custom)).toBe(true);
    expect(accepts(rulesetSchema, { result_validation: 'staff', team_staff_max: 3 })).toBe(false);
  });

  it('offers the standard dispute reasons unless the league sets its own', () => {
    const { dispute_reasons } = rulesetSchema.parse({ result_validation: 'staff' });
    expect(dispute_reasons.map((reason) => reason.key)).toEqual([
      'wrong_score',
      'screenshot',
      'ineligible_player',
      'not_played',
      'technical',
    ]);
    expect(dispute_reasons[0]).toEqual({
      key: 'wrong_score',
      label: { fr: 'Score incorrect', en: 'Wrong score' },
    });
    // "Other" is always offered by the platform, so a league may list no reason of its own.
    expect(accepts(rulesetSchema, { result_validation: 'staff', dispute_reasons: [] })).toBe(true);
    expect(
      accepts(rulesetSchema, {
        result_validation: 'staff',
        dispute_reasons: [{ key: 'late', label: { fr: 'Retard' } }],
      }),
    ).toBe(true);
  });

  it.each([
    ['the key reserved for "other"', [{ key: 'other', label: { fr: 'Autre' } }]],
    ['a key that is not a short identifier', [{ key: 'Bad key', label: { fr: 'x' } }]],
    ['an empty label', [{ key: 'x', label: { fr: '' } }]],
    ['a label longer than Discord shows', [{ key: 'x', label: { fr: 'a'.repeat(101) } }]],
    ['no French label', [{ key: 'x', label: { en: 'x' } }]],
    [
      'the same key twice',
      [
        { key: 'x', label: { fr: 'a' } },
        { key: 'x', label: { fr: 'b' } },
      ],
    ],
    [
      'more reasons than a list holds next to "other"',
      Array.from({ length: 25 }, (_, n) => ({ key: `r${n}`, label: { fr: 'x' } })),
    ],
  ])('refuses dispute reasons with %s', (_label, dispute_reasons) => {
    expect(accepts(rulesetSchema, { result_validation: 'staff', dispute_reasons })).toBe(false);
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
    expect(seasonSettingsSchema.parse(value)).toMatchObject(value);
  });

  it('warns at the 2nd forfeit and excludes at the 3rd unless the season says otherwise', () => {
    const stored = { forfeit_score: [0, 0], map_pool: [] };
    // Settings stored before this key existed must keep reading.
    expect(seasonSettingsSchema.parse(stored).forfeits).toEqual({ warning_at: 2, exclusion_at: 3 });
    const custom = { ...stored, forfeits: { warning_at: null, exclusion_at: 5 } };
    expect(seasonSettingsSchema.parse(custom).forfeits).toEqual(custom.forfeits);
  });

  it.each([
    ['a threshold of zero', { warning_at: 0, exclusion_at: 3 }],
    ['a missing threshold', { warning_at: 2 }],
    ['an unknown key', { warning_at: 2, exclusion_at: 3, ban_at: 4 }],
  ])('refuses forfeit thresholds with %s', (_label, forfeits) => {
    expect(accepts(seasonSettingsSchema, { forfeit_score: [0, 0], map_pool: [], forfeits })).toBe(
      false,
    );
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
        team_roles: fc.record({
          managers_max: fc.integer({ min: 0, max: 20 }),
          coaches_max: fc.integer({ min: 0, max: 20 }),
        }),
        requests: fc
          .record({
            approval: fc.record({
              team_owner: fc.constantFrom('auto' as const, 'staff' as const),
              team_member_add: fc.constantFrom('auto' as const, 'staff' as const),
              team_member_remove: fc.constantFrom('auto' as const, 'staff' as const),
            }),
            answer_within_hours: fc.integer({ min: 1, max: 720 }),
            remind_before_hours: fc.option(fc.integer({ min: 0, max: 719 })),
          })
          .filter(
            (rules) =>
              rules.remind_before_hours === null ||
              rules.remind_before_hours < rules.answer_within_hours,
          ),
        dispute_reasons: fc.uniqueArray(
          fc.record({
            key: fc.stringMatching(/^[a-z][a-z0-9_]{0,31}$/).filter((key) => key !== 'other'),
            label: fc.record(
              {
                fr: fc.string({ minLength: 1, maxLength: 100 }),
                en: fc.string({ minLength: 1, maxLength: 100 }),
              },
              { requiredKeys: ['fr'] },
            ),
          }),
          { maxLength: 24, selector: (reason) => reason.key },
        ),
        veto: fc.record({
          formats: fc.constant(DEFAULT_VETO.formats),
          step_seconds: fc.integer({ min: 30, max: 3600 }),
        }),
        promotion: fc
          .record({ relegated: fc.nat(5), relegation_barrage: fc.nat(5), extra: fc.nat(5) })
          .map(({ relegated, relegation_barrage, extra }) => ({
            relegated,
            relegation_barrage,
            barrage_opponent_place: relegated + 1 + extra,
          })),
      }),
    ],
    [
      'scheduling',
      schedulingSchema,
      fc.record({
        rounds_per_week: positive,
        time_zone: fc.constantFrom('Europe/Paris', 'UTC', 'America/New_York'),
        extension_weeks: fc.integer({ min: 1, max: 4 }),
        auto_slot: fc.option(
          fc.record({
            weekday: fc.integer({ min: 1, max: 7 }),
            time: fc
              .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
              .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`),
          }),
          { nil: null },
        ),
      }),
    ],
    [
      'season',
      seasonSettingsSchema,
      fc.record({
        forfeit_score: fc.tuple(score, score),
        map_pool: fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 12 }),
        forfeits: fc.record({
          warning_at: fc.option(positive, { nil: null }),
          exclusion_at: fc.option(positive, { nil: null }),
        }),
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
