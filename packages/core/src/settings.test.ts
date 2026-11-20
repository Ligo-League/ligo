import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  DEFAULT_DISPUTE_REASONS,
  DEFAULT_VETO,
  mirroredForfeitScore,
  pointsSchema,
  rulesetSchema,
  schedulingSchema,
  seasonSettingsSchema,
  stageConfigSchema,
  discordSettingsSchema,
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
      approval: {
        team_owner: 'staff',
        team_member_add: 'staff',
        team_member_remove: 'auto',
        roster_move: 'staff',
      },
      answer_within_hours: 24,
      remind_before_hours: 6,
    },
    dispute_reasons: DEFAULT_DISPUTE_REASONS,
    veto: DEFAULT_VETO,
    promotion: { relegated: 2, relegation_barrage: 1, barrage_opponent_place: 3 },
    registration: {
      starters: 5,
      subs_max: 2,
      stats_consent_required: true,
      invite_days: 7,
      min_age: 16,
      lineup_lock_days: 0,
      division_max: 12,
    },
    // O-35 (maintainer, 16 and 19 November 2026).
    mercato: {
      mode: 'windows',
      max_moves_per_team: 3,
      lock_hours: 24,
      intra_club_moves: 'counted',
    },
    // M-39 (maintainer, 19 November 2026): no deadline for the stat grid.
    stats: { entry_days: null, kills_deaths_tolerance: 3 },
    // M-44 (maintainer, 19 November 2026); Season 3's server was managed by hand.
    discord: {
      manage: false,
      team_role_template: '{name}',
      team_roles_mentionable: true,
      open_days_before_week: 2,
      archive_hours_after_result: 48,
      channel_template: 'w{week}-{tagA}-{tagB}',
      category_template: '{division} · Semaine {week}',
      archive_category_template: 'Archives · {division}',
      moss: false,
      moss_channel_template: 'moss-{tag}',
      moss_category_template: 'MOSS · {division}',
    },
  },
  scheduling: {
    rounds_per_week: 1,
    legs: 1,
    time_zone: 'Europe/Paris',
    extension_weeks: 1,
    auto_slot: { weekday: 7, time: '21:00' },
  },
  // A no-show is 7-0 (maintainer, 14 November 2026).
  season: {
    points: {
      outcomes: { win: 3, loss: 0 },
      forfeit: { winner: 3, loser: 0, counts_as_played: true },
    },
    tiebreak: { criteria: ['points', 'diff'], unresolved_tie: 'shared' },
    forfeit_score: { winner: [7, 0], loser: [0, 7] },
    exclusion_forfeit_score: null,
    map_pool: [],
    forfeits: { warning_at: 2, exclusion_at: 3 },
  },
  stage: { seed: 20261019, weeks_off: [], extra_round_weeks: [] },
};

