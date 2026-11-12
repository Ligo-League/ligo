import { describe, expect, it } from 'vitest';
import { auditLog, game, match, matchSlot, stage, stageEntry } from '../schema/index.ts';
import { openTestDatabase } from '../testing.ts';
import type { MatchRow } from './matches-csv.ts';
import type { TeamRow } from './parse-teams-csv.ts';
import { seedLfr } from './seed-lfr.ts';
import { seedMatches } from './seed-matches.ts';

const teamRow = (division: string, tag: string): TeamRow => ({
  division,
  name: `Team ${tag}`,
  tag,
  slug: `team-${tag.toLowerCase()}`,
  city: null,
  colors: [],
});
const TEAMS = [
  teamRow('Ligue 1', 'BBB'),
  teamRow('Ligue 1', 'AAA'),
  teamRow('Ligue 1', 'CCC'),
  teamRow('Ligue 2', 'XXX'),
  teamRow('Ligue 2', 'YYY'),
];
const fixture = (
  week: number,
  teamA: string,
  teamB: string,
  result: MatchRow['result'] = { kind: 'none' },
  division = 'Ligue 1',
): MatchRow => ({ division, week, teamA, teamB, result });

const ROWS: MatchRow[] = [
  fixture(1, 'AAA', 'BBB', { kind: 'played', scoreA: 7, scoreB: 4 }),
  fixture(2, 'CCC', 'AAA', { kind: 'forfeit', forfeitBy: 'a' }),
  fixture(3, 'BBB', 'CCC'),
  fixture(1, 'XXX', 'YYY', { kind: 'draw', scoreA: 0, scoreB: 0 }, 'Ligue 2'),
];

function seeded() {
  const db = openTestDatabase();
  seedLfr(db, TEAMS, 1000);
  return db;
}

