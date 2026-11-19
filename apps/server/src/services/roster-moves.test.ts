import { mercatoSchema } from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, rosterPlayerForTests, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { openMercatoWindow } from './mercato-windows.ts';
import type { Actor } from './permissions.ts';
import { changeRole, fileMove, mercatoTeamView, withdrawMove } from './roster-moves.ts';
import { setTeamOwner } from './team-staff.ts';

// A roster's mercato moves (design doc section 7; O-35, M-22). In leagueDatabase(), team 1 is
// Alpha and team 2 Bravo, both in Ligue 1 of Season 3, under way; LFR's mercato has windows,
// 3 moves per team and 24 hours.

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const MANAGER: Actor = {
  guildId: TEST_GUILD,
  user: { id: '700000000000000002', displayName: 'Manager' },
  memberRoleIds: [],
};
const everyoneOnServer = () => Promise.resolve(true);

/**
 * Alpha's lineup: P1 to P5 start, P1 captain, P6 a substitute; P7 and P8 are on its own list.
 * P9 plays for Bravo and is on Alpha's list too, ready for a transfer.
 */
function league() {
  const db = leagueDatabase();
  setTeamOwner(
    db,
    STAFF,
    { teamId: 1, member: { id: MANAGER.user.id, displayName: 'Manager' } },
    1,
  );
  const seasonId = db.select().from(schema.season).get()?.id ?? 0;
  const ids: number[] = [];
  for (let n = 1; n <= 9; n += 1) ids.push(rosterPlayerForTests(db, n === 9 ? 2 : 1, n));
  const entry = (teamId: number, playerId: number, role: 'player' | 'sub', captain = false) =>
    db
      .insert(schema.rosterEntry)
      .values({ seasonId, teamId, playerId, role, captain, validFrom: 1 })
      .run();
  ids.slice(0, 5).forEach((id, index) => entry(1, id, 'player', index === 0));
  entry(1, ids[5] ?? 0, 'sub');
  entry(2, ids[8] ?? 0, 'player', true);
  db.insert(schema.rosterPlayer)
    .values({ teamId: 1, playerId: ids[8] ?? 0, joinedAt: 2 })
    .run();
  const window = () =>
    openMercatoWindow(
      db,
      STAFF,
      { opensAt: NOW - HOUR, closesAt: NOW + 48 * HOUR, maxMovesPerTeam: 3, lockHours: 24 },
      NOW - 2 * HOUR,
    );
  const p = (n: number) => ids[n - 1] ?? 0;
  const file = (
    move: { outId: number | null; in: { playerId: number; role: 'player' | 'sub' } | null },
    actor = MANAGER,
  ) => fileMove(db, everyoneOnServer, actor, { teamId: 1, ...move, note: null }, NOW);
  return { db, seasonId, p, window, file };
}

const moves = (db: Db) =>
  db.select().from(schema.request).where(eq(schema.request.kind, 'roster_move')).all();

describe('the roster’s mercato page', () => {
  it('shows the lineup, who may come in, the window and the moves left', () => {
    const { db, p, window } = league();
    const closed = mercatoTeamView(db, MANAGER, 1, NOW);
    expect(closed).toMatchObject({ ok: true, canFile: false, window: null, lineupLocked: true });
    window();
    const view = mercatoTeamView(db, MANAGER, 1, NOW);
    if (!view.ok) throw new Error('the manager sees the page');
    expect(view).toMatchObject({ canFile: true, movesCounted: 0, limit: 3, staff: false });
    expect(view.lineup.map((entry) => entry.playerId)).toEqual([
      p(1),
      p(2),
      p(3),
      p(4),
      p(5),
      p(6),
    ]);
    expect(view.candidates.map((entry) => entry.name)).toEqual(['P7', 'P8', 'P9']);
    expect(mercatoTeamView(db, STAFF, 1, NOW)).toMatchObject({ ok: true, staff: true });
  });

  it('is for league staff and the officials who manage the roster’s players only', () => {
    const { db } = league();
    const stranger = { ...MANAGER, user: { id: '700000000000000099', displayName: 'X' } };
    expect(mercatoTeamView(db, stranger, 1, NOW)).toEqual({ ok: false, error: 'not_allowed' });
    expect(mercatoTeamView(db, MANAGER, 2, NOW)).toEqual({ ok: false, error: 'not_allowed' });
  });
});

