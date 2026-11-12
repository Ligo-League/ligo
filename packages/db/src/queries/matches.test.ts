import { describe, expect, it } from 'vitest';
import { matchSlot } from '../schema/index.ts';
import type { MatchRow } from '../seed/matches-csv.ts';
import type { TeamRow } from '../seed/parse-teams-csv.ts';
import { seedLfr } from '../seed/seed-lfr.ts';
import { seedMatches } from '../seed/seed-matches.ts';
import { openTestDatabase } from '../testing.ts';
import { listLeagueMatches } from './matches.ts';

const teamRow = (division: string, tag: string, name: string): TeamRow => ({
  division,
  name,
  tag,
  slug: name.toLowerCase(),
  city: null,
  colors: [],
});
const TEAMS = [
  teamRow('Ligue 2', 'XRA', 'Xray'),
  teamRow('Ligue 2', 'YAN', 'Yankee'),
  teamRow('Ligue 1', 'ALP', 'Alpha'),
  teamRow('Ligue 1', 'BRV', 'Bravo'),
];
const fixture = (
  division: string,
  week: number,
  teamA: string,
  teamB: string,
  result: MatchRow['result'] = { kind: 'none' },
): MatchRow => ({ division, week, teamA, teamB, result });

function seeded() {
  const db = openTestDatabase();
  seedLfr(db, TEAMS, 1000);
  seedMatches(
    db,
    [
      fixture('Ligue 2', 1, 'XRA', 'YAN', { kind: 'forfeit', forfeitBy: 'b' }),
      fixture('Ligue 1', 2, 'BRV', 'ALP'),
      fixture('Ligue 1', 1, 'ALP', 'BRV', { kind: 'played', scoreA: 7, scoreB: 4 }),
    ],
    2000,
  );
  return db;
}

describe('listLeagueMatches', () => {
  it('lists a season by division level, then week, with teams and the first game', () => {
    expect(listLeagueMatches(seeded(), { seasonId: 1 })).toEqual([
      {
        id: 3,
        competitionId: 1,
        seasonId: 1,
        stageId: 1,
        division: { name: 'Ligue 1', categoryPrefix: 'L1' },
        week: 1,
        bestOf: 1,
        status: 'validated',
        a: { name: 'Alpha', tag: 'ALP' },
        b: { name: 'Bravo', tag: 'BRV' },
        game: { id: 2, scoreA: 7, scoreB: 4, forfeitSide: null, status: 'final' },
      },
      {
        id: 2,
        competitionId: 1,
        seasonId: 1,
        stageId: 1,
        division: { name: 'Ligue 1', categoryPrefix: 'L1' },
        week: 2,
        bestOf: 1,
        status: 'scheduled',
        a: { name: 'Bravo', tag: 'BRV' },
        b: { name: 'Alpha', tag: 'ALP' },
        game: null,
      },
      {
        id: 1,
        competitionId: 1,
        seasonId: 1,
        stageId: 2,
        division: { name: 'Ligue 2', categoryPrefix: 'L2' },
        week: 1,
        bestOf: 1,
        status: 'forfeit',
        a: { name: 'Xray', tag: 'XRA' },
        b: { name: 'Yankee', tag: 'YAN' },
        game: { id: 1, scoreA: 0, scoreB: 0, forfeitSide: 'b', status: 'final' },
      },
    ]);
  });

  it('finds one match by its ID, and nothing for an unknown ID or season', () => {
    const db = seeded();
    expect(listLeagueMatches(db, { matchId: 2 })).toMatchObject([{ id: 2, week: 2 }]);
    expect(listLeagueMatches(db, { matchId: 99 })).toEqual([]);
    expect(listLeagueMatches(db, { seasonId: 99 })).toEqual([]);
  });

  it('leaves out a match that still waits for a team', () => {
    const db = seeded();
    db.update(matchSlot).set({ sourceKind: 'winner_of' }).run();
    expect(listLeagueMatches(db, { seasonId: 1 })).toEqual([]);
  });
});
