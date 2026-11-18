import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, LFR_KEY, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { listLeagues, matchPage, seasonPage, teamPage } from './site.ts';
import { setTeamOwner } from './team-staff.ts';

// What the public pages show (design doc section 7). In leagueDatabase(), LFR's Saison 3 has
// Ligue 1 (Alpha, Bravo, Charlie: Alpha beat Bravo 7–4 in week 1, Charlie forfeited against
// Alpha in week 2, Bravo v Charlie in week 3 is still to play) and Ligue 2 (Xray beat Yankee 8–6).

const STAFF = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};

describe('listLeagues', () => {
  it('lists each competition with its seasons and their URL slugs', () => {
    expect(listLeagues(leagueDatabase())).toEqual([
      {
        competition: { name: 'LFR', slug: 'lfr', path: '/mbl-group/lfr' },
        seasons: [{ name: 'Saison 3', slug: 'saison-3', status: 'active' }],
      },
    ]);
  });
});

describe('seasonPage', () => {
  it('finds a season by the slugs of its competition and its name', () => {
    const page = seasonPage(leagueDatabase(), LFR_KEY, 'saison-3');
    if (!page.ok) throw new Error(page.error);
    expect(page.competition).toMatchObject({ name: 'LFR', slug: 'lfr' });
    expect(page.season).toEqual({ name: 'Saison 3', slug: 'saison-3', status: 'active' });
    expect(page.standings.map((table) => table.division)).toEqual(['Ligue 1', 'Ligue 2']);
    expect(page.standings[0]?.rows.map((row) => row.team.name)).toEqual([
      'Alpha Esport',
      'Charlie',
      'Bravo',
    ]);
  });

  it('groups the fixtures by division and week, with scores only for results that count', () => {
    const db = leagueDatabase();
    db.update(schema.match).set({ status: 'reported' }).where(eq(schema.match.id, 1)).run();
    const page = seasonPage(db, LFR_KEY, 'saison-3');
    if (!page.ok) throw new Error(page.error);
    const [ligue1] = page.fixtures;
    expect(ligue1?.division).toBe('Ligue 1');
    expect(ligue1?.weeks.map((week) => week.week)).toEqual([1, 2, 3]);
    expect(ligue1?.weeks[0]?.matches[0]).toMatchObject({
      id: 1,
      a: { name: 'Alpha Esport', slug: 'alpha-esport' },
      b: { name: 'Bravo', slug: 'bravo' },
      status: 'reported',
      // Reported but not validated yet: no score on the public page.
      result: null,
    });
    expect(ligue1?.weeks[1]?.matches[0]?.result).toEqual({ kind: 'forfeit', by: 'a' });
    expect(ligue1?.weeks[2]?.matches[0]).toMatchObject({ status: 'scheduled', result: null });
  });

  it('lists the latest results that count, latest week first', () => {
    const page = seasonPage(leagueDatabase(), LFR_KEY, 'saison-3');
    if (!page.ok) throw new Error(page.error);
    expect(page.latest.map((line) => [line.id, line.result])).toEqual([
      [2, { kind: 'forfeit', by: 'a' }],
      [1, { kind: 'score', a: 7, b: 4 }],
      [4, { kind: 'score', a: 8, b: 6 }],
    ]);
  });

  it('finds nothing for an unknown competition or season', () => {
    const db = leagueDatabase();
    expect(seasonPage(db, { ...LFR_KEY, competition: 'lfv' }, 'saison-3')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(seasonPage(db, LFR_KEY, 'saison-9')).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('teamPage', () => {
  it('shows the team, its officials by role, and its matches of the latest season', () => {
    const db = leagueDatabase();
    setTeamOwner(
      db,
      STAFF,
      { teamId: 1, member: { id: '700000000000000001', displayName: 'Ana' } },
      100,
    );
    const page = teamPage(db, 'alpha-esport');
    if (!page.ok) throw new Error(page.error);
    expect(page.team).toMatchObject({ name: 'Alpha Esport', tag: 'ALP', slug: 'alpha-esport' });
    expect(page.officials).toEqual([{ name: 'Ana', role: 'owner' }]);
    expect(page.season).toMatchObject({
      competition: { name: 'LFR', slug: 'lfr' },
      season: { name: 'Saison 3', slug: 'saison-3' },
      division: 'Ligue 1',
    });
    expect(page.matches.map((line) => line.id)).toEqual([1, 2]);
  });

  it('finds nothing for an unknown slug', () => {
    expect(teamPage(leagueDatabase(), 'zulu')).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('matchPage', () => {
  it('shows the match, and each game with its map and bans once the result counts', () => {
    const db = leagueDatabase();
    db.update(schema.game)
      .set({
        map: 'Villa',
        bansJson: [
          { side: 'a', map: 'Bank' },
          { side: 'b', map: 'Lair' },
        ],
      })
      .where(eq(schema.game.matchId, 1))
      .run();
    const page = matchPage(db, 1);
    if (!page.ok) throw new Error(page.error);
    expect(page.match).toMatchObject({
      id: 1,
      division: 'Ligue 1',
      week: 1,
      result: { kind: 'score', a: 7, b: 4 },
    });
    expect(page.league).toMatchObject({
      competition: { slug: 'lfr' },
      season: { slug: 'saison-3' },
    });
    expect(page.games).toEqual([
      {
        n: 1,
        map: 'Villa',
        score: { a: 7, b: 4 },
        bans: [
          { team: 'Alpha Esport', map: 'Bank' },
          { team: 'Bravo', map: 'Lair' },
        ],
      },
    ]);
  });

  it('hides a game score that does not count yet', () => {
    const db = leagueDatabase();
    db.update(schema.match).set({ status: 'disputed' }).where(eq(schema.match.id, 1)).run();
    const page = matchPage(db, 1);
    if (!page.ok) throw new Error(page.error);
    expect(page.games[0]?.score).toBeNull();
  });

  it('finds nothing for an unknown match', () => {
    expect(matchPage(leagueDatabase(), 999)).toEqual({ ok: false, error: 'not_found' });
  });
});
