import { schema } from '@ligo/db';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, mercatoLineups, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { openMercatoWindow } from './mercato-windows.ts';
import type { Actor } from './permissions.ts';
import { checkMoveAnswer, decideMove } from './roster-move-apply.ts';
import { changeRole, fileMove, mercatoTeamView } from './roster-moves.ts';
import { setTeamOwner } from './team-staff.ts';

// Deciding a mercato move (design doc section 7; O-35): staff approve or refuse; an exception or
// an automatic approval applies as it is filed. Alpha (team 1) and Bravo (team 2) as
// `mercatoLineups` sets them; LFR's window allows 3 moves and blocks for 24 hours.

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
const BRAVO_OWNER = { id: '700000000000000003', displayName: 'Bravo Owner' };
const onServer = () => Promise.resolve(true);

function league() {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 1, member: MANAGER.user }, 1);
  setTeamOwner(db, STAFF, { teamId: 2, member: BRAVO_OWNER }, 1);
  const ids = mercatoLineups(db);
  const p = (n: number) => ids[n - 1] ?? 0;
  const openWindow = () =>
    openMercatoWindow(
      db,
      STAFF,
      { opensAt: NOW - HOUR, closesAt: NOW + 48 * HOUR, maxMovesPerTeam: 3, lockHours: 24 },
      NOW - 2 * HOUR,
    );
  const file = async (
    move: { outId: number | null; in: { playerId: number; role: 'player' | 'sub' } | null },
    actor = MANAGER,
    exceptionReason: string | null = null,
  ) => {
    const reply = await fileMove(
      db,
      onServer,
      actor,
      { teamId: 1, ...move, note: null, exceptionReason },
      NOW,
    );
    return reply;
  };
  const entry = (teamId: number, playerId: number) =>
    db
      .select()
      .from(schema.rosterEntry)
      .where(and(eq(schema.rosterEntry.teamId, teamId), eq(schema.rosterEntry.playerId, playerId)))
      .all();
  return { db, p, openWindow, file, entry };
}

