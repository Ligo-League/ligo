import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, mercatoLineups, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import type { Actor } from './permissions.ts';
import { matchScoreboard } from './scoreboard.ts';
import { saveSheet } from './stat-sheets.ts';
import { setTeamOwner } from './team-staff.ts';

// The public scoreboard on the match page (design doc sections 7 and 9; M-39). Match 1 is
// Alpha (side A) 7–4 Bravo (side B), validated: 11 rounds. Alpha's lineup is P1 to P6, Bravo's P9.

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

function league() {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 1, member: ALPHA.user }, 1);
  const ids = mercatoLineups(db);
  const p = (n: number) => ids[n - 1] ?? 0;
  const row = (n: number, values: (number | '')[]) => ({
    playerId: p(n),
    values: Object.fromEntries(
      ['rounds_played', 'kills', 'deaths', 'assists', 'headshots'].map((key, i) => [
        key,
        String(values[i] ?? ''),
      ]),
    ),
  });
  const save = (actor: Actor, side: 'a' | 'b', rows: ReturnType<typeof row>[]) =>
    saveSheet(db, actor, { matchId: 1, n: 1, side, rows }, NOW);
  return { db, p, row, save };
}

describe('the scoreboard of a match', () => {
  it('shows each side’s players with their figures and the derived ratios', () => {
    const { db, row, save } = league();
    save(ALPHA, 'a', [row(1, [11, 6, 3, 2, 3]), row(2, [11, 2, 0, 1, ''])]);
    save(STAFF, 'b', [row(9, [11, 3, 8, 0, ''])]);
    const board = matchScoreboard(db, 1);
    expect(board?.columns.map((column) => column.key)).toEqual([
      'rounds_played',
      'kills',
      'deaths',
      'assists',
      'kd',
      'kpr',
      'hs',
    ]);
    const [a, b] = board?.games[0]?.sides ?? [];
    expect(a?.team).toBe('Alpha Esport');
    // Best first: by kills.
    expect(a?.rows.map((entry) => [entry.name, entry.values.kills, entry.values.kd])).toEqual([
      ['P1', 6, 2],
      ['P2', 2, 2],
    ]);
    expect(a?.rows[0]?.values.hs).toBe(0.5);
    expect(a?.rows[1]?.values.hs).toBeNull();
    expect(b?.rows.map((entry) => entry.name)).toEqual(['P9']);
  });

  it('leaves out a side the opponent entered until its own team confirms it', () => {
    const { db, row, save } = league();
    save(ALPHA, 'a', [row(1, [11, 6, 3, 2, ''])]);
    save(ALPHA, 'b', [row(9, [11, 3, 8, 0, ''])]);
    expect(matchScoreboard(db, 1)?.games[0]?.sides[1]?.rows).toEqual([]);
  });

  it('names a player without stats consent, without their figures', () => {
    const { db, p, row, save } = league();
    db.update(schema.player)
      .set({ statsConsentAt: null })
      .where(eq(schema.player.id, p(2)))
      .run();
    save(ALPHA, 'a', [row(1, [11, 6, 3, 2, '']), row(2, [11, 2, 0, 1, ''])]);
    const rows = matchScoreboard(db, 1)?.games[0]?.sides[0]?.rows;
    expect(rows?.find((entry) => entry.name === 'P2')).toEqual({
      playerId: p(2),
      name: 'P2',
      slug: 'p2',
      hidden: true,
      values: {},
    });
  });

  it('is empty without stats, and waits for the result to be validated', () => {
    const { db, row, save } = league();
    expect(matchScoreboard(db, 1)).toBeNull();
    save(ALPHA, 'a', [row(1, [11, 6, 3, 2, ''])]);
    db.update(schema.match).set({ status: 'reported' }).where(eq(schema.match.id, 1)).run();
    expect(matchScoreboard(db, 1)).toBeNull();
  });
});
