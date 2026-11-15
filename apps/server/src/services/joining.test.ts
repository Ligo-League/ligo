import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeEvidenceStore } from '../assets/evidence-store.ts';
import { registrationDatabase, TEST_GUILD } from '../testing.ts';
import { saveGameProfile } from './game-profile.ts';
import { inviteToken } from './invites.ts';
import {
  joinRegistration,
  joinView,
  leaveRegistration,
  registrationsOf,
  type MemberCheck,
} from './joining.ts';
import { setNationality, setStatsConsent } from './me.ts';
import { ensurePlayer } from './players.ts';
import { fileRegistration, registrationStatus, type RegistrationRequest } from './registrations.ts';

// Joining a registration from its invitation (design doc section 7; maintainer, 14 and 15 November
// 2026): with a complete profile, old enough on the season's first day, a member of the league's
// Discord server, in no other roster of the competition, while the lineup is not locked.

const NOW = 10_000;
const DAY = 86_400_000;
const SECRET = 's'.repeat(40);
// Season 4 starts on 4 January 2027: 16 on that day means born on 4 January 2011 at the latest.
const SEASON_START = Date.UTC(2027, 0, 4, 12);

const REQUEST: RegistrationRequest = {
  club: {
    kind: 'new',
    name: 'Kairos Esport',
    city: 'Lyon',
    legalStatus: 'association_1901',
    socials: '',
    discordUrl: '',
  },
  roster: { name: 'Kairos', tag: 'KRS', colors: ['#112233', '#FFFFFF'], canStream: false },
  logo: null,
  rulesVersionId: 1,
  rulesAccepted: true,
};

async function setup() {
  const db = registrationDatabase();
  const store = fakeEvidenceStore();
  const filer = ensurePlayer(
    db,
    { orgId: 1, discordUserId: '700000000000000001', displayName: 'Ana' },
    1,
  ).id;
  await fileRegistration(db, store, filer, 'lfr', REQUEST, NOW);
  const invite = db.select().from(schema.registrationInvite).get();
  if (!invite) throw new Error('no invitation');
  const link = { inviteId: invite.id, token: inviteToken(SECRET, invite), secret: SECRET };

  const members = new Set<string>();
  const discord = { down: false };
  const memberOf: MemberCheck = (_guildId, userId) =>
    Promise.resolve(discord.down ? null : members.has(userId));

  /** A player with a complete profile, born on `birthDate`, and a member of the server. */
  const player = (n: number, birthDate: string | null = '2000-05-17') => {
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
    db.update(schema.player).set({ birthDate }).where(eq(schema.player.id, id)).run();
    members.add(discordUserId);
    return { id, discordUserId };
  };
  return { db, store, filer, invite, link, members, discord, memberOf, player };
}