describe('staff approving a move', () => {
  it('ends the outgoing place and starts the incoming one after the block', async () => {
    const { db, p, openWindow, file, entry } = league();
    openWindow();
    const filed = await file({ outId: p(5), in: { playerId: p(7), role: 'player' } });
    if (!filed.ok) throw new Error('the move is filed');
    const at = NOW + HOUR;
    const reply = decideMove(
      db,
      STAFF,
      { requestId: filed.move.id, decision: 'approve', reason: null },
      at,
    );
    expect(reply).toMatchObject({
      ok: true,
      decision: 'approve',
      move: { status: 'approved' },
      team: { name: 'Alpha Esport' },
      applied: { startsAt: at + 24 * HOUR, fromTeam: null },
      requesterDiscordId: MANAGER.user.id,
    });
    expect(entry(1, p(5))).toMatchObject([{ validTo: at }]);
    expect(entry(1, p(7))).toMatchObject([
      { role: 'player', captain: false, validFrom: at + 24 * HOUR, validTo: null },
    ]);
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'request.approve',
    });
    const view = mercatoTeamView(db, MANAGER, 1, at);
    expect(view.ok && view.lineup.find((place) => place.playerId === p(7))?.startsAt).toBe(
      at + 24 * HOUR,
    );
    expect(view.ok && view.movesCounted).toBe(1);
  });

  it('takes a transferred player from their old roster, which is told and may lose its captain', async () => {
    const { db, p, openWindow, file, entry } = league();
    openWindow();
    const filed = await file({ outId: p(5), in: { playerId: p(9), role: 'player' } });
    if (!filed.ok) throw new Error('the move is filed');
    const reply = decideMove(
      db,
      STAFF,
      { requestId: filed.move.id, decision: 'approve', reason: null },
      NOW,
    );
    expect(reply).toMatchObject({
      ok: true,
      applied: {
        fromTeam: { teamId: 2, name: 'Bravo', officials: [BRAVO_OWNER.id], lostCaptain: true },
      },
    });
    expect(entry(2, p(9))).toMatchObject([{ validTo: NOW }]);
    expect(entry(1, p(9))).toMatchObject([{ validTo: null }]);
  });

  it('checks the move again: a captain named since cannot leave', async () => {
    const { db, p, openWindow, file } = league();
    openWindow();
    const filed = await file({ outId: p(5), in: null });
    if (!filed.ok) throw new Error('the move is filed');
    changeRole(db, MANAGER, 1, { captainId: p(5) }, NOW);
    expect(
      decideMove(db, STAFF, { requestId: filed.move.id, decision: 'approve', reason: null }, NOW),
    ).toEqual({ ok: false, error: 'captain_leaving' });
    expect(
      db.select().from(schema.request).where(eq(schema.request.id, filed.move.id)).get()?.status,
    ).toBe('pending');
  });

  it('is for league staff, once', async () => {
    const { db, p, openWindow, file } = league();
    openWindow();
    const filed = await file({ outId: p(6), in: null });
    if (!filed.ok) throw new Error('the move is filed');
    const approve = { requestId: filed.move.id, decision: 'approve' as const, reason: null };
    expect(decideMove(db, MANAGER, approve, NOW)).toEqual({ ok: false, error: 'not_staff' });
    expect(checkMoveAnswer(db, MANAGER, filed.move.id)).toEqual({
      ok: false,
      error: 'not_staff',
    });
    expect(checkMoveAnswer(db, STAFF, filed.move.id)).toEqual({ ok: true });
    expect(decideMove(db, STAFF, approve, NOW)).toMatchObject({ ok: true });
    expect(decideMove(db, STAFF, approve, NOW)).toEqual({ ok: false, error: 'not_pending' });
    expect(decideMove(db, STAFF, { ...approve, requestId: 999 }, NOW)).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

describe('staff refusing a move', () => {
  it('needs a reason the team reads, and frees its place in the count', async () => {
    const { db, p, openWindow, file, entry } = league();
    openWindow();
    const filed = await file({ outId: p(6), in: null });
    if (!filed.ok) throw new Error('the move is filed');
    const reject = { requestId: filed.move.id, decision: 'reject' as const, reason: ' ' };
    expect(decideMove(db, STAFF, reject, NOW)).toEqual({ ok: false, error: 'reason_required' });
    expect(decideMove(db, STAFF, { ...reject, reason: 'Hors délai' }, NOW)).toMatchObject({
      ok: true,
      decision: 'reject',
      move: { status: 'rejected', reason: 'Hors délai' },
      applied: null,
    });
    expect(entry(1, p(6))).toMatchObject([{ validTo: null }]);
    const view = mercatoTeamView(db, MANAGER, 1, NOW);
    expect(view.ok && view.movesCounted).toBe(0);
  });
});

describe('a staff exception (O-35)', () => {
  it('applies at once without a window, not counted, still blocked', async () => {
    const { db, p, file, entry } = league();
    const reply = await file(
      { outId: p(5), in: { playerId: p(7), role: 'player' } },
      STAFF,
      'Blessure longue durée',
    );
    expect(reply).toMatchObject({
      ok: true,
      move: { status: 'approved', counted: false },
      applied: { startsAt: NOW + 24 * HOUR },
    });
    expect(entry(1, p(7))).toMatchObject([{ validFrom: NOW + 24 * HOUR }]);
    expect(
      db.select().from(schema.request).where(eq(schema.request.kind, 'roster_move')).get()
        ?.payloadJson,
    ).toMatchObject({ exceptionReason: 'Blessure longue durée', counted: false });
  });

  it('is for league staff, with a reason', async () => {
    const { p, file } = league();
    expect(await file({ outId: p(6), in: null }, MANAGER, 'Exception')).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    expect(await file({ outId: p(6), in: null }, STAFF, '  ')).toEqual({
      ok: false,
      error: 'reason_required',
    });
  });
});

describe('a league approving moves automatically', () => {
  it('applies a move as it is filed', async () => {
    const { db, p, openWindow, file, entry } = league();
    const row = db.select().from(schema.competition).get();
    if (!row) throw new Error('LFR is seeded');
    const { rulesetJson } = row;
    db.update(schema.competition)
      .set({
        rulesetJson: {
          ...rulesetJson,
          requests: {
            ...rulesetJson.requests,
            approval: { ...rulesetJson.requests.approval, roster_move: 'auto' },
          },
        },
      })
      .run();
    openWindow();
    expect(await file({ outId: p(6), in: null })).toMatchObject({
      ok: true,
      move: { status: 'approved', counted: true },
      applied: { startsAt: null },
    });
    expect(entry(1, p(6))).toMatchObject([{ validTo: NOW }]);
  });
});
