import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, mercatoLineups, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import type { Actor } from './permissions.ts';
import { playerStats } from './player-stats.ts';
import { recordResult } from './results.ts';
import { saveSheet } from './stat-sheets.ts';
import { setTeamOwner } from './team-staff.ts';

// A game's tab on the player page (phase 3i; design doc sections 7 and 9, M-42): the matches a
// stat sheet names the player in, totals per season and per map, summed first and divided last,
// from verified stats of validated matches only; no figures without stats consent.
// In leagueDatabase(): match 1 is Alpha 7–4 Bravo (validated), match 3 Bravo v Charlie (open).
// mercatoLineups(): P1 to P6 for Alpha, P9 for Bravo.

const NOW = 1_800_000_000_000;
const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const ALPHA: Actor = {
  guildId: TEST_GUILD,
  user: { id: '700000000000000002', displayName: 'Alpha Manager' },
  memberRoleIds: [],
};
const METRICS = ['rounds_played', 'kills', 'deaths', 'assists', 'headshots'];

function league() {
  const db = leagueDatabase();
  const ids = mercatoLineups(db);
  const p = (n: number) => ids[n - 1] ?? 0;
  const row = (n: number, values: (number | '')[]) => ({
    playerId: p(n),
    values: Object.fromEntries(METRICS.map((key, i) => [key, String(values[i] ?? '')])),
  });
  const sheet = (
    actor: Actor,
    matchId: number,
    side: 'a' | 'b',
    rows: ReturnType<typeof row>[],
  ) => {
    const reply = saveSheet(db, actor, { matchId, n: 1, side, rows }, NOW);
    if (!reply.ok) throw new Error(JSON.stringify(reply));
  };
  /** P9 plays match 1 for Bravo (3 kills, 8 deaths, 1 headshot), then match 3 (9 kills, 2 deaths). */
  const p9TwoMatches = () => {
    sheet(STAFF, 1, 'b', [row(9, [11, 3, 8, 0, 1])]);
    expect(recordResult(db, STAFF, { matchId: 3, scoreA: 7, scoreB: 5 }, NOW)).toMatchObject({
      ok: true,
    });
    sheet(STAFF, 3, 'a', [row(9, [12, 9, 2, 1, ''])]);
  };
  return { db, p, row, sheet, p9TwoMatches };
}

describe('a player’s matches in one game', () => {
  it('lists each match a sheet names them in, with the team’s result and their figures', () => {
    const { db, p, row, sheet } = league();
    sheet(STAFF, 1, 'a', [row(1, [11, 6, 3, 2, 3])]);
    const stats = playerStats(db, p(1), 'r6');
    expect(stats.hidden).toBe(false);
    expect(stats.matches).toEqual([
      {
        id: 1,
        at: expect.any(Number) as number,
        competition: { name: 'LFR', path: '/mlb-group/lfr' },
        season: { name: 'Saison 3', path: '/mlb-group/lfr/saison-3' },
        team: { name: 'Alpha Esport', slug: 'alpha-esport', tag: 'ALP' },
        opponent: { name: 'Bravo', slug: 'bravo', tag: 'BRV' },
        result: 'win',
        games: [
          {
            n: 1,
            map: null,
            scoreFor: 7,
            scoreAgainst: 4,
            values: expect.objectContaining({ kills: 6, deaths: 3, kd: 2 }) as unknown,
          },
        ],
      },
    ]);
    // P2 is in Alpha's lineup, but no sheet names them.
    expect(playerStats(db, p(2), 'r6').matches).toEqual([]);
  });

  it('sums first and divides last, each ratio over the games that have what it needs', () => {
    const { db, p, p9TwoMatches } = league();
    p9TwoMatches();
    const { seasons, matches } = playerStats(db, p(9), 'r6');
    // The latest match first.
    expect(matches.map((entry) => [entry.id, entry.result])).toEqual([
      [3, 'win'],
      [1, 'loss'],
    ]);
    expect(seasons).toEqual([
      {
        competition: { name: 'LFR', path: '/mlb-group/lfr' },
        season: { name: 'Saison 3', path: '/mlb-group/lfr/saison-3' },
        games: 2,
        values: expect.objectContaining({
          rounds_played: 23,
          kills: 12,
          deaths: 10,
          // 12 / 10, not the average of 0.375 and 4.5.
          kd: 1.2,
          // Headshots were entered in match 1 only: 1 of its 3 kills.
          hs: 1 / 3,
        }) as unknown,
      },
    ]);
  });

  it('splits the totals by map', () => {
    const { db, p, p9TwoMatches } = league();
    p9TwoMatches();
    db.update(schema.game).set({ map: 'Clubhouse' }).where(eq(schema.game.matchId, 1)).run();
    db.update(schema.game).set({ map: 'Lair' }).where(eq(schema.game.matchId, 3)).run();
    expect(
      playerStats(db, p(9), 'r6').maps.map((entry) => [entry.map, entry.games, entry.values.kills]),
    ).toEqual([
      ['Clubhouse', 1, 3],
      ['Lair', 1, 9],
    ]);
  });

  it('counts only verified stats of validated matches', () => {
    const { db, p, row, sheet } = league();
    setTeamOwner(db, STAFF, { teamId: 1, member: ALPHA.user }, 1);
    // Alpha enters Bravo's side: it waits for Bravo's confirmation.
    sheet(ALPHA, 1, 'b', [row(9, [11, 3, 8, 0, ''])]);
    expect(playerStats(db, p(9), 'r6').matches).toEqual([]);
    sheet(STAFF, 1, 'b', [row(9, [11, 3, 8, 0, ''])]);
    expect(playerStats(db, p(9), 'r6').matches).toHaveLength(1);
    db.update(schema.match).set({ status: 'void' }).where(eq(schema.match.id, 1)).run();
    expect(playerStats(db, p(9), 'r6').matches).toEqual([]);
  });

  it('lists the matches of a player without stats consent, with no figures at all', () => {
    const { db, p, row, sheet } = league();
    sheet(STAFF, 1, 'a', [row(1, [11, 6, 3, 2, 3])]);
    db.update(schema.player)
      .set({ statsConsentAt: null })
      .where(eq(schema.player.id, p(1)))
      .run();
    const stats = playerStats(db, p(1), 'r6');
    expect(stats).toMatchObject({ hidden: true, columns: [], seasons: [], maps: [] });
    expect(stats.matches[0]).toMatchObject({
      result: 'win',
      games: [{ scoreFor: 7, values: null }],
    });
    expect(JSON.stringify(stats)).not.toContain('"kills"');
  });

  it('names the columns the page shows: the grid’s metrics, then the ratios that have values', () => {
    const { db, p, row, sheet } = league();
    sheet(STAFF, 1, 'a', [row(1, [11, 6, 3, 2, 3])]);
    expect(playerStats(db, p(1), 'r6').columns.map((column) => column.key)).toEqual([
      'rounds_played',
      'kills',
      'deaths',
      'assists',
      'kd',
      'kpr',
      'hs',
    ]);
  });
});