describe('joinView', () => {
  it('shows the registration and offers to join to a player who may', async () => {
    const { db, memberOf, link, player } = await setup();
    expect(await joinView(db, memberOf, player(1), link, NOW + DAY)).toEqual({
      ok: true,
      registration: {
        id: 1,
        competition: 'LFR',
        season: 'Saison 4',
        club: 'Kairos Esport',
        roster: { name: 'Kairos', tag: 'KRS' },
        filer: 'Ana',
      },
      state: { kind: 'can_join' },
    });
  });

  it('finds nothing behind a wrong, expired, replaced or finished link', async () => {
    const { db, memberOf, link, invite, player } = await setup();
    const ana = player(1);
    const invalid = { ok: false, error: 'invalid_link' };
    expect(await joinView(db, memberOf, ana, { ...link, token: 'x'.repeat(43) }, NOW)).toEqual(
      invalid,
    );
    expect(await joinView(db, memberOf, ana, { ...link, inviteId: 99 }, NOW)).toEqual(invalid);
    expect(await joinView(db, memberOf, ana, link, invite.expiresAt)).toEqual(invalid);
    // The same token under another secret is another link.
    expect(await joinView(db, memberOf, ana, { ...link, secret: 't'.repeat(40) }, NOW)).toEqual(
      invalid,
    );
    db.update(schema.registrationInvite).set({ revokedAt: NOW }).run();
    expect(await joinView(db, memberOf, ana, link, NOW)).toEqual(invalid);
    db.update(schema.registrationInvite).set({ revokedAt: null }).run();
    db.update(schema.request).set({ status: 'withdrawn', decidedAt: NOW }).run();
    expect(await joinView(db, memberOf, ana, link, NOW)).toEqual(invalid);
  });

  it('lists what the player must complete first, all at once', async () => {
    const { db, memberOf, link, members } = await setup();
    const id = ensurePlayer(
      db,
      { orgId: 1, discordUserId: '719999999999999999', displayName: 'New' },
      1,
    ).id;
    members.add('719999999999999999');
    const view = await joinView(
      db,
      memberOf,
      { id, discordUserId: '719999999999999999' },
      link,
      NOW,
    );
    expect(view).toMatchObject({
      state: {
        kind: 'not_eligible',
        gaps: ['game_account', 'nationality', 'stats_consent', 'birth_date'],
        minAge: 16,
        seasonStartsOn: '2027-01-04',
      },
    });
  });

  it('counts the age on the season’s first day', async () => {
    const { db, memberOf, link, player } = await setup();
    expect(await joinView(db, memberOf, player(1, '2011-01-04'), link, NOW)).toMatchObject({
      state: { kind: 'can_join' },
    });
    expect(await joinView(db, memberOf, player(2, '2011-01-05'), link, NOW)).toMatchObject({
      state: { kind: 'not_eligible', gaps: ['too_young'] },
    });
  });

  it('sends a player who is not on the league’s Discord server there first', async () => {
    const { db, memberOf, link, player, members, discord } = await setup();
    const ana = player(1);
    members.delete(ana.discordUserId);
    expect(await joinView(db, memberOf, ana, link, NOW)).toMatchObject({
      state: { kind: 'not_member', inviteUrl: null },
    });
    db.update(schema.leagueGuild)
      .set({ inviteUrl: 'https://discord.gg/lfr' })
      .where(eq(schema.leagueGuild.guildId, TEST_GUILD))
      .run();
    expect(await joinView(db, memberOf, ana, link, NOW)).toMatchObject({
      state: { kind: 'not_member', inviteUrl: 'https://discord.gg/lfr' },
    });
    discord.down = true;
    expect(await joinView(db, memberOf, ana, link, NOW)).toMatchObject({
      state: { kind: 'discord_unavailable' },
    });
  });
});

describe('joinRegistration', () => {
  it('adds the player as a starter, audited, then shows them in', async () => {
    const { db, memberOf, link, player, filer } = await setup();
    const ana = player(1);
    expect(await joinRegistration(db, memberOf, ana, link, NOW)).toEqual({
      ok: true,
      requestId: 1,
      role: 'player',
    });
    expect(db.select().from(schema.registrationPlayer).all()).toEqual([
      { requestId: 1, playerId: ana.id, role: 'player', captain: false, joinedAt: NOW },
    ]);
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      actorPlayerId: ana.id,
      action: 'registration.join',
      entity: 'request',
      entityId: '1',
      afterJson: { playerId: ana.id, role: 'player' },
    });
    expect(await joinView(db, memberOf, ana, link, NOW)).toMatchObject({
      state: { kind: 'joined', role: 'player' },
    });
    // The filer sees them, ready.
    expect(registrationStatus(db, filer, 1, NOW)).toMatchObject({
      players: [{ playerId: ana.id, role: 'player', ready: true }],
    });
  });

  it('joins substitutes after the starters, and refuses once the roster is full', async () => {
    const { db, memberOf, link, player } = await setup();
    for (const n of [1, 2, 3, 4, 5]) await joinRegistration(db, memberOf, player(n), link, NOW);
    expect(await joinRegistration(db, memberOf, player(6), link, NOW)).toMatchObject({
      role: 'sub',
    });
    await joinRegistration(db, memberOf, player(7), link, NOW);
    expect(await joinRegistration(db, memberOf, player(8), link, NOW)).toEqual({
      ok: false,
      error: 'refused',
      state: { kind: 'refused', error: 'roster_full' },
    });
  });

  it('refuses a player who is not ready, or not on the server, and stores nothing', async () => {
    const { db, memberOf, link, player, members } = await setup();
    const young = player(1, '2012-01-01');
    expect(await joinRegistration(db, memberOf, young, link, NOW)).toMatchObject({
      ok: false,
      state: { kind: 'not_eligible', gaps: ['too_young'] },
    });
    const away = player(2);
    members.delete(away.discordUserId);
    expect(await joinRegistration(db, memberOf, away, link, NOW)).toMatchObject({
      ok: false,
      state: { kind: 'not_member' },
    });
    expect(db.select().from(schema.registrationPlayer).all()).toEqual([]);
  });

  it('keeps a player to one roster of the competition, not of the group', async () => {
    const { db, store, memberOf, link, player } = await setup();
    const ana = player(1);
    await joinRegistration(db, memberOf, ana, link, NOW);
    const other = ensurePlayer(
      db,
      { orgId: 1, discordUserId: '700000000000000003', displayName: 'Cy' },
      1,
    ).id;
    await fileRegistration(
      db,
      store,
      other,
      'lfr',
      {
        ...REQUEST,
        club: { ...REQUEST.club, name: 'Other Club' } as RegistrationRequest['club'],
        roster: { ...REQUEST.roster, name: 'Other', tag: 'OTH' },
      },
      NOW,
    );
    const second = db
      .select()
      .from(schema.registrationInvite)
      .where(eq(schema.registrationInvite.requestId, 2))
      .get();
    if (!second) throw new Error('no second invitation');
    const secondLink = { inviteId: second.id, token: inviteToken(SECRET, second), secret: SECRET };
    expect(await joinRegistration(db, memberOf, ana, secondLink, NOW)).toMatchObject({
      ok: false,
      state: { kind: 'refused', error: 'in_other_registration' },
    });

    // The same registration in another competition of the group does not count.
    const lfr = db.select().from(schema.competition).get();
    if (!lfr) throw new Error('no competition');
    const lfv = db
      .insert(schema.competition)
      .values({ ...lfr, id: undefined, slug: 'lfv', name: 'LFV' })
      .returning()
      .get();
    db.update(schema.request).set({ competitionId: lfv.id }).where(eq(schema.request.id, 1)).run();
    expect(await joinRegistration(db, memberOf, ana, secondLink, NOW)).toMatchObject({ ok: true });
  });

  it('refuses once the lineup is locked: from the season’s first day in LFR', async () => {
    const { db, memberOf, link, player } = await setup();
    db.update(schema.registrationInvite)
      .set({ expiresAt: SEASON_START + DAY })
      .run();
    expect(await joinRegistration(db, memberOf, player(1), link, SEASON_START)).toEqual({
      ok: false,
      error: 'refused',
      state: { kind: 'refused', error: 'lineup_locked' },
    });
  });

  it('says so to a player who already joined', async () => {
    const { db, memberOf, link, player } = await setup();
    const ana = player(1);
    await joinRegistration(db, memberOf, ana, link, NOW);
    expect(await joinRegistration(db, memberOf, ana, link, NOW)).toEqual({
      ok: false,
      error: 'refused',
      state: { kind: 'joined', role: 'player' },
    });
  });
});