const accepts = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;
/** A season's own points and tie-breakers, copied from the competition at its creation. */
const SCORING = { points: LFR_S3.season.points, tiebreak: LFR_S3.season.tiebreak };

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
    const forfeit_score = mirroredForfeitScore(7, 0);
    expect(forfeit_score).toEqual({ winner: [7, 0], loser: [0, 7] });
    expect(accepts(seasonSettingsSchema, { ...SCORING, forfeit_score, map_pool: [] })).toBe(true);
  });

  // O-36 (maintainer, 19 November 2026): +4 for the team that receives the forfeit (7-3), -7 for
  // the team that forfeits (0-7). Each side has its own rounds, so they need not mirror.
  it('accepts the Season 4 forfeit score of +4 / -7', () => {
    const forfeit_score = { winner: [7, 3], loser: [0, 7] };
    expect(accepts(seasonSettingsSchema, { ...SCORING, forfeit_score, map_pool: [] })).toBe(true);
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

  it('gives the stat grid no deadline and a tolerance of 3 kills, unless set otherwise', () => {
    expect(rulesetSchema.parse({ result_validation: 'staff' }).stats).toEqual({
      entry_days: null,
      kills_deaths_tolerance: 3,
    });
    expect(() =>
      rulesetSchema.parse({ result_validation: 'staff', stats: { entry_days: 0 } }),
    ).toThrow();
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

  it('plays each pair once unless the league asks for home and away', () => {
    expect(schedulingSchema.parse({ rounds_per_week: 1 }).legs).toBe(1);
    expect(schedulingSchema.parse({ rounds_per_week: 1, legs: 2 }).legs).toBe(2);
    expect(accepts(schedulingSchema, { rounds_per_week: 1, legs: 3 })).toBe(false);
  });
});

describe('discordSettingsSchema', () => {
  it('leaves the server alone by default, with M-44’s names and times ready', () => {
    expect(discordSettingsSchema.parse({})).toEqual({
      manage: false,
      team_role_template: '{name}',
      team_roles_mentionable: true,
      open_days_before_week: 2,
      archive_hours_after_result: 48,
      channel_template: 'w{week}-{tagA}-{tagB}',
      category_template: '{division} · Semaine {week}',
      archive_category_template: 'Archives · {division}',
      moss: false,
      moss_channel_template: 'moss-{tag}',
      moss_category_template: 'MOSS · {division}',
    });
  });

  it('is part of the ruleset, so leagues stored before it still read', () => {
    expect(rulesetSchema.parse({ result_validation: 'opponent' }).discord.manage).toBe(false);
  });

  it('accepts a channel name without the week, and LFR’s one category per division', () => {
    const value = {
      channel_template: '{tagA}-{tagB}',
      category_template: 'Organisation {division}',
    };
    expect(discordSettingsSchema.parse(value)).toMatchObject(value);
  });

  it.each([
    ['channel_template', 'w{week}-{team}'],
    ['category_template', '{division} {tagA}'],
    ['archive_category_template', 'Archives {week}'],
    ['team_role_template', '{division}'],
    ['moss_channel_template', 'moss-{tagA}'],
    ['moss_category_template', 'MOSS {tag}'],
    ['channel_template', '   '],
    ['category_template', 'x'.repeat(101)],
  ])('refuses %s = %j', (key, template) => {
    expect(accepts(discordSettingsSchema, { [key]: template })).toBe(false);
  });

  it.each([
    ['open_days_before_week', -1],
    ['open_days_before_week', 15],
    ['archive_hours_after_result', -1],
    ['archive_hours_after_result', 721],
    ['archive_hours_after_result', 1.5],
  ])('refuses %s = %j', (key, value) => {
    expect(accepts(discordSettingsSchema, { [key]: value })).toBe(false);
  });
});

describe('seasonSettingsSchema', () => {
  it('holds its own points and tie-breakers, so changing them leaves past seasons as they were', () => {
    const value = { ...SCORING, forfeit_score: { winner: [7, 0], loser: [0, 7] }, map_pool: [] };
    expect(seasonSettingsSchema.parse(value)).toMatchObject(SCORING);
    expect(accepts(seasonSettingsSchema, { ...value, points: undefined })).toBe(false);
    expect(accepts(seasonSettingsSchema, { ...value, tiebreak: undefined })).toBe(false);
  });

  it('accepts a map pool of distinct names', () => {
    const value = {
      ...SCORING,
      forfeit_score: { winner: [0, 0], loser: [0, 0] },
      map_pool: ['Map A', 'Map B', 'Map C'],
    };
    expect(seasonSettingsSchema.parse(value)).toMatchObject(value);
  });

  it('warns at the 2nd forfeit and excludes at the 3rd unless the season says otherwise', () => {
    const stored = { ...SCORING, forfeit_score: { winner: [0, 0], loser: [0, 0] }, map_pool: [] };
    // Settings stored before this key existed must keep reading.
    expect(seasonSettingsSchema.parse(stored).forfeits).toEqual({ warning_at: 2, exclusion_at: 3 });
    const custom = { ...stored, forfeits: { warning_at: null, exclusion_at: 5 } };
    expect(seasonSettingsSchema.parse(custom).forfeits).toEqual(custom.forfeits);
  });

  it('scores forfeits made by an exclusion as no-shows unless the season sets their own score', () => {
    const stored = { ...SCORING, forfeit_score: { winner: [7, 0], loser: [0, 7] }, map_pool: [] };
    // Settings stored before this key existed must keep reading.
    expect(seasonSettingsSchema.parse(stored).exclusion_forfeit_score).toBeNull();
    const own = { ...stored, exclusion_forfeit_score: { winner: [0, 0], loser: [0, 0] } };
    expect(seasonSettingsSchema.parse(own).exclusion_forfeit_score).toEqual({
      winner: [0, 0],
      loser: [0, 0],
    });
    const negative = { winner: [-1, 0], loser: [0, 0] };
    expect(accepts(seasonSettingsSchema, { ...stored, exclusion_forfeit_score: negative })).toBe(
      false,
    );
  });

  it.each([
    ['a threshold of zero', { warning_at: 0, exclusion_at: 3 }],
    ['a missing threshold', { warning_at: 2 }],
    ['an unknown key', { warning_at: 2, exclusion_at: 3, ban_at: 4 }],
  ])('refuses forfeit thresholds with %s', (_label, forfeits) => {
    expect(
      accepts(seasonSettingsSchema, {
        ...SCORING,
        forfeit_score: { winner: [0, 0], loser: [0, 0] },
        map_pool: [],
        forfeits,
      }),
    ).toBe(false);
  });

  it.each([
    [
      'a negative forfeit score',
      { ...SCORING, forfeit_score: { winner: [7, 0], loser: [-1, 7] }, map_pool: [] },
    ],
    [
      'a fractional forfeit score',
      { ...SCORING, forfeit_score: { winner: [7.5, 0], loser: [0, 7] }, map_pool: [] },
    ],
    [
      'a side with one number',
      { ...SCORING, forfeit_score: { winner: [7], loser: [0, 7] }, map_pool: [] },
    ],
    [
      'a side with three numbers',
      { ...SCORING, forfeit_score: { winner: [7, 0, 0], loser: [0, 7] }, map_pool: [] },
    ],
    ['a missing side', { ...SCORING, forfeit_score: { winner: [7, 0] }, map_pool: [] }],
    [
      'an unknown side',
      { ...SCORING, forfeit_score: { winner: [7, 0], loser: [0, 7], both: [0, 7] }, map_pool: [] },
    ],
    ['the old single pair', { ...SCORING, forfeit_score: [7, 0], map_pool: [] }],
    ['a missing forfeit score', { ...SCORING, map_pool: [] }],
    ['a missing map pool', { ...SCORING, forfeit_score: [0, 0] }],
    [
      'an empty map name',
      { ...SCORING, forfeit_score: { winner: [0, 0], loser: [0, 0] }, map_pool: [''] },
    ],
    [
      'the same map twice',
      {
        ...SCORING,
        forfeit_score: { winner: [0, 0], loser: [0, 0] },
        map_pool: ['Map A', 'Map A'],
      },
    ],
  ])('refuses %s', (_label, value) => {
    expect(accepts(seasonSettingsSchema, value)).toBe(false);
  });
});

describe('stageConfigSchema', () => {
  it('accepts a stage with no seed yet, and no weeks off', () => {
    expect(stageConfigSchema.parse({})).toEqual({ weeks_off: [], extra_round_weeks: [] });
  });

  it('keeps the weeks off and extra-round weeks staff mark on the draft (M-45)', () => {
    const value = { seed: 42, weeks_off: ['2027-02-17'], extra_round_weeks: ['2027-01-11'] };
    expect(stageConfigSchema.parse(value)).toEqual(value);
  });

  it.each([['17/02/2027'], ['2027-02-30'], ['2027-2-17']])('refuses the week day %j', (day) => {
    expect(accepts(stageConfigSchema, { weeks_off: [day] })).toBe(false);
    expect(accepts(stageConfigSchema, { extra_round_weeks: [day] })).toBe(false);
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
  const isoDay = fc
    .integer({ min: 0, max: 3650 })
    .map((offset) => new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10));

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
              roster_move: fc.constantFrom('auto' as const, 'staff' as const),
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
        registration: fc.record({
          starters: fc.integer({ min: 1, max: 20 }),
          subs_max: fc.integer({ min: 0, max: 20 }),
          stats_consent_required: fc.boolean(),
          invite_days: fc.integer({ min: 1, max: 60 }),
          min_age: fc.option(fc.integer({ min: 1, max: 99 }), { nil: null }),
          lineup_lock_days: fc.integer({ min: 0, max: 60 }),
          division_max: fc.integer({ min: 2, max: 64 }),
        }),
        mercato: fc.record({
          mode: fc.constantFrom('open' as const, 'windows' as const),
          max_moves_per_team: fc.option(fc.integer({ min: 1, max: 50 }), { nil: null }),
          lock_hours: fc.integer({ min: 0, max: 720 }),
          intra_club_moves: fc.constantFrom('counted' as const, 'free' as const, 'closed' as const),
        }),
        stats: fc.record({
          entry_days: fc.option(fc.integer({ min: 1, max: 365 }), { nil: null }),
          kills_deaths_tolerance: fc.integer({ min: 0, max: 50 }),
        }),
        discord: fc.record({
          manage: fc.boolean(),
          team_role_template: fc.constantFrom('{name}', '⚔️ {name}', '{tag}'),
          team_roles_mentionable: fc.boolean(),
          open_days_before_week: fc.integer({ min: 0, max: 14 }),
          archive_hours_after_result: fc.integer({ min: 0, max: 720 }),
          channel_template: fc.constantFrom('w{week}-{tagA}-{tagB}', '{tagA}-{tagB}'),
          category_template: fc.constantFrom(
            '{division} · Semaine {week}',
            'Organisation {division}',
          ),
          archive_category_template: fc.constantFrom('Archives · {division}', 'Archives'),
          moss: fc.boolean(),
          moss_channel_template: fc.constantFrom('moss-{tag}', 'moss-{name}'),
          moss_category_template: fc.constantFrom('MOSS · {division}', 'MOSS'),
        }),
      }),
    ],
    [
      'scheduling',
      schedulingSchema,
      fc.record({
        rounds_per_week: positive,
        legs: fc.constantFrom(1 as const, 2 as const),
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
        points: fc.constant(LFR_S3.season.points),
        tiebreak: fc.constant(LFR_S3.season.tiebreak),
        forfeit_score: fc.record({ winner: fc.tuple(score, score), loser: fc.tuple(score, score) }),
        exclusion_forfeit_score: fc.option(
          fc.record({ winner: fc.tuple(score, score), loser: fc.tuple(score, score) }),
          { nil: null },
        ),
        map_pool: fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 12 }),
        forfeits: fc.record({
          warning_at: fc.option(positive, { nil: null }),
          exclusion_at: fc.option(positive, { nil: null }),
        }),
      }),
    ],
    [
      'stage',
      stageConfigSchema,
      fc.record(
        {
          seed: fc.maxSafeInteger(),
          weeks_off: fc.array(isoDay, { maxLength: 6 }),
          extra_round_weeks: fc.array(isoDay, { maxLength: 6 }),
        },
        { requiredKeys: ['weeks_off', 'extra_round_weeks'] },
      ),
    ],
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
