import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeAssetStore } from '../assets/store.ts';
import { leagueDatabase } from '../testing.ts';
import { createClub } from './clubs.ts';
import { saveGameProfile } from './game-profile.ts';
import { inviteToken } from './invites.ts';
import { setNationality } from './me.ts';
import { ensurePlayer } from './players.ts';
import {
  joinRoster,
  removeFromRoster,
  rosterInviteFor,
  rosterJoinView,
  rosterMembers,
  rostersOf,
} from './rosters.ts';

// A roster's own players, before any competition (M-33, M-34): they join from its invitation
// link with their own account, up to the group's maximum, and leave or are removed while the
// roster plays in no season under way.

const SECRET = 'x'.repeat(40);
const NOW = 10_000;

async function setup() {
  const db = leagueDatabase();
  const person = (n: number, complete = true) => {
    const id = ensurePlayer(
      db,
      { orgId: 1, discordUserId: `71000000000000000${String(n)}`, displayName: `P${String(n)}` },
      1,
    ).id;
    if (complete) {
      saveGameProfile(
        db,
        id,
        { ubisoftName: `Player${String(n)}`, profileId: null, rank: 'gold' },
        1,
      );
      setNationality(db, id, 'FR', 1);
    }
    return id;
  };
  const owner = person(0);
  await createClub(
    db,
    fakeAssetStore(),
    owner,
    {
      orgId: 1,
      title: 'r6',
      club: { name: 'Kairos Esport', city: '', legalStatus: '', socials: '', discordUrl: '' },
      roster: { name: 'Kairos', tag: 'KRS', colors: ['#112233', '#FFFFFF'], canStream: false },
      logo: null,
    },
    1,
  );
  const teamId = db.select().from(schema.team).where(eq(schema.team.slug, 'kairos')).get()?.id ?? 0;
  const invite = rosterInviteFor(db, { playerId: owner }, teamId, { renew: false }, NOW);
  if (!invite.ok) throw new Error(invite.error);
  const link = {
    inviteId: invite.invite.id,
    token: inviteToken(SECRET, invite.invite, 'roster'),
    secret: SECRET,
  };
  return { db, owner, teamId, person, link };
}