describe('filing a move', () => {
  it('files a swap in the open window, counted, for staff to answer', async () => {
    const { db, p, window, file } = league();
    window();
    const reply = await file({ outId: p(5), in: { playerId: p(7), role: 'player' } });
    expect(reply).toMatchObject({
      ok: true,
      move: {
        out: { name: 'P5' },
        in: { name: 'P7', role: 'player' },
        counted: true,
        status: 'pending',
      },
      team: { name: 'Alpha Esport' },
    });
    expect(moves(db)).toMatchObject([
      {
        teamId: 1,
        approval: 'staff',
        status: 'pending',
        payloadJson: { outId: p(5), in: { playerId: p(7) }, counted: true, fromTeamId: null },
      },
    ]);
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'request.file',
    });
    const view = mercatoTeamView(db, MANAGER, 1, NOW);
    expect(view.ok && view.movesCounted).toBe(1);
  });

  it('needs an open window in LFR, and stops at its limit, pending moves included', async () => {
    const { p, window, file } = league();
    expect(await file({ outId: p(6), in: null })).toEqual({ ok: false, error: 'window_closed' });
    window();
    expect(await file({ outId: p(6), in: null })).toMatchObject({ ok: true });
    expect(await file({ outId: null, in: { playerId: p(7), role: 'sub' } })).toMatchObject({
      ok: true,
    });
    expect(await file({ outId: p(2), in: { playerId: p(8), role: 'player' } })).toMatchObject({
      ok: true,
    });
    expect(await file({ outId: p(3), in: null })).toEqual({ ok: false, error: 'limit_reached' });
  });

  it('needs no window when the league’s mercato is always open', async () => {
    const { db, p, file } = league();
    const row = db.select().from(schema.competition).get();
    if (!row) throw new Error('LFR is seeded');
    db.update(schema.competition)
      .set({ rulesetJson: { ...row.rulesetJson, mercato: mercatoSchema.parse({}) } })
      .run();
    expect(await file({ outId: p(6), in: null })).toMatchObject({
      ok: true,
      move: { counted: true },
    });
  });

  it('refuses a second move about the same player while one waits', async () => {
    const { p, window, file } = league();
    window();
    await file({ outId: p(5), in: { playerId: p(7), role: 'player' } });
    expect(await file({ outId: p(4), in: { playerId: p(7), role: 'player' } })).toEqual({
      ok: false,
      error: 'already_pending',
    });
  });

  it('marks a player of another roster of the competition as a transfer', async () => {
    const { db, p, window, file } = league();
    window();
    expect(await file({ outId: p(5), in: { playerId: p(9), role: 'player' } })).toMatchObject({
      ok: true,
      move: { from: 'Bravo', counted: true },
    });
    expect(moves(db)[0]?.payloadJson).toMatchObject({ fromTeamId: 2 });
  });

  it('checks the incoming player as at registration: profile, and the league’s server', async () => {
    const { db, p, window } = league();
    window();
    db.update(schema.player)
      .set({ birthDate: null })
      .where(eq(schema.player.id, p(7)))
      .run();
    const move = {
      teamId: 1,
      outId: p(5),
      in: { playerId: p(7), role: 'player' as const },
      note: null,
    };
    expect(await fileMove(db, everyoneOnServer, MANAGER, move, NOW)).toEqual({
      ok: false,
      error: 'player_incomplete',
    });
    const other = { ...move, in: { playerId: p(8), role: 'player' as const } };
    expect(await fileMove(db, () => Promise.resolve(false), MANAGER, other, NOW)).toEqual({
      ok: false,
      error: 'not_on_server',
    });
    expect(await fileMove(db, () => Promise.resolve(null), MANAGER, other, NOW)).toEqual({
      ok: false,
      error: 'discord_unavailable',
    });
    expect(moves(db)).toEqual([]);
  });

  it('keeps the lineup’s rules: the captain stays, the numbers hold', async () => {
    const { p, window, file } = league();
    window();
    expect(await file({ outId: p(1), in: null })).toEqual({ ok: false, error: 'captain_leaving' });
    expect(await file({ outId: null, in: { playerId: p(7), role: 'player' } })).toEqual({
      ok: false,
      error: 'too_many_starters',
    });
  });
});

describe('withdrawing a move', () => {
  it('takes back a move still waiting, which no longer counts', async () => {
    const { db, p, window, file } = league();
    window();
    const filed = await file({ outId: p(6), in: null });
    if (!filed.ok) throw new Error('the move is filed');
    expect(withdrawMove(db, MANAGER, 1, filed.move.id, NOW)).toMatchObject({
      ok: true,
      move: { status: 'withdrawn' },
    });
    expect(withdrawMove(db, MANAGER, 1, filed.move.id, NOW)).toEqual({
      ok: false,
      error: 'not_pending',
    });
    const view = mercatoTeamView(db, MANAGER, 1, NOW);
    expect(view.ok && view.movesCounted).toBe(0);
  });
});

describe('role and captain changes', () => {
  it('apply at once, audited, at any time', () => {
    const { db, seasonId, p } = league();
    expect(changeRole(db, MANAGER, 1, { playerId: p(5), role: 'sub' }, NOW)).toEqual({ ok: true });
    expect(changeRole(db, MANAGER, 1, { captainId: p(2) }, NOW)).toEqual({ ok: true });
    const lineup = db
      .select()
      .from(schema.rosterEntry)
      .where(eq(schema.rosterEntry.seasonId, seasonId))
      .all()
      .filter((row) => row.teamId === 1);
    expect(lineup.find((row) => row.playerId === p(5))?.role).toBe('sub');
    expect(lineup.filter((row) => row.captain).map((row) => row.playerId)).toEqual([p(2)]);
    expect(
      db
        .select()
        .from(schema.auditLog)
        .all()
        .filter((row) => row.action === 'lineup.role'),
    ).toHaveLength(3);
  });

  it('keeps the captain a starter, and refuses strangers', () => {
    const { db, p } = league();
    expect(changeRole(db, MANAGER, 1, { captainId: p(6) }, NOW)).toEqual({
      ok: false,
      error: 'captain_not_starter',
    });
    expect(changeRole(db, MANAGER, 2, { captainId: p(9) }, NOW)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
  });

  it('names no captain who is still blocked after their move', () => {
    const { db, seasonId, p } = league();
    db.update(schema.rosterEntry)
      .set({ validFrom: NOW + HOUR })
      .where(eq(schema.rosterEntry.playerId, p(3)))
      .run();
    expect(seasonId).toBeGreaterThan(0);
    expect(changeRole(db, MANAGER, 1, { captainId: p(3) }, NOW)).toEqual({
      ok: false,
      error: 'not_started',
    });
  });
});