describe('leaveRegistration', () => {
  it('lets a player leave until the lineup locks, audited', async () => {
    const { db, memberOf, link, player } = await setup();
    const ana = player(1);
    await joinRegistration(db, memberOf, ana, link, NOW);
    expect(leaveRegistration(db, ana.id, 1, SEASON_START)).toEqual({
      ok: false,
      error: 'lineup_locked',
    });
    expect(leaveRegistration(db, ana.id, 1, NOW)).toEqual({ ok: true });
    expect(db.select().from(schema.registrationPlayer).all()).toEqual([]);
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      actorPlayerId: ana.id,
      action: 'registration.leave',
      entityId: '1',
      beforeJson: { playerId: ana.id, role: 'player', captain: false },
    });
    expect(leaveRegistration(db, ana.id, 1, NOW)).toEqual({ ok: false, error: 'not_found' });
    expect(leaveRegistration(db, ana.id, 99, NOW)).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('registrationsOf', () => {
  it('lists the registrations a player filed and those they joined, with their status', async () => {
    const { db, memberOf, link, player, filer } = await setup();
    const ana = player(1);
    await joinRegistration(db, memberOf, ana, link, NOW);
    const entry = {
      requestId: 1,
      roster: 'Kairos',
      competition: 'LFR',
      season: 'Saison 4',
      status: 'pending',
    };
    expect(registrationsOf(db, filer, NOW)).toEqual({ filed: [entry], joined: [] });
    expect(registrationsOf(db, ana.id, NOW)).toEqual({
      filed: [],
      joined: [{ ...entry, role: 'player', canLeave: true }],
    });
    expect(registrationsOf(db, ana.id, SEASON_START).joined[0]?.canLeave).toBe(false);
    // An answered registration stays listed, so the filer finds staff's answer from their page.
    db.update(schema.request).set({ status: 'rejected', reason: 'Logo', decidedAt: NOW }).run();
    const rejected = { ...entry, status: 'rejected' };
    expect(registrationsOf(db, filer, NOW)).toEqual({ filed: [rejected], joined: [] });
    expect(registrationsOf(db, ana.id, NOW)).toEqual({
      filed: [],
      joined: [{ ...rejected, role: 'player', canLeave: false }],
    });
  });
});
