import type { RegistrationRole } from '@ligo/core';
import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { kairosRoster, registrationDatabase, rosterPlayerForTests } from '../testing.ts';
import { setLineup, withdrawRegistration } from './registration-lineup.ts';
import { fileRegistration, registrationStatus } from './registrations.ts';
import { removeFromRoster } from './rosters.ts';

// The filer picks the registration's lineup among the roster's players (M-33): starters,
// substitutes and the captain, a starter (O-30); not a player of another roster of the league
// (O-29); until the lineup locks (M-29). Season 4 starts on 4 January 2027.

const NOW = 10_000;
const SEASON_START = Date.parse('2027-01-04T12:00:00Z');

async function setup(players = 7) {
  const db = registrationDatabase();
  const kairos = await kairosRoster(db, players);
  const filed = fileRegistration(
    db,
    kairos.owner,
    'lfr',
    { teamId: kairos.teamId, rulesVersionId: 1, rulesAccepted: true },
    NOW,
  );
  if (!filed.ok) throw new Error('not filed');
  const pick = (
    starters: number[],
    subs: number[] = [],
    captainId: number | null = null,
    now = NOW,
  ) =>
    setLineup(
      db,
      kairos.owner,
      filed.id,
      {
        roles: new Map<number, RegistrationRole>([
          ...starters.map((id) => [id, 'player'] as const),
          ...subs.map((id) => [id, 'sub'] as const),
        ]),
        captainId,
      },
      now,
    );
  const lineup = () =>
    db
      .select()
      .from(schema.registrationPlayer)
      .all()
      .map((row) => [row.playerId, row.role, row.captain]);
  return { db, ...kairos, requestId: filed.id, pick, lineup };
}

describe('setLineup', () => {
  it('picks starters, substitutes and the captain among the roster’s players, audited', async () => {
    const { db, owner, playerIds, requestId, pick, lineup } = await setup();
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = playerIds;
    expect(pick([a, b, c, d, e], [f], b)).toEqual({ ok: true });
    expect(lineup()).toEqual([
      [a, 'player', false],
      [b, 'player', true],
      [c, 'player', false],
      [d, 'player', false],
      [e, 'player', false],
      [f, 'sub', false],
    ]);
    const status = registrationStatus(db, owner, requestId, NOW);
    expect(status.ok && status.lineup).toEqual({ complete: true, gaps: [] });
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      actorPlayerId: owner,
      action: 'registration.lineup',
      beforeJson: { starters: [], subs: [], captainId: null },
      afterJson: { starters: [a, b, c, d, e], subs: [f], captainId: b },
    });
    // A new pick replaces the lineup: a player left out stays on the roster.
    expect(pick([a, b], [], a)).toEqual({ ok: true });
    expect(lineup()).toEqual([
      [a, 'player', true],
      [b, 'player', false],
    ]);
  });

  it('refuses a player not on the roster, or one in another registration of the league', async () => {
    const { db, owner, playerIds, pick } = await setup();
    const [a = 0] = playerIds;
    expect(pick([a, 9999])).toEqual({ ok: false, error: 'not_on_roster' });
    db.insert(schema.request)
      .values({
        competitionId: 1,
        seasonId: db.select().from(schema.request).get()?.seasonId ?? 0,
        kind: 'registration',
        payloadJson: { rules: { versionId: 1, acceptedAt: 1 } },
        approval: 'staff',
        requestedBy: owner,
        requestedAt: 1,
      })
      .run();
    db.insert(schema.registrationPlayer)
      .values({ requestId: 2, playerId: a, role: 'player', joinedAt: 1 })
      .run();
    expect(pick([a])).toEqual({ ok: false, error: 'unavailable', playerIds: [a] });
  });

  it('keeps the captain a starter, and the numbers within the league’s', async () => {
    const { playerIds, pick, lineup } = await setup();
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0] = playerIds;
    expect(pick([a], [b], b)).toEqual({ ok: false, error: 'captain_not_starter' });
    expect(pick([a, b, c, d, e, f])).toEqual({ ok: false, error: 'too_many_starters' });
    expect(pick([a], [b, c, d])).toEqual({ ok: false, error: 'too_many_subs' });
    expect(pick([a, b, c, d, e], [f, g], a)).toEqual({ ok: true });
    expect(lineup()).toHaveLength(7);
  });

  it('is the filer’s only, and stops once the lineup locks', async () => {
    const { db, playerIds, requestId, pick } = await setup();
    const [a = 0] = playerIds;
    expect(setLineup(db, a, requestId, { roles: new Map(), captainId: null }, NOW)).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(pick([a], [], null, SEASON_START)).toEqual({ ok: false, error: 'lineup_locked' });
  });

  it('drops a player who leaves the roster from the lineup', async () => {
    const { db, teamId, playerIds, pick, lineup } = await setup();
    const [a = 0, b = 0] = playerIds;
    pick([a, b], [], a);
    expect(removeFromRoster(db, { playerId: b }, teamId, b, NOW)).toEqual({ ok: true });
    expect(lineup()).toEqual([[a, 'player', true]]);
    // A player joining the roster later is there to pick.
    const late = rosterPlayerForTests(db, teamId, 9);
    expect(pick([a, late], [], a)).toEqual({ ok: true });
  });
});

describe('withdrawRegistration', () => {
  it('lets the filer withdraw, audited; the registration then waits no more', async () => {
    const { db, owner, requestId, pick, playerIds } = await setup();
    expect(withdrawRegistration(db, owner, requestId, NOW)).toEqual({ ok: true });
    expect(
      db.select().from(schema.request).where(eq(schema.request.id, requestId)).get(),
    ).toMatchObject({
      status: 'withdrawn',
      decidedBy: owner,
    });
    expect(pick([playerIds[0] ?? 0])).toEqual({ ok: false, error: 'not_found' });
    expect(withdrawRegistration(db, owner, requestId, NOW)).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
