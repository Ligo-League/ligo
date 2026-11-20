import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  reconcile,
  type DesiredState,
  type GuildSnapshot,
  type KnownObject,
  type Operation,
} from './reconcile.ts';

// The reconciler's diff (design doc section 6, "Reconciler"; M-46): the database says what the
// league's server should hold, the guild says what it holds, and the stored IDs link the two.
// The cases are those of section 14: fresh server, renamed channel, deleted role, missing
// permission, archived week, MOSS channels; plus what Ligo did not create, which it never
// touches.

const GUILD = '900000000000000000';
const STAFF = '900000000000000001';
const BOT = '900000000000000002';
const HAND_MADE_ROLE = '900000000000000003';
const ALICE = '700000000000000001';
const BOB = '700000000000000002';
const CAROL = '700000000000000003';

const TEAM = ['view_channel', 'send_messages', 'read_message_history'] as const;

/** Ligue 1 week 3: one match channel GRD against RCK, and GRD's MOSS channel. */
function desired(): DesiredState {
  return {
    roles: [
      { key: 'team:1', name: 'Greed Esport', color: 0xff0000, mentionable: true, members: [ALICE] },
      { key: 'team:2', name: 'RCK Esport', color: null, mentionable: true, members: [BOB] },
    ],
    categories: [
      { kind: 'week_category', key: 'division:1:week:3', name: 'L1 · Semaine 3' },
      { kind: 'moss_category', key: 'division:1', name: 'MOSS L1' },
    ],
    channels: [
      {
        kind: 'match_channel',
        key: 'match:7',
        name: 'w3-grd-rck',
        parent: { kind: 'week_category', key: 'division:1:week:3' },
        overwrites: [
          { target: { role: { id: GUILD } }, allow: [], deny: ['view_channel'] },
          { target: { role: { key: 'team:1' } }, allow: [...TEAM], deny: [] },
          { target: { role: { key: 'team:2' } }, allow: [...TEAM], deny: [] },
          { target: { role: { id: STAFF } }, allow: [...TEAM], deny: [] },
          { target: { member: BOT }, allow: [...TEAM, 'pin_messages'], deny: [] },
        ],
      },
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
  };
}

function emptyGuild(): GuildSnapshot {
  return {
    everyoneId: GUILD,
    roles: [
      { id: GUILD, name: '@everyone', color: null, mentionable: false },
      { id: STAFF, name: 'Staff', color: null, mentionable: false },
      { id: HAND_MADE_ROLE, name: 'Supporters', color: null, mentionable: false },
    ],
    categories: [],
    channels: [],
    members: [
      { id: ALICE, roleIds: [] },
      { id: BOB, roleIds: [] },
      { id: CAROL, roleIds: [HAND_MADE_ROLE] },
      { id: BOT, roleIds: [] },
    ],
  };
}

// Discord never hands out an ID twice: one counter for every simulated pass.
let nextId = 10_000;

/**
 * Plays operations on a snapshot the way the server's applier does on Discord, giving new IDs
 * to what it creates and recording them. Lets each test check that one pass is enough.
 */
function apply(
  guild: GuildSnapshot,
  known: KnownObject[],
  operations: Operation[],
): { guild: GuildSnapshot; known: KnownObject[] } {
  // A deep copy: the snapshot is plain data.
  const next = JSON.parse(JSON.stringify(guild)) as GuildSnapshot;
  let ids = [...known];
  const idOf = (kind: string, key: string) => {
    const found = ids.find((object) => object.kind === kind && object.key === key);
    if (!found) throw new Error(`No ID for ${kind} ${key}`);
    return found.discordId;
  };
  const remember = (kind: KnownObject['kind'], key: string, discordId: string) => {
    ids = [
      ...ids.filter((object) => !(object.kind === kind && object.key === key)),
      { kind, key, discordId, createdByLigo: true },
    ];
  };
  const roleId = (ref: { key: string } | { id: string }) =>
    'id' in ref ? ref.id : idOf('team_role', ref.key);
  const target = (t: Operation & { op: 'set_overwrite' }) =>
    'member' in t.target
      ? { id: t.target.member, type: 'member' as const }
      : { id: roleId(t.target.role), type: 'role' as const };
  for (const operation of operations) {
    nextId += 1;
    const fresh = String(nextId);
    switch (operation.op) {
      case 'create_role':
        next.roles.push({
          id: fresh,
          name: operation.name,
          color: operation.color,
          mentionable: operation.mentionable,
        });
        remember('team_role', operation.key, fresh);
        break;
      case 'update_role': {
        const role = next.roles.find((candidate) => candidate.id === operation.id);
        if (role) Object.assign(role, operation.changes);
        break;
      }
      case 'create_category':
        next.categories.push({ id: fresh, name: operation.name });
        remember(operation.kind, operation.key, fresh);
        break;
      case 'rename_category': {
        const category = next.categories.find((candidate) => candidate.id === operation.id);
        if (category) category.name = operation.name;
        break;
      }
      case 'create_channel':
        next.channels.push({
          id: fresh,
          name: operation.name,
          parentId: idOf(operation.parent.kind, operation.parent.key),
          overwrites: operation.overwrites.map((overwrite) => ({
            ...('member' in overwrite.target
              ? { id: overwrite.target.member, type: 'member' as const }
              : { id: roleId(overwrite.target.role), type: 'role' as const }),
            allow: [...overwrite.allow],
            deny: [...overwrite.deny],
          })),
        });
        remember(operation.kind, operation.key, fresh);
        break;
      case 'update_channel': {
        const channel = next.channels.find((candidate) => candidate.id === operation.id);
        if (!channel) break;
        if (operation.name !== undefined) channel.name = operation.name;
        if (operation.parent) channel.parentId = idOf(operation.parent.kind, operation.parent.key);
        break;
      }
      case 'set_overwrite': {
        const channel = next.channels.find((candidate) => candidate.id === operation.channelId);
        if (!channel) break;
        const { id, type } = target(operation);
        channel.overwrites = [
          ...channel.overwrites.filter((overwrite) => overwrite.id !== id),
          { id, type, allow: [...operation.allow], deny: [...operation.deny] },
        ];
        break;
      }
      case 'remove_overwrite': {
        const channel = next.channels.find((candidate) => candidate.id === operation.channelId);
        if (channel)
          channel.overwrites = channel.overwrites.filter(
            (overwrite) => overwrite.id !== operation.targetId,
          );
        break;
      }
      case 'add_member_role': {
        const member = next.members.find((candidate) => candidate.id === operation.userId);
        member?.roleIds.push(roleId(operation.role));
        break;
      }
      case 'remove_member_role': {
        const member = next.members.find((candidate) => candidate.id === operation.userId);
        if (member) member.roleIds = member.roleIds.filter((id) => id !== roleId(operation.role));
        break;
      }
      case 'delete_channel':
        next.channels = next.channels.filter((channel) => channel.id !== operation.id);
        ids = ids.filter(
          (object) => !(object.kind === operation.kind && object.key === operation.key),
        );
        break;
      case 'delete_category':
        next.categories = next.categories.filter((category) => category.id !== operation.id);
        ids = ids.filter(
          (object) => !(object.kind === operation.kind && object.key === operation.key),
        );
        break;
      case 'delete_role':
        next.roles = next.roles.filter((role) => role.id !== operation.id);
        for (const member of next.members)
          member.roleIds = member.roleIds.filter((id) => id !== operation.id);
        ids = ids.filter(
          (object) => !(object.kind === 'team_role' && object.key === operation.key),
        );
        break;
      case 'forget':
        ids = ids.filter(
          (object) => !(object.kind === operation.kind && object.key === operation.key),
        );
        break;
    }
  }
  return { guild: next, known: ids };
}

/** A server Ligo set up from nothing, and what Ligo stored doing so. */
function inSync(state: DesiredState = desired()) {
  const first = reconcile(state, emptyGuild(), []);
  return apply(emptyGuild(), [], first.operations);
}
const ops = (operations: Operation[]) => operations.map((operation) => operation.op);

describe('reconcile', () => {
  it('sets up a fresh server: roles, then categories, then channels, then members', () => {
    const { operations } = reconcile(desired(), emptyGuild(), []);
    expect(ops(operations)).toEqual([
      'create_role',
      'create_role',
      'create_category',
      'create_category',
      'create_channel',
      'create_channel',
      'add_member_role',
      'add_member_role',
    ]);
    expect(operations[4]).toMatchObject({
      op: 'create_channel',
      key: 'match:7',
      name: 'w3-grd-rck',
      parent: { kind: 'week_category', key: 'division:1:week:3' },
    });
    expect(operations.slice(6)).toEqual([
      { op: 'add_member_role', userId: ALICE, role: { key: 'team:1' } },
      { op: 'add_member_role', userId: BOB, role: { key: 'team:2' } },
    ]);
  });

  it('has nothing to do once the server matches', () => {
    const { guild, known } = inSync();
    expect(reconcile(desired(), guild, known).operations).toEqual([]);
  });

  it('renames a channel and a category renamed by hand, found by their stored IDs', () => {
    const { guild, known } = inSync();
    const channel = guild.channels.find((candidate) => candidate.name === 'w3-grd-rck');
    const category = guild.categories.find((candidate) => candidate.name === 'L1 · Semaine 3');
    if (!channel || !category) throw new Error('set up');
    channel.name = 'renamed';
    category.name = 'Whatever';
    const { operations } = reconcile(desired(), guild, known);
    expect(operations).toEqual([
      {
        op: 'rename_category',
        kind: 'week_category',
        key: 'division:1:week:3',
        id: category.id,
        name: 'L1 · Semaine 3',
      },
      {
        op: 'update_channel',
        kind: 'match_channel',
        key: 'match:7',
        id: channel.id,
        name: 'w3-grd-rck',
      },
    ]);
  });

  it('recreates a role deleted by hand, gives it back to its members and to its channels', () => {
    const { guild, known } = inSync();
    const greed = known.find((object) => object.key === 'team:1' && object.kind === 'team_role');
    if (!greed) throw new Error('set up');
    guild.roles = guild.roles.filter((role) => role.id !== greed.discordId);
    for (const channel of guild.channels)
      channel.overwrites = channel.overwrites.filter(
        (overwrite) => overwrite.id !== greed.discordId,
      );
    for (const member of guild.members)
      member.roleIds = member.roleIds.filter((id) => id !== greed.discordId);
    const { operations } = reconcile(desired(), guild, known);
    expect(ops(operations)).toEqual([
      'create_role',
      'set_overwrite',
      'set_overwrite',
      'add_member_role',
    ]);
    expect(operations[1]).toMatchObject({ target: { role: { key: 'team:1' } } });
    const after = apply(guild, known, operations);
    expect(reconcile(desired(), after.guild, after.known).operations).toEqual([]);
  });

  it('restores a permission removed by hand, and leaves an overwrite added by hand', () => {
    const { guild, known } = inSync();
    const channel = guild.channels.find((candidate) => candidate.name === 'w3-grd-rck');
    if (!channel) throw new Error('set up');
    const staff = channel.overwrites.find((overwrite) => overwrite.id === STAFF);
    if (!staff) throw new Error('set up');
    staff.allow = staff.allow.filter((permission) => permission !== 'send_messages');
    channel.overwrites.push({
      id: HAND_MADE_ROLE,
      type: 'role',
      allow: ['view_channel'],
      deny: [],
    });
    const { operations } = reconcile(desired(), guild, known);
    expect(operations).toEqual([
      {
        op: 'set_overwrite',
        kind: 'match_channel',
        key: 'match:7',
        channelId: channel.id,
        target: { role: { id: STAFF } },
        allow: [...TEAM],
        deny: [],
      },
    ]);
  });

  it('takes a channel from a team role of its own that no longer belongs there', () => {
    const { guild, known } = inSync();
    const changed = desired();
    const match = changed.channels[0];
    if (!match) throw new Error('set up');
    // RCK's slot went to another roster, which has no role here: it gets one, RCK loses access.
    changed.roles = [
      ...changed.roles,
      { key: 'team:3', name: 'AR33S', color: null, mentionable: true, members: [] },
    ];
    match.overwrites = match.overwrites.map((overwrite) =>
      'role' in overwrite.target &&
      'key' in overwrite.target.role &&
      overwrite.target.role.key === 'team:2'
        ? { ...overwrite, target: { role: { key: 'team:3' } } }
        : overwrite,
    );
    const rck = known.find((object) => object.kind === 'team_role' && object.key === 'team:2');
    const channel = guild.channels.find((candidate) => candidate.name === 'w3-grd-rck');
    const { operations } = reconcile(changed, guild, known);
    expect(ops(operations)).toEqual(['create_role', 'set_overwrite', 'remove_overwrite']);
    expect(operations[2]).toEqual({
      op: 'remove_overwrite',
      kind: 'match_channel',
      key: 'match:7',
      channelId: channel?.id,
      targetId: rck?.discordId,
    });
    const after = apply(guild, known, operations);
    expect(reconcile(changed, after.guild, after.known).operations).toEqual([]);
  });

  it('compares permissions as sets, whatever their order', () => {
    const { guild, known } = inSync();
    for (const channel of guild.channels)
      for (const overwrite of channel.overwrites) overwrite.allow.reverse();
    expect(reconcile(desired(), guild, known).operations).toEqual([]);
  });

  it('archives a week: moves the channel and takes Send Messages from the teams', () => {
    const { guild, known } = inSync();
    const archived = desired();
    archived.categories = [
      ...archived.categories,
      { kind: 'archive_category', key: 'season:4:1', name: 'Archives' },
    ];
    const match = archived.channels[0];
    if (!match) throw new Error('set up');
    match.parent = { kind: 'archive_category', key: 'season:4:1' };
    match.overwrites = match.overwrites.map((overwrite) =>
      'role' in overwrite.target && 'key' in overwrite.target.role
        ? { ...overwrite, allow: ['view_channel', 'read_message_history'], deny: ['send_messages'] }
        : overwrite,
    );
    // The week's category is empty once its channel moves: Ligo made it, so it goes.
    archived.categories = archived.categories.filter(
      (category) => category.kind !== 'week_category',
    );
    const { operations } = reconcile(archived, guild, known);
    expect(ops(operations)).toEqual([
      'create_category',
      'update_channel',
      'set_overwrite',
      'set_overwrite',
      'delete_category',
    ]);
    expect(operations[1]).toMatchObject({
      parent: { kind: 'archive_category', key: 'season:4:1' },
    });
    const after = apply(guild, known, operations);
    expect(reconcile(archived, after.guild, after.known).operations).toEqual([]);
  });

  it('gives a team role to who should hold it and takes it from who should not', () => {
    const { guild, known } = inSync();
    const changed = desired();
    const greed = changed.roles[0];
    if (!greed) throw new Error('set up');
    greed.members = [CAROL];
    const { operations } = reconcile(changed, guild, known);
    expect(operations).toEqual([
      { op: 'add_member_role', userId: CAROL, role: { key: 'team:1' } },
      { op: 'remove_member_role', userId: ALICE, role: { key: 'team:1' } },
    ]);
  });

  it('reports a member who is not on the server instead of trying to give them the role', () => {
    const changed = desired();
    const greed = changed.roles[0];
    if (!greed) throw new Error('set up');
    changed.roles = [
      { ...greed, members: [...greed.members, '700000000000000099'] },
      ...changed.roles.slice(1),
    ];
    const { operations, absentMembers } = reconcile(changed, emptyGuild(), []);
    expect(absentMembers).toEqual([{ roleKey: 'team:1', userId: '700000000000000099' }]);
    expect(
      operations.some((operation) => 'userId' in operation && operation.userId.endsWith('99')),
    ).toBe(false);
  });

  it('manages only the members of a linked role: no rename, no colour, never deleted', () => {
    const guild = emptyGuild();
    const known: KnownObject[] = [
      { kind: 'team_role', key: 'team:1', discordId: HAND_MADE_ROLE, createdByLigo: false },
    ];
    const state = desired();
    state.channels = [];
    state.categories = [];
    const { operations } = reconcile(state, guild, known);
    expect(operations.filter((operation) => operation.op === 'update_role')).toEqual([]);
    expect(operations).toContainEqual({
      op: 'add_member_role',
      userId: ALICE,
      role: { key: 'team:1' },
    });
    // Carol held the hand-made role; it is Greed's now, and she is not in Greed.
    expect(operations).toContainEqual({
      op: 'remove_member_role',
      userId: CAROL,
      role: { key: 'team:1' },
    });
    // Once no team needs it, Ligo forgets it and leaves it in the server.
    const none: DesiredState = { roles: [], categories: [], channels: [] };
    expect(reconcile(none, guild, known).operations).toEqual([
      { op: 'forget', kind: 'team_role', key: 'team:1' },
    ]);
  });

  it('keeps a channel of its own that is no longer wanted until it is released', () => {
    const { guild, known } = inSync();
    const state = desired();
    state.channels = state.channels.filter((channel) => channel.kind !== 'match_channel');
    state.categories = state.categories.filter((category) => category.kind !== 'week_category');
    // The match channel stays, and so does the category that holds it.
    expect(reconcile(state, guild, known).operations).toEqual([]);
  });

  it('deletes what it created and no longer needs, channels before categories before roles', () => {
    const { guild, known } = inSync();
    const none: DesiredState = {
      roles: [],
      categories: [],
      channels: [],
      release: [
        { kind: 'match_channel', key: 'match:7' },
        { kind: 'moss_channel', key: 'team:1' },
      ],
    };
    const { operations } = reconcile(none, guild, known);
    expect(ops(operations)).toEqual([
      'delete_channel',
      'delete_channel',
      'delete_category',
      'delete_category',
      'delete_role',
      'delete_role',
    ]);
    const after = apply(guild, known, operations);
    expect(after.guild.roles.map((role) => role.id)).toEqual([GUILD, STAFF, HAND_MADE_ROLE]);
    expect(after.known).toEqual([]);
  });

  it('keeps a category of its own that holds a channel made by hand', () => {
    const { guild, known } = inSync();
    const category = guild.categories.find((candidate) => candidate.name === 'L1 · Semaine 3');
    if (!category) throw new Error('set up');
    guild.channels.push({
      id: '800000000000000999',
      name: 'notes',
      parentId: category.id,
      overwrites: [],
    });
    const state = desired();
    state.channels = state.channels.filter((channel) => channel.kind !== 'match_channel');
    state.categories = state.categories.filter((candidate) => candidate.kind !== 'week_category');
    state.release = [{ kind: 'match_channel', key: 'match:7' }];
    const { operations } = reconcile(state, guild, known);
    expect(ops(operations)).toEqual(['delete_channel']);
  });

  it('forgets what was deleted by hand and is no longer needed', () => {
    const { guild, known } = inSync();
    guild.channels = guild.channels.filter((channel) => channel.name !== 'moss-grd');
    const state = desired();
    state.channels = state.channels.filter((channel) => channel.kind !== 'moss_channel');
    expect(reconcile(state, guild, known).operations).toEqual([
      { op: 'forget', kind: 'moss_channel', key: 'team:1' },
    ]);
  });

  it('never touches a role, channel or category it does not know, even with a matching name', () => {
    const guild = emptyGuild();
    guild.roles.push({
      id: '800000000000000777',
      name: 'Greed Esport',
      color: null,
      mentionable: false,
    });
    guild.categories.push({ id: '800000000000000778', name: 'L1 · Semaine 3' });
    guild.channels.push({
      id: '800000000000000779',
      name: 'w3-grd-rck',
      parentId: '800000000000000778',
      overwrites: [],
    });
    const { operations } = reconcile(desired(), guild, []);
    const touched = new Set(
      operations.flatMap((operation) => ('id' in operation ? [operation.id] : [])),
    );
    expect(touched.size).toBe(0);
    expect(ops(operations).filter((op) => op.startsWith('create'))).toHaveLength(6);
  });

  it('puts any damage right in one pass', () => {
    const damage = fc.record({
      deleteRoles: fc.subarray(['team:1', 'team:2']),
      deleteChannels: fc.subarray(['match:7', 'team:1']),
      renameChannels: fc.boolean(),
      stripPermissions: fc.boolean(),
      dropMembers: fc.boolean(),
    });
    fc.assert(
      fc.property(damage, (hurt) => {
        const { guild, known } = inSync();
        const idOf = (kind: string, key: string) =>
          known.find((object) => object.kind === kind && object.key === key)?.discordId;
        const roleIds = hurt.deleteRoles.map((key) => idOf('team_role', key));
        guild.roles = guild.roles.filter((role) => !roleIds.includes(role.id));
        for (const member of guild.members) {
          member.roleIds = member.roleIds.filter((id) => !roleIds.includes(id));
          if (hurt.dropMembers) member.roleIds = [];
        }
        const channelIds = [
          idOf('match_channel', hurt.deleteChannels[0] ?? ''),
          hurt.deleteChannels.includes('team:1') ? idOf('moss_channel', 'team:1') : undefined,
        ];
        guild.channels = guild.channels.filter((channel) => !channelIds.includes(channel.id));
        for (const channel of guild.channels) {
          if (hurt.renameChannels) channel.name = 'oops';
          if (hurt.stripPermissions) channel.overwrites = [];
        }
        const after = apply(guild, known, reconcile(desired(), guild, known).operations);
        expect(reconcile(desired(), after.guild, after.known).operations).toEqual([]);
      }),
    );
  });
});
