import type { DesiredState, GuildSnapshot } from '@ligo/core';
import { schema } from '@ligo/db';
import { openTestDatabase } from '@ligo/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeGateway } from '../discord/testing.ts';
import { leagueDatabase, TEST_GUILD } from '../testing.ts';
import { syncGuild, syncLeague } from './reconciler.ts';

// The reconciler on a server (phase 4; design doc section 6, "Reconciler"): it reads the server,
// compares it with what Ligo wants (`@ligo/core` reconcile), makes the changes in order, and keeps
// the ID of each object it creates in `discord_object`, so the next run finds them by ID.

const GUILD = '900000000000000000';
const STAFF = '900000000000000001';
const ALICE = '700000000000000001';
const NOW = 1_800_000_000_000;
const TEAM = ['view_channel', 'send_messages', 'read_message_history'] as const;

const guild = (id = GUILD): GuildSnapshot => ({
  everyoneId: id,
  roles: [
    { id, name: '@everyone', color: null, mentionable: false },
    { id: STAFF, name: 'Staff', color: null, mentionable: false },
  ],
  categories: [],
  channels: [],
  members: [{ id: ALICE, roleIds: [] }],
});

const desired = (): DesiredState => ({
  roles: [
    { key: 'team:1', name: 'Greed Esport', color: 0xff0000, mentionable: true, members: [ALICE] },
  ],
  categories: [{ kind: 'moss_category', key: 'division:1', name: 'MOSS · L1' }],
  channels: [
    {
      kind: 'moss_channel',
      key: 'team:1',
      name: 'moss-grd',
      parent: { kind: 'moss_category', key: 'division:1' },
      overwrites: [
        { target: { role: { id: GUILD } }, allow: [], deny: ['view_channel'] },
        { target: { role: { key: 'team:1' } }, allow: [...TEAM], deny: [] },
        { target: { role: { id: STAFF } }, allow: [...TEAM], deny: [] },
      ],
    },
  ],
});

function setUp() {
  const db = openTestDatabase();
  const gateway = fakeGateway();
  gateway.snapshots.set(GUILD, guild());
  const objects = () =>
    db
      .select()
      .from(schema.discordObject)
      .all()
      .map(({ kind, key, discordId, createdByLigo }) => ({ kind, key, discordId, createdByLigo }));
  const sync = (state = desired(), dryRun = false) =>
    syncGuild(db, gateway, GUILD, state, { dryRun, now: NOW, actorPlayerId: null });
  const audits = () =>
    db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'discord.sync')).all();
  return { db, gateway, objects, sync, audits };
}

