import { schema } from '@ligo/db';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  leagueDatabase,
  mercatoLineups,
  rosterPlayerForTests,
  TEST_GUILD,
  TEST_STAFF_ROLE,
} from '../testing.ts';
import type { Actor } from './permissions.ts';
import {
  checkSheet,
  confirmSheet,
  saveSheet,
  statGrid,
  type SheetRowInput,
} from './stat-sheets.ts';
import { setTeamOwner } from './team-staff.ts';

// The manual stat grid (design doc section 7; M-39). Match 1 is Alpha (side A) 7-4 Bravo (side B),
// validated: 11 rounds. Alpha's lineup is P1 to P6 (`mercatoLineups`); Bravo's is P9 to P13.

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
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
const BRAVO: Actor = {
  guildId: TEST_GUILD,
  user: { id: '700000000000000003', displayName: 'Bravo Owner' },
  memberRoleIds: [],
};

function league() {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 1, member: ALPHA.user }, 1);
  setTeamOwner(db, STAFF, { teamId: 2, member: BRAVO.user }, 1);
  const ids = mercatoLineups(db);
  const seasonId = db.select().from(schema.season).get()?.id ?? 0;
  for (let n = 10; n <= 13; n += 1) {
    const id = rosterPlayerForTests(db, 2, n);
    db.insert(schema.rosterEntry)
      .values({ seasonId, teamId: 2, playerId: id, role: 'player', validFrom: 1 })
      .run();
    ids.push(id);
  }
  const p = (n: number) => ids[n - 1] ?? 0;
  /** A row of the grid as typed: rounds, kills, deaths, assists, headshots. */
  const row = (n: number, values: [number, number, number, number, number | '']) => ({
    playerId: p(n),
    values: {
      rounds_played: String(values[0]),
      kills: String(values[1]),
      deaths: String(values[2]),
      assists: String(values[3]),
      headshots: String(values[4]),
    },
  });
  const alphaRows: SheetRowInput[] = [1, 2, 3, 4, 5].map((n) => row(n, [11, 4, 2, 1, 2]));
  const bravoRows: SheetRowInput[] = [9, 10, 11, 12, 13].map((n) => row(n, [11, 2, 4, 1, '']));
  const save = (actor: Actor, side: 'a' | 'b', rows: SheetRowInput[], at = NOW) =>
    saveSheet(db, actor, { matchId: 1, n: 1, side, rows }, at);
  const stats = (playerId: number) =>
    db
      .select()
      .from(schema.stat)
      .where(and(eq(schema.stat.gameId, 1), eq(schema.stat.playerId, playerId)))
      .all();
  return { db, p, row, alphaRows, bravoRows, save, stats };
}

