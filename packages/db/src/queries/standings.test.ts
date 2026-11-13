import { computeStandings } from '@ligo/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { match, player, sanction, season } from '../schema/index.ts';
import type { MatchRow } from '../seed/matches-csv.ts';
import type { TeamRow } from '../seed/parse-teams-csv.ts';
import { seedLfr } from '../seed/seed-lfr.ts';
import { seedMatches } from '../seed/seed-matches.ts';
import { openTestDatabase } from '../testing.ts';
import { loadStandingsInput } from './standings.ts';

const teamRow = (division: string, tag: string, name: string): TeamRow => ({
  division,
  name,
  tag,
  slug: name.toLowerCase(),
  city: null,
  colors: ['#112233'],
});
// Slots 1-3 in Ligue 1 (stage 1), slot 4-5 in Ligue 2 (stage 2). Entries follow tag order.
const TEAMS = [
  teamRow('Ligue 1', 'ZED', 'Alpha'),
  teamRow('Ligue 1', 'BBB', 'Charlie'),
  teamRow('Ligue 1', 'CCC', 'Bravo'),
  teamRow('Ligue 2', 'XXX', 'Xray'),
  teamRow('Ligue 2', 'YYY', 'Yankee'),
];
const fixture = (
  week: number,
  teamA: string,
  teamB: string,
  result: MatchRow['result'] = { kind: 'none' },
  division = 'Ligue 1',
): MatchRow => ({ division, week, teamA, teamB, result });

function seeded(rows: MatchRow[]) {
  const db = openTestDatabase();
  seedLfr(db, TEAMS, 1000);
  seedMatches(db, rows, 2000);
  return db;
}
const load = (db: ReturnType<typeof seeded>, stageId = 1) => {
  const data = loadStandingsInput(db, stageId);
  if (!data) throw new Error(`No stage ${stageId}`);
  return data;
};

describe('loadStandingsInput', () => {
  it('returns undefined for an unknown stage', () => {
    expect(loadStandingsInput(seeded([]), 99)).toBeUndefined();
  });

  it('lists the stage entries by team name, with what a table needs to show them', () => {
    const { teams, input } = load(seeded([fixture(1, 'BBB', 'CCC')]));
    expect(teams).toEqual([
      {
        entry: 3,
        slotId: 1,
        teamId: 1,
        name: 'Alpha',
        tag: 'ZED',
        slug: 'alpha',
        colors: ['#112233'],
      },
      {
        entry: 2,
        slotId: 3,
        teamId: 3,
        name: 'Bravo',
        tag: 'CCC',
        slug: 'bravo',
        colors: ['#112233'],
      },
      {
        entry: 1,
        slotId: 2,
        teamId: 2,
        name: 'Charlie',
        tag: 'BBB',
        slug: 'charlie',
        colors: ['#112233'],
      },
    ]);
    expect(input.entries).toEqual([3, 2, 1]);
  });

  it('reads the rule settings of the competition and the season', () => {
    const db = seeded([]);
    db.update(season)
      .set({
        settingsJson: {
          forfeit_score: [7, 0],
          map_pool: [],
          forfeits: { warning_at: 2, exclusion_at: 3 },
        },
      })
      .run();
    expect(load(db).input).toMatchObject({
      points: { outcomes: { win: 3, loss: 0 }, forfeit: { winner: 3, loser: 0 } },
      tiebreak: { criteria: ['points', 'diff'], unresolved_tie: 'shared' },
      forfeitScore: [7, 0],
    });
  });

  it('counts validated matches and forfeits of this stage, and nothing else', () => {
    const db = seeded([
      fixture(1, 'BBB', 'CCC', { kind: 'played', scoreA: 7, scoreB: 4 }),
      fixture(2, 'ZED', 'BBB', { kind: 'forfeit', forfeitBy: 'b' }),
      fixture(3, 'CCC', 'ZED'),
      fixture(4, 'CCC', 'BBB', { kind: 'played', scoreA: 7, scoreB: 0 }),
      fixture(5, 'ZED', 'CCC', { kind: 'played', scoreA: 7, scoreB: 1 }),
      fixture(6, 'BBB', 'ZED', { kind: 'played', scoreA: 7, scoreB: 2 }),
      fixture(7, 'CCC', 'ZED', { kind: 'played', scoreA: 7, scoreB: 3 }),
      fixture(1, 'XXX', 'YYY', { kind: 'played', scoreA: 8, scoreB: 6 }, 'Ligue 2'),
    ]);
    // Results that must not count: annulled, and three states before staff validation.
    const set = (id: number, status: 'void' | 'reported' | 'confirmed' | 'disputed') =>
      db.update(match).set({ status }).where(eq(match.id, id)).run();
    set(4, 'void');
    set(5, 'reported');
    set(6, 'confirmed');
    set(7, 'disputed');

    expect(load(db).input.matches).toEqual([
      { id: 1, a: 1, b: 2, result: { kind: 'played', games: [{ a: 7, b: 4 }] } },
      { id: 2, a: 3, b: 1, result: { kind: 'forfeit', forfeitedBy: 'b' } },
    ]);
    expect(load(db, 2).input.matches).toEqual([
      { id: 8, a: 4, b: 5, result: { kind: 'played', games: [{ a: 8, b: 6 }] } },
    ]);
  });

  it('turns sanctions with points into deltas for the entries of this stage', () => {
    const db = seeded([]);
    const staff = db
      .insert(player)
      .values({ orgId: 1, slug: 'staff', displayName: 'Staff', createdAt: 1 })
      .returning()
      .get();
    const base = { seasonId: 1, startsAt: 1, reason: 'test', decidedBy: staff.id };
    db.insert(sanction)
      .values([
        { ...base, targetKind: 'slot', targetId: 1, kind: 'points', pointsDelta: -2 },
        { ...base, targetKind: 'team', targetId: 3, kind: 'points', pointsDelta: -1 },
        { ...base, targetKind: 'slot', targetId: 1, kind: 'warning' },
        { ...base, targetKind: 'slot', targetId: 4, kind: 'points', pointsDelta: -5 },
        { ...base, targetKind: 'player', targetId: 1, kind: 'points', pointsDelta: -9 },
      ])
      .run();

    expect(load(db).input.pointDeltas).toEqual([
      { entry: 3, delta: -2 },
      { entry: 2, delta: -1 },
    ]);
    expect(load(db, 2).input.pointDeltas).toEqual([{ entry: 4, delta: -5 }]);
  });

  it('feeds computeStandings directly', () => {
    const db = seeded([
      fixture(1, 'BBB', 'CCC', { kind: 'played', scoreA: 7, scoreB: 4 }),
      fixture(2, 'ZED', 'BBB', { kind: 'forfeit', forfeitBy: 'b' }),
    ]);
    const { input, teams } = load(db);
    const result = computeStandings(input);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const tagOf = (entry: number) => teams.find((team) => team.entry === entry)?.tag;
    expect(result.rows.map((row) => [tagOf(row.entry), row.played, row.points, row.diff])).toEqual([
      ['BBB', 2, 3, 3],
      ['ZED', 1, 3, 0],
      ['CCC', 1, 0, -3],
    ]);
  });
});