describe('seedMatches', () => {
  it('creates a published round-robin stage per division with an entry per slot', () => {
    const db = seeded();
    const summary = seedMatches(db, ROWS, 2000);

    expect(summary.created).toEqual({ stages: 2, entries: 5, matches: 4 });
    expect(db.select().from(stage).all()).toMatchObject([
      { divisionId: 1, kind: 'round_robin', status: 'published', ord: 1 },
      { divisionId: 2, kind: 'round_robin', status: 'published', ord: 1 },
    ]);
    // Entries are seeded in tag order: AAA, BBB, CCC.
    expect(db.select().from(stageEntry).all()).toMatchObject([
      { stageId: 1, slotId: 2, seed: 1 },
      { stageId: 1, slotId: 1, seed: 2 },
      { stageId: 1, slotId: 3, seed: 3 },
      { stageId: 2, slotId: 4, seed: 1 },
      { stageId: 2, slotId: 5, seed: 2 },
    ]);
  });

  it('stores a played match as validated and a forfeit without rounds', () => {
    const db = seeded();
    const summary = seedMatches(db, ROWS, 2000);

    expect(summary.results).toEqual({ played: 1, forfeits: 1 });
    expect(db.select().from(match).all()).toMatchObject([
      { stageId: 1, week: 1, bestOf: 1, status: 'validated', validatedAt: 2000, validatedBy: null },
      { stageId: 1, week: 2, status: 'forfeit', validatedAt: 2000 },
      { stageId: 1, week: 3, status: 'scheduled', validatedAt: null },
      { stageId: 2, week: 1, status: 'scheduled' },
    ]);
    expect(db.select().from(matchSlot).all().slice(0, 4)).toMatchObject([
      { matchId: 1, side: 'a', sourceKind: 'entry', sourceRef: 1 },
      { matchId: 1, side: 'b', sourceKind: 'entry', sourceRef: 2 },
      { matchId: 2, side: 'a', sourceKind: 'entry', sourceRef: 3 },
      { matchId: 2, side: 'b', sourceKind: 'entry', sourceRef: 1 },
    ]);
    expect(db.select().from(game).all()).toMatchObject([
      { matchId: 1, n: 1, scoreA: 7, scoreB: 4, forfeitSide: null, status: 'final' },
      { matchId: 2, n: 1, scoreA: 0, scoreB: 0, forfeitSide: 'a', status: 'final' },
    ]);
  });

  it('gives each match its week of play in French time', () => {
    const db = seeded();
    seedMatches(db, ROWS, 2000);
    const [week1, week2] = db.select().from(match).all();
    // Season 3 starts on Monday 19 October 2026; the clocks go back on the 25th.
    expect(new Date(week1?.windowStart ?? 0).toISOString()).toBe('2026-10-18T22:00:00.000Z');
    expect(new Date(week1?.windowEnd ?? 0).toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(week2?.windowStart).toBe(week1?.windowEnd);
  });

  it('leaves a drawn row without result and reports it', () => {
    const db = seeded();
    expect(seedMatches(db, ROWS, 2000).draws).toEqual(['Ligue 2, week 1, XXX v YYY: 0-0']);
  });

  it('changes nothing when run again with the same file', () => {
    const db = seeded();
    seedMatches(db, ROWS, 2000);
    const dump = () => db.$client.serialize().toString('base64');
    const before = dump();

    const summary = seedMatches(db, ROWS, 3000);

    expect(summary).toMatchObject({
      created: { stages: 0, entries: 0, matches: 0 },
      results: { played: 0, forfeits: 0 },
      conflicts: [],
    });
    expect(dump()).toBe(before);
  });

  it('adds new results and new fixtures from a newer file', () => {
    const db = seeded();
    seedMatches(db, ROWS, 2000);
    const newer = [
      ...ROWS.slice(0, 2),
      fixture(3, 'BBB', 'CCC', { kind: 'played', scoreA: 5, scoreB: 7 }),
      ROWS[3] ?? fixture(1, 'XXX', 'YYY', undefined, 'Ligue 2'),
      fixture(2, 'YYY', 'XXX', undefined, 'Ligue 2'),
    ];

    const summary = seedMatches(db, newer, 3000);

    expect(summary.created).toEqual({ stages: 0, entries: 0, matches: 1 });
    expect(summary.results).toEqual({ played: 1, forfeits: 0 });
    expect(db.select().from(match).all()).toHaveLength(5);
    expect(db.select().from(game).all()).toMatchObject([
      { matchId: 1 },
      { matchId: 2 },
      { matchId: 3, scoreA: 5, scoreB: 7 },
    ]);
  });

  it('reports a stored result that differs from the file and leaves it alone', () => {
    const db = seeded();
    seedMatches(db, ROWS, 2000);
    const changed = [
      fixture(1, 'AAA', 'BBB', { kind: 'played', scoreA: 7, scoreB: 5 }),
      fixture(2, 'CCC', 'AAA', { kind: 'played', scoreA: 7, scoreB: 2 }),
      fixture(3, 'CCC', 'BBB'),
    ];

    const summary = seedMatches(db, changed, 3000);

    expect(summary.conflicts).toEqual([
      'Ligue 1, week 1, AAA v BBB: stored as validated, the file says otherwise',
      'Ligue 1, week 2, CCC v AAA: stored as forfeit, the file says otherwise',
      'Ligue 1, week 3, CCC v BBB: stored with the two sides the other way round',
    ]);
    expect(summary.results).toEqual({ played: 0, forfeits: 0 });
    expect(db.select().from(game).all()).toMatchObject([
      { matchId: 1, scoreA: 7, scoreB: 4 },
      { matchId: 2, forfeitSide: 'a' },
    ]);
  });

  it('records one system audit entry per run that changed something', () => {
    const db = seeded();
    seedMatches(db, ROWS, 2000);
    seedMatches(db, ROWS, 3000);
    const entries = db.select().from(auditLog).all();
    expect(entries.filter((entry) => entry.action === 'seed.lfr.matches')).toMatchObject([
      { actorKind: 'system', entity: 'season', entityId: '1', at: 2000 },
    ]);
  });

  it('refuses to run before the teams are seeded, and rolls back on an unknown team', () => {
    expect(() => seedMatches(openTestDatabase(), ROWS, 2000)).toThrow(/season does not exist/);
    const db = seeded();
    expect(() => seedMatches(db, [...ROWS, fixture(4, 'AAA', 'ZZZ')], 2000)).toThrow(/not seeded/);
    expect(db.select().from(match).all()).toEqual([]);
    expect(db.select().from(stage).all()).toEqual([]);
  });
});
