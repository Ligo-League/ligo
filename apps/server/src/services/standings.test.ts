import { schema } from '@ligo/db';
import { openTestDatabase } from '@ligo/db/testing';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD } from '../testing.ts';
import { getStandings } from './standings.ts';

describe('getStandings', () => {
  it('computes every division of the current season for the server', () => {
    const standings = getStandings(leagueDatabase(), { guildId: TEST_GUILD });
    expect(standings).toMatchObject({ ok: true, competition: 'LFR', season: 'Saison 3' });
    if (!standings.ok) return;
    expect(standings.tables.map((table) => table.division)).toEqual(['Ligue 1', 'Ligue 2']);
    expect(standings.tables[0]?.rows).toEqual([
      {
        rank: 1,
        shared: false,
        team: { name: 'Alpha Esport', tag: 'ALP', colors: ['#112233', '#FFFFFF'] },
        played: 2,
        wins: 2,
        losses: 0,
        scoreFor: 7,
        scoreAgainst: 4,
        diff: 3,
        points: 6,
      },
      {
        rank: 2,
        shared: false,
        team: { name: 'Charlie', tag: 'CHA', colors: ['#112233', '#FFFFFF'] },
        played: 1,
        wins: 0,
        losses: 1,
        scoreFor: 0,
        scoreAgainst: 0,
        diff: 0,
        points: 0,
      },
      {
        rank: 3,
        shared: false,
        team: { name: 'Bravo', tag: 'BRV', colors: ['#112233', '#FFFFFF'] },
        played: 1,
        wins: 0,
        losses: 1,
        scoreFor: 4,
        scoreAgainst: 7,
        diff: -3,
        points: 0,
      },
    ]);
  });

  it.each(['Ligue 2', 'ligue 2', '  L2 ', 'l2'])('narrows to one division given %j', (division) => {
    const standings = getStandings(leagueDatabase(), { guildId: TEST_GUILD, division });
    expect(standings.ok && standings.tables.map((table) => table.division)).toEqual(['Ligue 2']);
  });

  it('lists the divisions when the one asked for does not exist', () => {
    expect(getStandings(leagueDatabase(), { guildId: TEST_GUILD, division: 'Ligue 3' })).toEqual({
      ok: false,
      error: 'unknown_division',
      divisions: ['Ligue 1', 'Ligue 2'],
    });
  });

  it('treats an empty division as no division', () => {
    const standings = getStandings(leagueDatabase(), { guildId: TEST_GUILD, division: '  ' });
    expect(standings.ok && standings.tables).toHaveLength(2);
  });

  it.each([null, '999999999999999999'])('knows no league for server %j', (guildId) => {
    expect(getStandings(leagueDatabase(), { guildId })).toEqual({ ok: false, error: 'not_linked' });
    expect(getStandings(openTestDatabase(), { guildId })).toEqual({
      ok: false,
      error: 'not_linked',
    });
  });

  it('says so when no season has left registration', () => {
    const db = leagueDatabase();
    db.update(schema.season).set({ status: 'registration' }).run();
    expect(getStandings(db, { guildId: TEST_GUILD })).toEqual({ ok: false, error: 'no_season' });
  });

  it('says so when the season has no league stage yet', () => {
    const db = leagueDatabase();
    db.update(schema.stage).set({ kind: 'single_elim' }).run();
    expect(getStandings(db, { guildId: TEST_GUILD })).toEqual({ ok: false, error: 'no_standings' });
  });

  it('throws when the settings ask for a criterion the engine cannot compute', () => {
    const db = leagueDatabase();
    db.update(schema.competition)
      .set({ tiebreakJson: { criteria: ['points', 'h2h_points'], unresolved_tie: 'shared' } })
      .run();
    expect(() => getStandings(db, { guildId: TEST_GUILD })).toThrow(/unsupported_criterion/);
  });
});