describe('syncGuild', () => {
  it('creates what is missing, keeps each ID, and has nothing left to do the second time', async () => {
    const { gateway, objects, sync, audits } = setUp();
    const first = await sync();
    expect(first).toMatchObject({ ok: true, applied: 4, failures: [] });
    expect(gateway.changes.map((entry) => entry.change.kind)).toEqual([
      'create_role',
      'create_category',
      'create_text_channel',
      'add_member_role',
    ]);
    const server = gateway.snapshots.get(GUILD);
    const role = server?.roles.find((candidate) => candidate.name === 'Greed Esport');
    const channel = server?.channels.find((candidate) => candidate.name === 'moss-grd');
    expect(objects()).toEqual([
      { kind: 'team_role', key: 'team:1', discordId: role?.id, createdByLigo: true },
      {
        kind: 'moss_category',
        key: 'division:1',
        discordId: server?.categories[0]?.id,
        createdByLigo: true,
      },
      { kind: 'moss_channel', key: 'team:1', discordId: channel?.id, createdByLigo: true },
    ]);
    // The channel was created with the new role's ID in its overwrites.
    expect(channel?.overwrites.map((overwrite) => overwrite.id)).toContain(role?.id);
    expect(server?.members[0]?.roleIds).toEqual([role?.id]);
    expect(gateway.changes.every((entry) => entry.reason.length > 0)).toBe(true);

    expect(await sync()).toMatchObject({ ok: true, operations: [], applied: 0 });
    expect(audits()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({
      actorKind: 'bot',
      entity: 'league_guild',
      entityId: GUILD,
    });
    expect(audits()[0]?.afterJson).toMatchObject({ applied: 4, failed: 0 });
  });

  it('only reports what it would do in a dry run', async () => {
    const { gateway, objects, sync, audits } = setUp();
    const reply = await sync(desired(), true);
    expect(reply.ok && reply.operations.map((operation) => operation.op)).toEqual([
      'create_role',
      'create_category',
      'create_channel',
      'add_member_role',
    ]);
    expect(reply).toMatchObject({ applied: 0 });
    expect(gateway.changes).toEqual([]);
    expect(objects()).toEqual([]);
    expect(audits()).toEqual([]);
  });

  it('recreates a role deleted by hand and stores its new ID', async () => {
    const { gateway, objects, sync } = setUp();
    await sync();
    const server = gateway.snapshots.get(GUILD);
    const old = objects().find((object) => object.kind === 'team_role')?.discordId;
    if (!server || !old) throw new Error('set up');
    server.roles = server.roles.filter((role) => role.id !== old);
    for (const one of server.channels)
      one.overwrites = one.overwrites.filter((overwrite) => overwrite.id !== old);
    for (const one of server.members) one.roleIds = one.roleIds.filter((id) => id !== old);
    expect(await sync()).toMatchObject({ ok: true, failures: [] });
    const fresh = objects().find((object) => object.kind === 'team_role')?.discordId;
    expect(fresh).not.toBe(old);
    expect(server.roles.map((role) => role.id)).toContain(fresh);
    expect(await sync()).toMatchObject({ operations: [] });
  });

  it('goes on after a refusal, and skips what needed the object that could not be made', async () => {
    const { gateway, objects, sync, audits } = setUp();
    gateway.refused.add('create_role');
    const reply = await sync();
    if (!reply.ok) throw new Error(reply.error);
    expect(reply.failures.map((failure) => failure.operation.op)).toEqual([
      'create_role',
      'create_channel',
      'add_member_role',
    ]);
    expect(reply.failures[0]?.message).toBe('Missing Permissions');
    expect(reply.applied).toBe(1);
    expect(objects().map((object) => object.kind)).toEqual(['moss_category']);
    expect(audits()[0]?.afterJson).toMatchObject({ applied: 1, failed: 3 });
    // Once Discord allows it, the next run finishes the job.
    gateway.refused.clear();
    expect(await sync()).toMatchObject({ ok: true, failures: [], applied: 3 });
  });

  it('deletes what it no longer needs and forgets it; a linked role is only forgotten', async () => {
    const { db, gateway, objects, sync } = setUp();
    await sync();
    const server = gateway.snapshots.get(GUILD);
    server?.roles.push({
      id: '800000000000000123',
      name: 'Hand-made',
      color: null,
      mentionable: false,
    });
    db.insert(schema.discordObject)
      .values({
        guildId: GUILD,
        kind: 'team_role',
        key: 'team:2',
        discordId: '800000000000000123',
        createdByLigo: false,
        createdAt: NOW,
      })
      .run();
    const none: DesiredState = {
      roles: [],
      categories: [],
      channels: [],
      release: [{ kind: 'moss_channel', key: 'team:1' }],
    };
    expect(await sync(none)).toMatchObject({ ok: true, failures: [] });
    expect(objects()).toEqual([]);
    expect(server?.roles.map((role) => role.name)).toEqual(['@everyone', 'Staff', 'Hand-made']);
    expect(server?.channels).toEqual([]);
  });

  it('keeps a linked role linked while it manages who holds it', async () => {
    const { db, gateway, objects, sync } = setUp();
    gateway.snapshots.get(GUILD)?.roles.push({
      id: '800000000000000124',
      name: '⚔️ Greed',
      color: null,
      mentionable: false,
    });
    db.insert(schema.discordObject)
      .values({
        guildId: GUILD,
        kind: 'team_role',
        key: 'team:1',
        discordId: '800000000000000124',
        createdByLigo: false,
        createdAt: NOW,
      })
      .run();
    const state: DesiredState = { ...desired(), categories: [], channels: [] };
    await sync(state);
    expect(objects()).toEqual([
      { kind: 'team_role', key: 'team:1', discordId: '800000000000000124', createdByLigo: false },
    ]);
    expect(gateway.snapshots.get(GUILD)?.members[0]?.roleIds).toEqual(['800000000000000124']);
  });

  it('says when Discord does not answer or the bot is not in the server, and changes nothing', async () => {
    const { gateway, sync, objects } = setUp();
    gateway.failing = true;
    expect(await sync()).toEqual({ ok: false, error: 'discord_unavailable' });
    gateway.failing = false;
    gateway.snapshots.delete(GUILD);
    expect(await sync()).toEqual({ ok: false, error: 'not_in_server' });
    expect(objects()).toEqual([]);
  });

  it('runs one sync at a time per server, so two at once never make a thing twice', async () => {
    const { gateway, sync } = setUp();
    const [first, second] = await Promise.all([sync(), sync()]);
    expect(first).toMatchObject({ ok: true, applied: 4 });
    expect(second).toMatchObject({ ok: true, applied: 0 });
    expect(gateway.snapshots.get(GUILD)?.roles).toHaveLength(3);
  });

  it('keeps each server’s objects apart', async () => {
    const { db, gateway, sync, objects } = setUp();
    await sync();
    const other = '900000000000000099';
    gateway.snapshots.set(other, guild(other));
    const reply = await syncGuild(db, gateway, other, desired(), {
      dryRun: true,
      now: NOW,
      actorPlayerId: null,
    });
    expect(
      reply.ok && reply.operations.filter((operation) => operation.op.startsWith('create')),
    ).toHaveLength(3);
    expect(objects()).toHaveLength(3);
  });
});

describe('syncLeague', () => {
  it('does nothing while the league does not let Ligo manage its server', async () => {
    const db = leagueDatabase();
    const gateway = fakeGateway();
    gateway.snapshots.set(TEST_GUILD, guild(TEST_GUILD));
    expect(
      await syncLeague(db, gateway, 1, { dryRun: false, now: NOW, actorPlayerId: null }),
    ).toEqual({
      ok: false,
      error: 'not_managed',
    });
    expect(gateway.changes).toEqual([]);
  });

  it('syncs the league’s own server once it does, and refuses a league with no server', async () => {
    const db = leagueDatabase();
    const gateway = fakeGateway();
    gateway.snapshots.set(TEST_GUILD, guild(TEST_GUILD));
    const row = db.select().from(schema.competition).get();
    if (!row) throw new Error('set up');
    db.update(schema.competition)
      .set({
        rulesetJson: { ...row.rulesetJson, discord: { ...row.rulesetJson.discord, manage: true } },
      })
      .run();
    expect(
      await syncLeague(db, gateway, 1, { dryRun: true, now: NOW, actorPlayerId: null }),
    ).toMatchObject({
      ok: true,
    });
    db.delete(schema.leagueGuild).run();
    expect(
      await syncLeague(db, gateway, 1, { dryRun: true, now: NOW, actorPlayerId: null }),
    ).toEqual({
      ok: false,
      error: 'not_linked',
    });
  });
});
