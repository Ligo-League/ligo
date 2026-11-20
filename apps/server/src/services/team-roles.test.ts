import { discordSettingsSchema, type GuildSnapshot } from '@ligo/core';
import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeGateway } from '../discord/testing.ts';
import { leagueDatabase, mercatoLineups, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { ensurePlayer } from './players.ts';
import { syncLeague } from './reconciler.ts';
import {
  desiredTeamRoles,
  linkTeamRole,
  teamRoleChoices,
  teamRoleKey,
  unlinkTeamRole,
} from './team-roles.ts';

// Team roles (phase 4; design doc section 6; M-46): one per roster playing in the competition,
// held by its season lineup and its officials; staff may link an existing role instead.

const NOW = 1_800_000_000_000;
const settings = discordSettingsSchema.parse({ manage: true });
/** P n's Discord ID, as `rosterPlayerForTests` makes it. */
const discordOf = (n: number) => `71000000000000000${String(n)}`.slice(-18);
const HAND_MADE = '800000000000000500';
const DIVISION_STAFF = '800000000000000501';

function setUp() {
  const db = leagueDatabase();
  mercatoLineups(db);
  const gateway = fakeGateway();
  const server: GuildSnapshot = {
    everyoneId: TEST_GUILD,
    roles: [
      { id: TEST_GUILD, name: '@everyone', color: null, mentionable: false },
      { id: TEST_STAFF_ROLE, name: 'Staff', color: null, mentionable: false },
      { id: HAND_MADE, name: '⚔️ Alpha', color: null, mentionable: false },
      { id: DIVISION_STAFF, name: 'Staff L1', color: null, mentionable: false },
    ],
    categories: [],
    channels: [],
    members: [1, 2, 3, 9].map((n) => ({ id: discordOf(n), roleIds: [] })),
  };
  gateway.snapshots.set(TEST_GUILD, server);
  const official = (name: string, discordUserId: string | null) =>
    discordUserId === null
      ? db
          .insert(schema.player)
          .values({ orgId: 1, slug: name.toLowerCase(), displayName: name, createdAt: 0 })
          .returning()
          .get().id
      : ensurePlayer(db, { orgId: 1, discordUserId, displayName: name }, 0).id;
  const roles = () => desiredTeamRoles(db, 1, settings, NOW);
  const roleOf = (teamId: number) => roles().find((role) => role.key === teamRoleKey(teamId));
  const manage = () => {
    const row = db.select().from(schema.competition).get();
    if (!row) throw new Error('set up');
    db.update(schema.competition)
      .set({ rulesetJson: { ...row.rulesetJson, discord: settings } })
      .run();
  };
  const audits = (action: string) =>
    db.select().from(schema.auditLog).where(eq(schema.auditLog.action, action)).all();
  return { db, gateway, server, official, roles, roleOf, manage, audits };
}

describe('desiredTeamRoles', () => {
  it('wants one role per roster of the season, named and coloured after it, held by its lineup', () => {
    const { roles, roleOf } = setUp();
    expect(roles().map((role) => role.name)).toEqual([
      'Alpha Esport',
      'Bravo',
      'Charlie',
      'Xray',
      'Yankee',
    ]);
    expect(roleOf(1)).toEqual({
      key: 'team:1',
      name: 'Alpha Esport',
      color: 0x112233,
      mentionable: true,
      members: [1, 2, 3, 4, 5, 6].map(discordOf).sort(),
    });
    expect(roleOf(2)?.members).toEqual([discordOf(9)]);
    expect(roleOf(3)?.members).toEqual([]);
  });

  it('gives it to the roster’s officials and its club’s, never to a player without Discord', () => {
    const { db, official, roleOf } = setUp();
    const manager = official('Manon', '720000000000000001');
    const owner = official('Olga', '720000000000000002');
    const gone = official('Gaston', '720000000000000003');
    const noDiscord = official('Nadia', null);
    db.insert(schema.teamStaff)
      .values([
        { teamId: 3, playerId: manager, role: 'manager', since: 0 },
        { teamId: 3, playerId: gone, role: 'coach', since: 0, until: 5 },
        { teamId: 3, playerId: noDiscord, role: 'coach', since: 0 },
      ])
      .run();
    const clubId = db.select().from(schema.team).where(eq(schema.team.id, 3)).get()?.clubId ?? 0;
    db.insert(schema.clubStaff).values({ clubId, playerId: owner, role: 'owner', since: 0 }).run();
    expect(roleOf(3)?.members).toEqual(['720000000000000001', '720000000000000002']);
  });

  it('follows the lineup in time: a move waiting for its date not yet, an ended one no more', () => {
    const { db, roleOf } = setUp();
    const p6 = db
      .select()
      .from(schema.player)
      .where(eq(schema.player.discordUserId, discordOf(6)))
      .get();
    const p7 = db
      .select()
      .from(schema.player)
      .where(eq(schema.player.discordUserId, discordOf(7)))
      .get();
    if (!p6 || !p7) throw new Error('set up');
    db.update(schema.rosterEntry)
      .set({ validTo: NOW })
      .where(eq(schema.rosterEntry.playerId, p6.id))
      .run();
    const seasonId = db.select().from(schema.season).get()?.id ?? 0;
    db.insert(schema.rosterEntry)
      .values({ seasonId, teamId: 1, playerId: p7.id, role: 'sub', validFrom: NOW + 1 })
      .run();
    expect(roleOf(1)?.members).toEqual([1, 2, 3, 4, 5].map(discordOf).sort());
  });

  it('wants no role for a team withdrawn or excluded, nor once the season is closed', () => {
    const { db, roles } = setUp();
    db.update(schema.slot).set({ status: 'withdrawn' }).where(eq(schema.slot.teamId, 1)).run();
    db.update(schema.slot).set({ status: 'excluded' }).where(eq(schema.slot.teamId, 2)).run();
    db.update(schema.slot).set({ status: 'frozen' }).where(eq(schema.slot.teamId, 3)).run();
    expect(roles().map((role) => role.key)).toEqual(['team:3', 'team:4', 'team:5']);
    db.update(schema.season).set({ status: 'closed' }).run();
    expect(roles()).toEqual([]);
  });

  it('names roles from the league’s template, in the roster’s own colour or else its club’s', () => {
    const { db } = setUp();
    db.update(schema.team)
      .set({ colorsJson: ['#ABCDEF'] })
      .where(eq(schema.team.id, 2))
      .run();
    const named = desiredTeamRoles(
      db,
      1,
      discordSettingsSchema.parse({
        team_role_template: 'Équipe {tag}',
        team_roles_mentionable: false,
      }),
      NOW,
    );
    expect(named[1]).toMatchObject({ name: 'Équipe BRV', color: 0xabcdef, mentionable: false });
    expect(named[0]?.color).toBe(0x112233);
  });
});

describe('syncLeague with team roles', () => {
  it('creates each roster’s role and gives it to the holders on the server', async () => {
    const { db, gateway, server, manage } = setUp();
    manage();
    const reply = await syncLeague(db, gateway, 1, {
      dryRun: false,
      now: NOW,
      actorPlayerId: null,
    });
    if (!reply.ok) throw new Error(reply.error);
    expect(reply.failures).toEqual([]);
    const alpha = server.roles.find((role) => role.name === 'Alpha Esport');
    expect(server.members.find((member) => member.id === discordOf(1))?.roleIds).toEqual([
      alpha?.id,
    ]);
    // P4 to P6 are not on the server: reported, nothing to give.
    expect(reply.absentMembers.map((absent) => absent.userId)).toEqual(
      [4, 5, 6].map(discordOf).sort(),
    );
  });
});

describe('linking a role to a roster', () => {
  const change = { competitionId: 1, teamId: 1, actorPlayerId: 1, now: NOW };

  it('lists the rosters and the roles staff may link, never the staff roles', async () => {
    const { db, gateway } = setUp();
    db.update(schema.division).set({ staffRoleId: DIVISION_STAFF }).run();
    const choices = await teamRoleChoices(db, gateway, 1);
    if (!choices.ok) throw new Error(choices.error);
    expect(choices.rosters[0]).toEqual({ teamId: 1, name: 'Alpha Esport', tag: 'ALP', role: null });
    expect(choices.linkable).toEqual([{ id: HAND_MADE, name: '⚔️ Alpha' }]);
  });

  it('links a hand-made role, keeps it as it is, and gives it to the holders', async () => {
    const { db, gateway, server, manage, audits } = setUp();
    manage();
    expect(await linkTeamRole(db, gateway, { ...change, roleId: HAND_MADE })).toEqual({ ok: true });
    expect(audits('discord.team_role.link')).toHaveLength(1);
    await syncLeague(db, gateway, 1, { dryRun: false, now: NOW, actorPlayerId: null });
    expect(server.roles.find((role) => role.id === HAND_MADE)?.name).toBe('⚔️ Alpha');
    expect(server.roles.filter((role) => role.name === 'Alpha Esport')).toEqual([]);
    expect(server.members.find((member) => member.id === discordOf(1))?.roleIds).toEqual([
      HAND_MADE,
    ]);
    const choices = await teamRoleChoices(db, gateway, 1);
    expect(choices.ok && choices.rosters[0]?.role).toEqual({
      id: HAND_MADE,
      name: '⚔️ Alpha',
      linked: true,
    });
  });

  it('deletes the role Ligo had made for the roster when one is linked instead', async () => {
    const { db, gateway, server, manage } = setUp();
    manage();
    await syncLeague(db, gateway, 1, { dryRun: false, now: NOW, actorPlayerId: null });
    const made = server.roles.find((role) => role.name === 'Alpha Esport')?.id;
    expect(await linkTeamRole(db, gateway, { ...change, roleId: HAND_MADE })).toEqual({ ok: true });
    expect(server.roles.some((role) => role.id === made)).toBe(false);
    expect(
      await syncLeague(db, gateway, 1, { dryRun: true, now: NOW, actorPlayerId: null }),
    ).toMatchObject({
      ok: true,
      operations: [1, 2, 3].map((n) => ({ op: 'add_member_role', userId: discordOf(n) })),
    });
  });

  it('refuses @everyone, a staff role, a role not on the server, one another roster holds', async () => {
    const { db, gateway, manage } = setUp();
    manage();
    db.update(schema.division).set({ staffRoleId: DIVISION_STAFF }).run();
    const link = (roleId: string, teamId = 1) =>
      linkTeamRole(db, gateway, { ...change, teamId, roleId });
    expect(await link(TEST_GUILD)).toEqual({ ok: false, error: 'reserved_role' });
    expect(await link(TEST_STAFF_ROLE)).toEqual({ ok: false, error: 'reserved_role' });
    expect(await link(DIVISION_STAFF)).toEqual({ ok: false, error: 'reserved_role' });
    expect(await link('800000000000000999')).toEqual({ ok: false, error: 'unknown_role' });
    expect(await link(HAND_MADE, 99)).toEqual({ ok: false, error: 'not_a_roster' });
    await link(HAND_MADE);
    expect(await link(HAND_MADE, 2)).toEqual({ ok: false, error: 'role_taken' });
    gateway.failing = true;
    expect(await link(HAND_MADE, 2)).toEqual({ ok: false, error: 'discord_unavailable' });
  });

  it('unlinks: the role stays on the server and the next sync makes the roster one', async () => {
    const { db, gateway, server, manage, audits } = setUp();
    manage();
    expect(await unlinkTeamRole(db, change)).toEqual({ ok: false, error: 'not_a_link' });
    await linkTeamRole(db, gateway, { ...change, roleId: HAND_MADE });
    expect(await unlinkTeamRole(db, change)).toEqual({ ok: true });
    expect(audits('discord.team_role.unlink')).toHaveLength(1);
    await syncLeague(db, gateway, 1, { dryRun: false, now: NOW, actorPlayerId: null });
    expect(server.roles.map((role) => role.name)).toContain('⚔️ Alpha');
    expect(server.roles.map((role) => role.name)).toContain('Alpha Esport');
  });
});