describe('the stat grid of a game', () => {
  it('lists each side’s lineup and the title’s columns, open to both teams', () => {
    const { db, p } = league();
    const view = statGrid(db, ALPHA, 1, null, NOW);
    if (!view.ok) throw new Error(view.error);
    expect(view.game).toEqual({ n: 1, map: null, scoreA: 7, scoreB: 4, lock: null });
    expect(view.metrics.map((metric) => metric.key)).toEqual([
      'rounds_played',
      'kills',
      'deaths',
      'assists',
      'headshots',
    ]);
    const [a, b] = view.sides;
    expect(a?.rows.map((entry) => entry.playerId)).toEqual([1, 2, 3, 4, 5, 6].map(p));
    expect(a?.rows[0]?.values).toEqual({
      rounds_played: null,
      kills: null,
      deaths: null,
      assists: null,
      headshots: null,
    });
    // Starters by name, then substitutes.
    expect(b?.rows.map((entry) => entry.name)).toEqual(['P10', 'P11', 'P12', 'P13', 'P9']);
    // Alpha may enter its own side, and Bravo's while Bravo has not.
    expect([a?.canEdit, b?.canEdit, a?.canConfirm, b?.canConfirm]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('is for the match’s teams and league staff only', () => {
    const { db } = league();
    const stranger = { ...ALPHA, user: { id: '700000000000000099', displayName: 'X' } };
    expect(statGrid(db, stranger, 1, null, NOW)).toEqual({ ok: false, error: 'not_allowed' });
    expect(statGrid(db, STAFF, 1, null, NOW)).toMatchObject({ ok: true, staff: true });
    expect(statGrid(db, ALPHA, 1, 9, NOW)).toEqual({ ok: false, error: 'no_game' });
  });
});

describe('saving a side', () => {
  it('stores the team’s own side at once, with the match lineup and the game’s source', () => {
    const { db, p, alphaRows, save, stats } = league();
    expect(save(ALPHA, 'a', alphaRows)).toEqual({ ok: true, enteredAs: 'own' });
    expect(stats(p(1))).toHaveLength(5);
    expect(stats(p(1)).every((entry) => entry.verified && entry.source === 'manual')).toBe(true);
    // P6 left empty: no stats, not in the lineup.
    expect(stats(p(6))).toEqual([]);
    const members = db.select().from(schema.lineupMember).all();
    expect(members.map((member) => member.playerId).sort((x, y) => x - y)).toEqual(
      [1, 2, 3, 4, 5].map(p),
    );
    expect(db.select().from(schema.game).where(eq(schema.game.id, 1)).get()?.statsSource).toBe(
      'manual',
    );
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'stats.sheet',
      afterJson: { side: 'a', enteredAs: 'own', players: 5 },
    });
    // Saving again replaces the side: P5 did not play after all.
    save(ALPHA, 'a', alphaRows.slice(0, 4));
    expect(stats(p(5))).toEqual([]);
    expect(db.select().from(schema.lineupMember).all()).toHaveLength(4);
  });

  it('refuses impossible values and players outside the side, storing nothing', () => {
    const { db, p, row, save } = league();
    const reply = save(ALPHA, 'a', [row(1, [12, 4, 2, 1, 5]), row(9, [11, 1, 1, 1, ''])]);
    expect(reply.ok).toBe(false);
    if (reply.ok || !reply.check) throw new Error('refused with a check');
    expect(reply.error).toBe('invalid');
    expect(reply.check.rows.get(p(1))).toEqual([
      { metric: 'rounds_played', error: 'above_max', limit: 11 },
      { metric: 'headshots', error: 'above_max', limit: 4 },
    ]);
    expect(reply.check.unknown).toEqual([p(9)]);
    expect(db.select().from(schema.stat).all()).toEqual([]);
    expect(
      checkSheet(
        db,
        ALPHA,
        { matchId: 1, n: 1, side: 'a', rows: [row(1, [11, 4, 2, 1, 'x' as never])] },
        NOW,
      ),
    ).toMatchObject({
      ok: true,
      check: { rows: new Map([[p(1), [{ metric: 'headshots', error: 'not_integer' }]]]) },
    });
  });
});

describe('a side entered by the opponent', () => {
  it('waits for its own team’s confirmation, then counts', () => {
    const { db, p, bravoRows, save, stats } = league();
    expect(save(ALPHA, 'b', bravoRows)).toEqual({ ok: true, enteredAs: 'opponent' });
    expect(stats(p(9)).every((entry) => !entry.verified)).toBe(true);
    const seen = statGrid(db, BRAVO, 1, null, NOW);
    expect(seen.ok && seen.sides[1]).toMatchObject({
      entry: { enteredAs: 'opponent', enteredBy: 'Alpha Manager', confirmed: false },
      canConfirm: true,
    });
    expect(confirmSheet(db, ALPHA, { matchId: 1, n: 1, side: 'b' }, NOW)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    expect(confirmSheet(db, BRAVO, { matchId: 1, n: 1, side: 'b' }, NOW)).toEqual({ ok: true });
    expect(stats(p(9)).every((entry) => entry.verified)).toBe(true);
    expect(confirmSheet(db, BRAVO, { matchId: 1, n: 1, side: 'b' }, NOW)).toEqual({
      ok: false,
      error: 'nothing_to_confirm',
    });
    // Confirmed, it is Bravo's: Alpha cannot change it any more.
    expect(save(ALPHA, 'b', bravoRows)).toEqual({ ok: false, error: 'not_allowed' });
    expect(save(BRAVO, 'b', bravoRows)).toEqual({ ok: true, enteredAs: 'own' });
  });

  it('cannot replace a side its own team entered; staff can correct any side', () => {
    const { bravoRows, save } = league();
    save(BRAVO, 'b', bravoRows);
    expect(save(ALPHA, 'b', bravoRows)).toEqual({ ok: false, error: 'not_allowed' });
    expect(save(STAFF, 'b', bravoRows)).toEqual({ ok: true, enteredAs: 'staff' });
  });
});

describe('the check across sides', () => {
  it('warns when a side’s kills and the other side’s deaths differ beyond 3', () => {
    const { db, alphaRows, bravoRows, save, row } = league();
    save(ALPHA, 'a', alphaRows);
    save(BRAVO, 'b', bravoRows);
    // Alpha: 20 kills, 10 deaths; Bravo: 10 kills, 20 deaths.
    const even = statGrid(db, STAFF, 1, null, NOW);
    expect(even.ok && even.warnings).toEqual([]);
    save(BRAVO, 'b', [...bravoRows.slice(0, 4), row(13, [11, 2, 0, 1, ''])]);
    const off = statGrid(db, STAFF, 1, null, NOW);
    expect(off.ok && off.warnings).toEqual([{ side: 'a', kills: 20, deaths: 16 }]);
  });
});

describe('when the grid is closed', () => {
  it('closes for a game without a result, a forfeit, or replay stats', () => {
    const { db, alphaRows } = league();
    expect(statGrid(db, STAFF, 3, null, NOW)).toEqual({ ok: false, error: 'no_game' });
    const forfeit = statGrid(db, STAFF, 2, null, NOW);
    expect(forfeit.ok && forfeit.game.lock).toBe('forfeit');
    db.update(schema.game).set({ statsSource: 'replay' }).where(eq(schema.game.id, 1)).run();
    expect(saveSheet(db, STAFF, { matchId: 1, n: 1, side: 'a', rows: alphaRows }, NOW)).toEqual({
      ok: false,
      error: 'replay',
    });
  });

  it('closes for the teams after the league’s deadline, never for staff', () => {
    const { db, alphaRows, save } = league();
    const row = db.select().from(schema.competition).get();
    if (!row) throw new Error('LFR is seeded');
    db.update(schema.competition)
      .set({
        rulesetJson: { ...row.rulesetJson, stats: { entry_days: 7, kills_deaths_tolerance: 3 } },
      })
      .run();
    db.update(schema.match)
      .set({ validatedAt: NOW - 8 * DAY })
      .where(eq(schema.match.id, 1))
      .run();
    expect(save(ALPHA, 'a', alphaRows)).toEqual({ ok: false, error: 'deadline' });
    expect(save(STAFF, 'a', alphaRows)).toEqual({ ok: true, enteredAs: 'staff' });
    db.update(schema.match)
      .set({ validatedAt: NOW - 6 * DAY })
      .where(eq(schema.match.id, 1))
      .run();
    expect(save(ALPHA, 'a', alphaRows)).toEqual({ ok: true, enteredAs: 'own' });
  });
});
