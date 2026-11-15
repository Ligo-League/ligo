import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeEvidenceStore } from '../assets/evidence-store.ts';
import { registrationDatabase } from '../testing.ts';
import { saveGameProfile } from './game-profile.ts';
import { inviteToken } from './invites.ts';
import { joinRegistration, joinView } from './joining.ts';
import { setNationality, setStatsConsent } from './me.ts';
import { ensurePlayer } from './players.ts';
import {
  removeFromRegistration,
  renewInvite,
  setLineup,
  withdrawRegistration,
} from './registration-lineup.ts';
import { fileRegistration, registrationStatus } from './registrations.ts';

// The filer builds the lineup (maintainer, 14 and 15 November 2026): starters, substitutes and
// the captain, a starter (O-30); a player removed; a new invitation link; the registration
// withdrawn. Lineup changes stop once the lineup locks (M-29).

const NOW = 10_000;
const SECRET = 's'.repeat(40);
const SEASON_START = Date.UTC(2027, 0, 4, 12);
const always = () => Promise.resolve(true);

async function setup(players = 6) {
  const db = registrationDatabase();
  const filer = ensurePlayer(
    db,
    { orgId: 1, discordUserId: '700000000000000001', displayName: 'Ana' },
    1,
  ).id;
  await fileRegistration(
    db,
    fakeEvidenceStore(),
    filer,
    'lfr',
    {
      club: {
        kind: 'new',
        name: 'Kairos Esport',
        city: '',
        legalStatus: '',
        socials: '',
        discordUrl: '',
      },
      roster: { name: 'Kairos', tag: 'KRS', colors: ['#112233', '#FFFFFF'], canStream: false },
      logo: null,
      rulesVersionId: 1,
      rulesAccepted: true,
    },
    NOW,
  );
  const invite = db.select().from(schema.registrationInvite).get();
  if (!invite) throw new Error('no invitation');
  const link = { inviteId: invite.id, token: inviteToken(SECRET, invite), secret: SECRET };
  const ids: number[] = [];
  for (let n = 1; n <= players; n += 1) {
    const discordUserId = `71000000000000000${String(n)}`;
    const id = ensurePlayer(db, { orgId: 1, discordUserId, displayName: `P${String(n)}` }, 1).id;
    saveGameProfile(
      db,
      id,
      { ubisoftName: `Player${String(n)}`, profileId: null, rank: 'gold' },
      1,
    );
    setNationality(db, id, 'FR', 1);
    setStatsConsent(db, id, true, 1);
    db.update(schema.player).set({ birthDate: '2000-01-01' }).where(eq(schema.player.id, id)).run();
    await joinRegistration(db, always, { id, discordUserId }, link, NOW);
    ids.push(id);
  }
  const lastAudit = () => db.select().from(schema.auditLog).all().at(-1);
  return { db, filer, ids, link, lastAudit };
}