describe('rosterInviteFor', () => {
  it('gives the officials the same link until they renew it, which voids the old one', async () => {
    const { db, owner, teamId, person, link } = await setup();
    const again = rosterInviteFor(db, { playerId: owner }, teamId, { renew: false }, NOW);
    expect(again.ok && again.invite.id).toBe(link.inviteId);
    const renewed = rosterInviteFor(db, { playerId: owner }, teamId, { renew: true }, NOW);
    expect(renewed.ok && renewed.invite.id).not.toBe(link.inviteId);
    expect(rosterJoinView(db, person(1), link, NOW)).toEqual({ ok: false, error: 'invalid_link' });
    const audited = db.select().from(schema.auditLog).all();
    expect(audited.filter((row) => row.action.startsWith('roster.invite'))).toMatchObject([
      { action: 'roster.invite.create', entity: 'team', entityId: String(teamId) },
      { action: 'roster.invite.renew', entity: 'team', entityId: String(teamId) },
    ]);
  });

  it('is not for the coach, nor anyone outside the roster', async () => {
    const { db, teamId, person } = await setup();
    const coach = person(5);
    db.insert(schema.teamStaff).values({ teamId, playerId: coach, role: 'coach', since: 1 }).run();
    expect(rosterInviteFor(db, { playerId: coach }, teamId, { renew: false }, NOW)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    expect(rosterInviteFor(db, { playerId: person(6) }, teamId, { renew: false }, NOW)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
  });

  it('expires after the group’s number of days (7 by default)', async () => {
    const { db, person, link } = await setup();
    expect(rosterJoinView(db, person(1), link, NOW + 7 * 86_400_000).ok).toBe(false);
  });
});

describe('joinRoster', () => {
  it('lets a player with a complete profile join once, audited', async () => {
    const { db, teamId, person, link } = await setup();
    const ana = person(1);
    expect(rosterJoinView(db, ana, link, NOW)).toMatchObject({
      ok: true,
      team: { slug: 'kairos' },
      verdict: { ok: true },
    });
    expect(joinRoster(db, ana, link, NOW)).toMatchObject({ ok: true, team: { slug: 'kairos' } });
    expect(joinRoster(db, ana, link, NOW)).toEqual({ ok: false, error: 'already_on_roster' });
    expect(rosterMembers(db, teamId, 'r6')).toEqual([
      { playerId: ana, name: 'P1', joinedAt: NOW, gaps: [] },
    ]);
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      actorPlayerId: ana,
      action: 'roster.join',
    });
  });

  it('asks for the player’s own account and nationality first', async () => {
    const { db, person, link } = await setup();
    const ben = person(2, false);
    expect(rosterJoinView(db, ben, link, NOW)).toMatchObject({
      verdict: { ok: false, error: 'incomplete_profile' },
      gaps: ['game_account', 'nationality'],
    });
    expect(joinRoster(db, ben, link, NOW)).toEqual({ ok: false, error: 'incomplete_profile' });
  });

  it('stops at the group’s maximum', async () => {
    const { db, person, link } = await setup();
    db.update(schema.org)
      .set({
        settingsJson: {
          club_roles: { managers_max: 3 },
          rosters: { players_max: 1, invite_days: 7 },
        },
      })
      .run();
    expect(joinRoster(db, person(1), link, NOW).ok).toBe(true);
    expect(joinRoster(db, person(2), link, NOW)).toEqual({ ok: false, error: 'roster_full' });
  });

  it('stays open while the roster plays a season under way: it prepares the next one (M-35)', async () => {
    const { db, owner, teamId, person, link } = await setup();
    const divisionId = db.select().from(schema.division).get()?.id ?? 0;
    // Season 3 of the league database is under way.
    db.insert(schema.slot).values({ divisionId, teamId }).run();
    expect(joinRoster(db, person(1), link, NOW).ok).toBe(true);
    expect(rosterInviteFor(db, { playerId: owner }, teamId, { renew: true }, NOW).ok).toBe(true);
  });
});

describe('removeFromRoster', () => {
  it('lets a player leave, and the officials remove one, but nobody else', async () => {
    const { db, owner, teamId, person, link } = await setup();
    const ana = person(1);
    const ben = person(2);
    joinRoster(db, ana, link, NOW);
    joinRoster(db, ben, link, NOW);
    expect(removeFromRoster(db, { playerId: ana }, teamId, ben, NOW)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    expect(rostersOf(db, ana)).toMatchObject([{ slug: 'kairos' }]);
    expect(removeFromRoster(db, { playerId: ana }, teamId, ana, NOW)).toEqual({ ok: true });
    expect(removeFromRoster(db, { playerId: owner }, teamId, ben, NOW)).toEqual({ ok: true });
    expect(rosterMembers(db, teamId, 'r6')).toEqual([]);
    expect(rostersOf(db, ana)).toEqual([]);
    expect(db.select().from(schema.auditLog).all().slice(-2)).toMatchObject([
      { action: 'roster.leave' },
      { action: 'roster.remove' },
    ]);
    // Leaving keeps the history: the player may join again.
    expect(joinRoster(db, ana, link, NOW + 1).ok).toBe(true);
  });

  it('lets a roster manager remove players, as an official who may add officials', async () => {
    const { db, teamId, person, link } = await setup();
    const ana = person(1);
    joinRoster(db, ana, link, NOW);
    const manager = person(7);
    db.insert(schema.teamStaff)
      .values({ teamId, playerId: manager, role: 'manager', since: 1 })
      .run();
    expect(removeFromRoster(db, { playerId: manager }, teamId, ana, NOW)).toEqual({ ok: true });
  });
});
