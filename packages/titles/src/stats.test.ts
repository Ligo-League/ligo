import { describe, expect, it } from 'vitest';
import { R6_STATS } from './r6/stats.ts';
import {
  checkSide,
  checkStatRow,
  computeDerived,
  crossCheck,
  manualMetrics,
  played,
  statsOf,
  type StatValues,
} from './stats.ts';

// The manual stat grid's checks and the derived metrics (design doc sections 7 and 9; M-39). A
// map of 12 rounds, as a 7-5 R6 map.

const MAP = { rounds: 12 };
const row = (values: Partial<Record<string, number | null>>): StatValues => ({
  rounds_played: null,
  kills: null,
  deaths: null,
  assists: null,
  headshots: null,
  ...values,
});
const FULL = row({ rounds_played: 12, kills: 9, deaths: 6, assists: 3, headshots: 4 });

describe('the R6 metric schema', () => {
  it('offers rounds, kills, deaths, assists and optional headshots in the grid', () => {
    expect(manualMetrics(R6_STATS).map((metric) => [metric.key, metric.optional ?? false])).toEqual(
      [
        ['rounds_played', false],
        ['kills', false],
        ['deaths', false],
        ['assists', false],
        ['headshots', true],
      ],
    );
    expect(R6_STATS.metrics.filter((metric) => metric.requiresRounds).map((m) => m.key)).toEqual([
      'rounds_kost',
      'rounds_survived',
      'opening_kills',
      'opening_deaths',
      'trade_kills',
      'traded_deaths',
      'clutch_attempts',
      'clutch_wins',
      'plants',
      'defuses',
    ]);
    expect(statsOf('r6')).toBe(R6_STATS);
    expect(statsOf('valorant')).toBeNull();
  });

  it('labels every metric in French and English', () => {
    for (const metric of [...R6_STATS.metrics, ...R6_STATS.derived]) {
      expect(metric.label.fr).not.toBe('');
      expect(metric.label.en).not.toBe('');
    }
  });
});

describe('one player’s row', () => {
  it('accepts possible values, and an empty row (the player did not play)', () => {
    expect(checkStatRow(R6_STATS, MAP, FULL)).toEqual([]);
    expect(checkStatRow(R6_STATS, MAP, row({}))).toEqual([]);
    expect(played(R6_STATS, row({}))).toBe(false);
    expect(played(R6_STATS, row({ kills: 0 }))).toBe(true);
    // Headshots are optional.
    expect(checkStatRow(R6_STATS, MAP, { ...FULL, headshots: null })).toEqual([]);
  });

  it('asks for every required value once the player played', () => {
    expect(checkStatRow(R6_STATS, MAP, row({ rounds_played: 12, kills: 3 }))).toEqual([
      { metric: 'deaths', error: 'required' },
      { metric: 'assists', error: 'required' },
    ]);
  });

  it('refuses what cannot happen in the map', () => {
    expect(checkStatRow(R6_STATS, MAP, { ...FULL, rounds_played: 13 })).toEqual([
      { metric: 'rounds_played', error: 'above_max', limit: 12 },
    ]);
    expect(checkStatRow(R6_STATS, MAP, { ...FULL, rounds_played: 2, kills: 11 })).toEqual([
      { metric: 'kills', error: 'above_max', limit: 10 },
      { metric: 'deaths', error: 'above_max', limit: 2 },
    ]);
    expect(checkStatRow(R6_STATS, MAP, { ...FULL, headshots: 10 })).toEqual([
      { metric: 'headshots', error: 'above_max', limit: 9 },
    ]);
    expect(checkStatRow(R6_STATS, MAP, { ...FULL, kills: -1 })).toEqual([
      { metric: 'kills', error: 'below_min', limit: 0 },
    ]);
    expect(checkStatRow(R6_STATS, MAP, { ...FULL, kills: 2.5 })).toEqual([
      { metric: 'kills', error: 'not_integer' },
    ]);
  });
});

describe('one side’s sheet', () => {
  it('checks each row, and that five players cannot play more rounds than five times the map', () => {
    const five = Array.from({ length: 5 }, () => FULL);
    expect(checkSide(R6_STATS, MAP, five)).toEqual({ rows: [[], [], [], [], []], side: [] });
    const six = [...five, row({ rounds_played: 1, kills: 0, deaths: 0, assists: 0 })];
    expect(checkSide(R6_STATS, MAP, six).side).toEqual([
      { metric: 'rounds_played', error: 'side_above_max', total: 61, limit: 60 },
    ]);
  });
});

describe('the check across sides', () => {
  const side = (kills: number, deaths: number) => [
    row({ rounds_played: 12, kills, deaths, assists: 0 }),
  ];

  it('warns when a side’s kills and the other side’s deaths differ beyond the tolerance', () => {
    expect(crossCheck(R6_STATS, side(30, 20), side(17, 28), 3)).toEqual([]);
    expect(crossCheck(R6_STATS, side(30, 20), side(17, 26), 3)).toEqual([
      { side: 'a', kills: 30, deaths: 26 },
    ]);
    expect(crossCheck(R6_STATS, side(30, 10), side(17, 30), 3)).toEqual([
      { side: 'b', kills: 17, deaths: 10 },
    ]);
  });

  it('says nothing while one side is not entered', () => {
    expect(crossCheck(R6_STATS, side(30, 20), [], 3)).toEqual([]);
  });
});

describe('derived metrics', () => {
  it('divides totals last: K/D, KPR and HS%', () => {
    const totals = { rounds_played: 24, kills: 18, deaths: 12, headshots: 9 };
    expect(computeDerived(R6_STATS, totals)).toMatchObject({ kd: 1.5, kpr: 0.75, hs: 0.5 });
  });

  it('counts kills as K/D without deaths, and leaves what it cannot compute empty', () => {
    expect(computeDerived(R6_STATS, { rounds_played: 12, kills: 7, deaths: 0 })).toMatchObject({
      kd: 7,
      hs: null,
      kost: null,
    });
    expect(computeDerived(R6_STATS, { rounds_played: 0, kills: 0, deaths: 0 })).toMatchObject({
      kpr: null,
    });
  });
});
