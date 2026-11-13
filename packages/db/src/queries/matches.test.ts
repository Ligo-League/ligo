import { describe, expect, it } from 'vitest';
import { evidence, matchSlot, player } from '../schema/index.ts';
import type { MatchRow } from '../seed/matches-csv.ts';
import type { TeamRow } from '../seed/parse-teams-csv.ts';
import { seedLfr } from '../seed/seed-lfr.ts';
import { seedMatches } from '../seed/seed-matches.ts';
import { openTestDatabase } from '../testing.ts';
import { latestScoreEvidence, listLeagueMatches } from './matches.ts';

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
        division: { id: 1, name: 'Ligue 1', categoryPrefix: 'L1', resultsChannelId: null },
        week: 1,
        bestOf: 1,
        status: 'validated',
        a: { teamId: 3, name: 'Alpha', tag: 'ALP' },
        b: { teamId: 4, name: 'Bravo', tag: 'BRV' },
        reportedBy: null,
        confirmedBy: null,
        game: { id: 2, scoreA: 7, scoreB: 4, forfeitSide: null, status: 'final' },
      },
      {
        id: 2,
        competitionId: 1,
        seasonId: 1,
        stageId: 1,
        division: { id: 1, name: 'Ligue 1', categoryPrefix: 'L1', resultsChannelId: null },
        week: 2,
        bestOf: 1,
        status: 'scheduled',
        a: { teamId: 4, name: 'Bravo', tag: 'BRV' },
        b: { teamId: 3, name: 'Alpha', tag: 'ALP' },
        reportedBy: null,
        confirmedBy: null,
        game: null,
      },
      {
        id: 1,
        competitionId: 1,
        seasonId: 1,
        stageId: 2,
        division: { id: 2, name: 'Ligue 2', categoryPrefix: 'L2', resultsChannelId: null },
        week: 1,
        bestOf: 1,
        status: 'forfeit',
        a: { teamId: 1, name: 'Xray', tag: 'XRA' },
        b: { teamId: 2, name: 'Yankee', tag: 'YAN' },
        reportedBy: null,
        confirmedBy: null,
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

describe('latestScoreEvidence', () => {
  it('returns the newest score screenshot of the match, ignoring other evidence', () => {
    const db = seeded();
    const uploader = db
      .insert(player)
      .values({ orgId: 1, slug: 'uploader', displayName: 'Uploader', createdAt: 1 })
      .returning()
      .get();
    const base = { matchId: 2, uploadedBy: uploader.id, at: 1 };
    db.insert(evidence)
      .values([
        { ...base, kind: 'score_screenshot', url: 'https://example.invalid/first' },
        { ...base, kind: 'score_screenshot', url: 'https://example.invalid/second' },
        { ...base, kind: 'moss', url: 'https://example.invalid/moss' },
        { ...base, matchId: 3, kind: 'score_screenshot', url: 'https://example.invalid/other' },
      ])
      .run();
    expect(latestScoreEvidence(db, 2)).toMatchObject({
      id: 2,
      url: 'https://example.invalid/second',
    });
    expect(latestScoreEvidence(db, 1)).toBeUndefined();
  });
});