describe('setLineup', () => {
  it('sets roles and the captain, audited, and the lineup becomes complete', async () => {
    const { db, filer, ids, lastAudit } = await setup();
    const [first = 0, , , , fifth = 0, sixth = 0] = ids;
    expect(registrationStatus(db, filer, 1, NOW)).toMatchObject({
      lineup: { complete: false, gaps: [{ gap: 'captain', have: 0 }] },
    });
    const roles = new Map([
      [fifth, 'sub' as const],
      [sixth, 'player' as const],
    ]);
    expect(setLineup(db, filer, 1, { roles, captainId: first }, NOW)).toEqual({ ok: true });
    expect(registrationStatus(db, filer, 1, NOW)).toMatchObject({
      lineup: { complete: true, gaps: [] },
    });
    expect(
      db
        .select()
        .from(schema.registrationPlayer)
        .all()
        .map((row) => [row.playerId, row.role, row.captain]),
    ).toEqual([
      [ids[0], 'player', true],
      [ids[1], 'player', false],
      [ids[2], 'player', false],
      [ids[3], 'player', false],
      [fifth, 'sub', false],
      [sixth, 'player', false],
    ]);
    expect(lastAudit()).toMatchObject({
      actorPlayerId: filer,
      action: 'registration.lineup',
      entityId: '1',
      afterJson: { captainId: first, subs: [fifth] },
    });
  });

  it('refuses a substitute as captain, or too many starters', async () => {
    const { db, filer, ids } = await setup();
    const sixth = ids[5] ?? 0;
    expect(setLineup(db, filer, 1, { roles: new Map(), captainId: sixth }, NOW)).toEqual({
      ok: false,
      error: 'captain_not_starter',
    });
    expect(
      setLineup(db, filer, 1, { roles: new Map([[sixth, 'player']]), captainId: null }, NOW),
    ).toEqual({ ok: false, error: 'too_many_starters' });
  });

  it('is the filer’s only, while the registration waits and the lineup is open', async () => {
    const { db, filer, ids } = await setup();
    const change = { roles: new Map(), captainId: ids[0] ?? 0 };
    expect(setLineup(db, ids[1] ?? 0, 1, change, NOW)).toEqual({ ok: false, error: 'not_found' });
    expect(setLineup(db, filer, 1, change, SEASON_START)).toEqual({
      ok: false,
      error: 'lineup_locked',
    });
    expect(withdrawRegistration(db, filer, 1, NOW)).toEqual({ ok: true });
    expect(setLineup(db, filer, 1, change, NOW)).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('removeFromRegistration', () => {
  it('takes a player out, audited, until the lineup locks', async () => {
    const { db, filer, ids, lastAudit } = await setup(2);
    const [first = 0, second = 0] = ids;
    setLineup(db, filer, 1, { roles: new Map(), captainId: first }, NOW);
    expect(removeFromRegistration(db, filer, 1, first, SEASON_START)).toEqual({
      ok: false,
      error: 'lineup_locked',
    });
    expect(removeFromRegistration(db, filer, 1, first, NOW)).toEqual({ ok: true });
    expect(
      db
        .select()
        .from(schema.registrationPlayer)
        .all()
        .map((row) => row.playerId),
    ).toEqual([second]);
    expect(lastAudit()).toMatchObject({
      actorPlayerId: filer,
      action: 'registration.remove_player',
      beforeJson: { playerId: first, role: 'player', captain: true },
    });
    expect(removeFromRegistration(db, filer, 1, first, NOW)).toEqual({
      ok: false,
      error: 'not_joined',
    });
    expect(removeFromRegistration(db, second, 1, second, NOW)).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

describe('renewInvite', () => {
  it('replaces the link: the old one stops working, the new one lasts the full time', async () => {
    const { db, filer, link, lastAudit } = await setup(0);
    const later = NOW + 3 * 86_400_000;
    expect(renewInvite(db, filer, 1, later)).toEqual({ ok: true });
    const invites = db.select().from(schema.registrationInvite).all();
    expect(invites).toMatchObject([
      { id: 1, revokedAt: later },
      { id: 2, requestId: 1, createdAt: later, expiresAt: later + 7 * 86_400_000, revokedAt: null },
    ]);
    expect(invites[1]?.nonce).not.toBe(invites[0]?.nonce);
    const player = { id: filer, discordUserId: '700000000000000001' };
    expect(await joinView(db, always, player, link, later)).toEqual({
      ok: false,
      error: 'invalid_link',
    });
    expect(lastAudit()).toMatchObject({ action: 'registration.renew_invite', entityId: '1' });
    expect(registrationStatus(db, filer, 1, later)).toMatchObject({ invite: { id: 2 } });
  });

  it('is the filer’s only, and stops once the lineup locks', async () => {
    const { db, filer, ids } = await setup(1);
    expect(renewInvite(db, ids[0] ?? 0, 1, NOW)).toEqual({ ok: false, error: 'not_found' });
    expect(renewInvite(db, filer, 1, SEASON_START)).toEqual({ ok: false, error: 'lineup_locked' });
  });
});

describe('withdrawRegistration', () => {
  it('withdraws the registration, audited: its link dies and its players are free', async () => {
    const { db, filer, link, lastAudit } = await setup(1);
    expect(withdrawRegistration(db, filer, 1, SEASON_START)).toEqual({ ok: true });
    expect(db.select().from(schema.request).get()).toMatchObject({
      status: 'withdrawn',
      decidedAt: SEASON_START,
      decidedBy: filer,
    });
    expect(lastAudit()).toMatchObject({
      actorPlayerId: filer,
      action: 'registration.withdraw',
      beforeJson: { status: 'pending' },
      afterJson: { status: 'withdrawn' },
    });
    const player = { id: filer, discordUserId: '700000000000000001' };
    expect(await joinView(db, always, player, link, NOW)).toEqual({
      ok: false,
      error: 'invalid_link',
    });
    expect(registrationStatus(db, filer, 1, NOW)).toMatchObject({
      status: 'withdrawn',
      locked: false,
    });
    expect(withdrawRegistration(db, filer, 1, NOW)).toEqual({ ok: false, error: 'not_found' });
  });
});
