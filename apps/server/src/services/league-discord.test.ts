import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { fakeGateway } from '../discord/testing.ts';
import { leagueDatabase, LFR_KEY, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import {
  adminCompetitions,
  discordSettings,
  saveDiscordSettings,
  type DiscordSettingsChange,
} from './league-discord.ts';
import { ensurePlayer } from './players.ts';

// A league's Discord server, set on the website (maintainer, 15 November 2026): whoever may
// manage the league's server (its owner, or Manage Server) changes its staff role and its
// invitation link, or moves the league to another server they manage, where the bot is.

const NOW = 50_000;
const ANA_ID = '700000000000000001';
const OTHER_GUILD = '400000000000000004';
const ADMINS_ROLE = '300000000000000003';
const NEW_STAFF_ROLE = '300000000000000004';
const INVITE = 'https://discord.gg/lfr';

function setup() {
  const db = leagueDatabase();
  const gateway = fakeGateway();
  gateway.guilds.set(TEST_GUILD, {
    name: 'LFR Staging',
    roles: [
      { id: ADMINS_ROLE, name: 'Admins' },
      { id: TEST_STAFF_ROLE, name: 'Staff' },
    ],
    managers: [ANA_ID],
  });
  gateway.guilds.set(OTHER_GUILD, {
    name: 'LFR Officiel',
    roles: [{ id: NEW_STAFF_ROLE, name: 'Staff LFR' }],
    managers: [ANA_ID],
  });
  gateway.invites.set(INVITE, { guildId: TEST_GUILD, expiresAt: null });
  const ana = ensurePlayer(db, { orgId: 1, discordUserId: ANA_ID, displayName: 'Ana' }, 1);
  const user = { playerId: ana.id, discordUserId: ANA_ID };
  const change = (overrides: Partial<DiscordSettingsChange> = {}): DiscordSettingsChange => ({
    guildId: TEST_GUILD,
    staffRoleId: TEST_STAFF_ROLE,
    inviteUrl: INVITE,
    ...overrides,
  });
  return { db, gateway, user, change };
}

describe('discordSettings', () => {
  it('shows the league’s server and the servers its admin manages, with their roles', async () => {
    const { db, gateway, user } = setup();
    expect(await discordSettings(db, gateway, user, LFR_KEY, null)).toEqual({
      ok: true,
      competition: { id: 1, name: 'LFR', slug: 'lfr', path: '/mlb-group/lfr' },
      current: { guildId: TEST_GUILD, staffRoleId: TEST_STAFF_ROLE, inviteUrl: null },
      servers: [
        { id: TEST_GUILD, name: 'LFR Staging' },
        { id: OTHER_GUILD, name: 'LFR Officiel' },
      ],
      chosen: {
        id: TEST_GUILD,
        name: 'LFR Staging',
        roles: [
          { id: ADMINS_ROLE, name: 'Admins' },
          { id: TEST_STAFF_ROLE, name: 'Staff' },
        ],
      },
    });
    expect(await discordSettings(db, gateway, user, LFR_KEY, OTHER_GUILD)).toMatchObject({
      chosen: { id: OTHER_GUILD, roles: [{ id: NEW_STAFF_ROLE }] },
    });
  });

  it('is for those who may manage the league’s server only', async () => {
    const { db, gateway, user } = setup();
    expect(
      await discordSettings(db, gateway, user, { ...LFR_KEY, competition: 'nope' }, null),
    ).toEqual({
      ok: false,
      error: 'not_found',
    });
    const other = { playerId: 99, discordUserId: '799999999999999999' };
    expect(await discordSettings(db, gateway, other, LFR_KEY, null)).toEqual({
      ok: false,
      error: 'not_admin',
    });
    // Managing another server is not enough.
    gateway.guilds.set(TEST_GUILD, { name: 'LFR Staging', roles: [], managers: [] });
    expect(await discordSettings(db, gateway, user, LFR_KEY, null)).toEqual({
      ok: false,
      error: 'not_admin',
    });
    gateway.failing = true;
    expect(await discordSettings(db, gateway, user, LFR_KEY, null)).toEqual({
      ok: false,
      error: 'discord_unavailable',
    });
  });
});

describe('saveDiscordSettings', () => {
  it('saves the staff role and the invitation, audited', async () => {
    const { db, gateway, user, change } = setup();
    expect(
      await saveDiscordSettings(
        db,
        gateway,
        user,
        LFR_KEY,
        change({ staffRoleId: ADMINS_ROLE }),
        NOW,
      ),
    ).toEqual({ ok: true });
    expect(db.select().from(schema.leagueGuild).all()).toMatchObject([
      { guildId: TEST_GUILD, competitionId: 1, staffRoleId: ADMINS_ROLE, inviteUrl: INVITE },
    ]);
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      actorPlayerId: user.playerId,
      action: 'league.discord',
      entity: 'competition',
      entityId: '1',
      beforeJson: { guildId: TEST_GUILD, staffRoleId: TEST_STAFF_ROLE, inviteUrl: null },
      afterJson: { guildId: TEST_GUILD, staffRoleId: ADMINS_ROLE, inviteUrl: INVITE },
    });
  });

  it('moves the league to another server it manages, and forgets the old channels', async () => {
    const { db, gateway, user, change } = setup();
    db.update(schema.leagueGuild).set({ resultsChannelId: '600000000000000006' }).run();
    db.update(schema.division).set({ resultsChannelId: '600000000000000007' }).run();
    const invite = 'https://discord.gg/lfr-officiel';
    gateway.invites.set(invite, { guildId: OTHER_GUILD, expiresAt: null });
    expect(
      await saveDiscordSettings(
        db,
        gateway,
        user,
        LFR_KEY,
        change({ guildId: OTHER_GUILD, staffRoleId: NEW_STAFF_ROLE, inviteUrl: invite }),
        NOW,
      ),
    ).toEqual({ ok: true });
    expect(db.select().from(schema.leagueGuild).all()).toMatchObject([
      {
        guildId: OTHER_GUILD,
        competitionId: 1,
        staffRoleId: NEW_STAFF_ROLE,
        inviteUrl: invite,
        alertsChannelId: null,
        resultsChannelId: null,
        scheduleChannelId: null,
      },
    ]);
    expect(
      db
        .select()
        .from(schema.division)
        .all()
        .map((row) => row.resultsChannelId),
    ).toEqual([null, null]);
  });

  it.each([
    ['a server they do not manage', { guildId: '400000000000000009' }, 'server_not_managed'],
    ['a role of no use', { staffRoleId: TEST_GUILD }, 'invalid_role'],
    ['no invitation', { inviteUrl: ' ' }, 'invite_required'],
    ['an address that is no invitation', { inviteUrl: 'https://evil.example/x' }, 'invalid_invite'],
    [
      'an invitation Discord does not know',
      { inviteUrl: 'https://discord.gg/gone' },
      'invalid_invite',
    ],
  ] as const)('refuses %s', async (_label, overrides, error) => {
    const { db, gateway, user, change } = setup();
    expect(await saveDiscordSettings(db, gateway, user, LFR_KEY, change(overrides), NOW)).toEqual({
      ok: false,
      error,
    });
    expect(db.select().from(schema.leagueGuild).get()?.inviteUrl).toBeNull();
  });

  it('wants an invitation to the league’s own server, that never expires', async () => {
    const { db, gateway, user, change } = setup();
    gateway.invites.set('https://discord.gg/other', { guildId: OTHER_GUILD, expiresAt: null });
    gateway.invites.set('https://discord.gg/week', { guildId: TEST_GUILD, expiresAt: NOW + 1 });
    const save = (inviteUrl: string) =>
      saveDiscordSettings(db, gateway, user, LFR_KEY, change({ inviteUrl }), NOW);
    expect(await save('https://discord.gg/other')).toEqual({
      ok: false,
      error: 'invite_other_server',
    });
    expect(await save('https://discord.gg/week')).toEqual({ ok: false, error: 'invite_expires' });
  });

  it('refuses a server another competition uses, and anyone who may not manage the league', async () => {
    const { db, gateway, user, change } = setup();
    const lfr = db.select().from(schema.competition).get();
    if (!lfr) throw new Error('no competition');
    const lfv = db
      .insert(schema.competition)
      .values({ ...lfr, id: undefined, slug: 'lfv', name: 'LFV' })
      .returning()
      .get();
    db.insert(schema.leagueGuild)
      .values({
        guildId: OTHER_GUILD,
        orgId: 1,
        competitionId: lfv.id,
        staffRoleId: NEW_STAFF_ROLE,
      })
      .run();
    expect(
      await saveDiscordSettings(
        db,
        gateway,
        user,
        LFR_KEY,
        change({ guildId: OTHER_GUILD, staffRoleId: NEW_STAFF_ROLE }),
        NOW,
      ),
    ).toEqual({ ok: false, error: 'server_taken' });
    const other = { playerId: 99, discordUserId: '799999999999999999' };
    expect(await saveDiscordSettings(db, gateway, other, LFR_KEY, change(), NOW)).toEqual({
      ok: false,
      error: 'not_admin',
    });
  });
});

describe('adminCompetitions', () => {
  it('lists the competitions whose server the user may manage', async () => {
    const { db, gateway, user } = setup();
    expect(await adminCompetitions(db, gateway, ANA_ID)).toEqual([
      { name: 'LFR', path: '/mlb-group/lfr' },
    ]);
    expect(await adminCompetitions(db, gateway, '799999999999999999')).toEqual([]);
    gateway.failing = true;
    expect(await adminCompetitions(db, gateway, user.discordUserId)).toEqual([]);
  });
});
