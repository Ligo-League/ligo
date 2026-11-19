import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, mercatoLineups, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import type { Actor } from './permissions.ts';
import { playerPage } from './player-page.ts';
import { ensurePlayer } from './players.ts';
import { saveSheet } from './stat-sheets.ts';

// A player's public page (phase 3i; design doc section 7, M-42): the person once (nationality,
// current teams, game accounts with declared ranks, career), then a tab per game they played
// officially, that is a validated match a stat sheet names them in. In leagueDatabase(), match 1
// is Alpha 7–4 Bravo (validated); mercatoLineups() puts P1 (captain) to P6 in Alpha's Season 3
// lineup and P9 in Bravo's, P9 also on Alpha's list.

const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};

function league() {
  const db = leagueDatabase();
  const ids = mercatoLineups(db);
  const page = (slug: string) => {
    const found = playerPage(db, slug);
    if (!found.ok) throw new Error(found.error);
    return found.player;
  };
  /** P1 in match 1's stat sheet, entered by staff: a match P1 played officially. */
  const p1Played = () =>
    saveSheet(
      db,
      STAFF,
      {
        matchId: 1,
        n: 1,
        side: 'a',
        rows: [
          {
            playerId: ids[0] ?? 0,
            values: { rounds_played: '11', kills: '6', deaths: '3', assists: '2' },
          },
        ],
      },
      1,
    );
  return { db, ids, page, p1Played };
}

describe('a player page', () => {
  it('is not found for a slug no player has', () => {
    expect(playerPage(leagueDatabase(), 'nobody')).toEqual({ ok: false, error: 'not_found' });
  });

  it('exists for every account, even one with nothing to show (M-42)', () => {
    const db = leagueDatabase();
    ensurePlayer(db, { orgId: 1, discordUserId: '700000000000000077', displayName: 'Zed' }, 1);
    expect(playerPage(db, 'zed')).toEqual({
      ok: true,
      player: {
        id: expect.any(Number) as number,
        slug: 'zed',
        name: 'Zed',
        nationality: null,
        statsPublic: false,
        teams: [],
        accounts: [],
        career: [],
        games: [],
      },
    });
  });

  it('shows the person: nationality, current team and role, game account and declared rank', () => {
    const { page } = league();
    expect(page('p1')).toMatchObject({
      name: 'P1',
      nationality: 'FR',
      statsPublic: true,
      teams: [
        { title: 'r6', name: 'Alpha Esport', slug: 'alpha-esport', role: 'player', captain: true },
      ],
      accounts: [{ title: 'r6', name: 'Player1', rank: 'gold', verified: false }],
    });
  });

  it('lists every current team, a roster’s own list included', () => {
    const { page } = league();
    expect(page('p9').teams).toEqual([
      expect.objectContaining({ name: 'Bravo', role: 'player', captain: true }),
      expect.objectContaining({ name: 'Alpha Esport', role: null, captain: false }),
    ]);
  });

  it('never gives the profile ID, Discord ID or birth date', () => {
    const { db, ids, page } = league();
    db.update(schema.gameAccount)
      .set({ externalId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
      .where(eq(schema.gameAccount.playerId, ids[0] ?? 0))
      .run();
    const shown = JSON.stringify(page('p1'));
    expect(shown).not.toContain('aaaaaaaa-bbbb');
    expect(shown).not.toContain('710000000000000001');
    expect(shown).not.toContain('2000-01-01');
  });

  it('gives the career: each season lineup with its division and the team’s rank', () => {
    const { db, page } = league();
    expect(page('p1').career).toEqual([
      {
        title: 'r6',
        competition: { name: 'LFR', path: '/mlb-group/lfr' },
        season: { name: 'Saison 3', path: '/mlb-group/lfr/saison-3', status: 'active' },
        team: { name: 'Alpha Esport', slug: 'alpha-esport', tag: 'ALP' },
        division: 'Ligue 1',
        rank: { place: 1, shared: false, excluded: false },
        role: 'player',
      },
    ]);
    // Once the season is over, the same rank is its final one.
    db.update(schema.season).set({ status: 'closed' }).run();
    expect(page('p1').career[0]?.season.status).toBe('closed');
    expect(page('p1').teams).toEqual([
      expect.objectContaining({ name: 'Alpha Esport', role: null }),
    ]);
  });

  it('opens a game’s tab only once a stat sheet names the player in a counted match', () => {
    const { page, p1Played } = league();
    expect(page('p1').games).toEqual([]);
    p1Played();
    expect(page('p1').games).toEqual(['r6']);
    // P2 is in the same lineup, but no sheet names them.
    expect(page('p2').games).toEqual([]);
  });
});
