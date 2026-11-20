// The reconciler's diff (design doc section 6, "Reconciler"; M-46). Pure: the server's adapter
// reads the guild into a snapshot, and applies the operations in order, storing the ID of each
// object it creates so later operations can refer to it by its key.

/** The channel permissions Ligo sets; any other bit of an overwrite is not compared. */
export const CHANNEL_PERMISSIONS = [
  'view_channel',
  'send_messages',
  'read_message_history',
  'attach_files',
  'embed_links',
  'add_reactions',
  'pin_messages',
] as const;
export type ChannelPermission = (typeof CHANNEL_PERMISSIONS)[number];

export const CATEGORY_KINDS = ['week_category', 'archive_category', 'moss_category'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];
export const CHANNEL_KINDS = ['match_channel', 'moss_channel'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
/** `discord_object.kind`. */
export const OBJECT_KINDS = ['team_role', ...CATEGORY_KINDS, ...CHANNEL_KINDS] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

/** A role by the key of a team role Ligo manages, or by its ID (@everyone, staff roles). */
export type RoleRef = { key: string } | { id: string };
export type OverwriteTarget = { role: RoleRef } | { member: string };

export interface DesiredOverwrite {
  target: OverwriteTarget;
  allow: readonly ChannelPermission[];
  deny: readonly ChannelPermission[];
}
export interface DesiredRole {
  key: string;
  name: string;
  /** 0xRRGGBB, or null for Discord's default. */
  color: number | null;
  mentionable: boolean;
  /** Discord user IDs of who should hold it. */
  members: readonly string[];
}
export interface DesiredCategory {
  kind: CategoryKind;
  key: string;
  name: string;
}
export interface DesiredChannel {
  kind: ChannelKind;
  key: string;
  name: string;
  parent: { kind: CategoryKind; key: string };
  overwrites: readonly DesiredOverwrite[];
}
export interface DesiredState {
  roles: readonly DesiredRole[];
  categories: readonly DesiredCategory[];
  channels: readonly DesiredChannel[];
  /**
   * Channels Ligo may delete once no longer wanted: their transcript is saved (season end).
   * Any other channel Ligo made stays when it is no longer wanted, so a mistake in the desired
   * state can never erase a conversation.
   */
  release?: readonly { kind: ChannelKind; key: string }[];
}

/** A row of `discord_object`: what Ligo created, or a role staff linked (`createdByLigo` false). */
export interface KnownObject {
  kind: ObjectKind;
  key: string;
  discordId: string;
  createdByLigo: boolean;
}

export interface ActualOverwrite {
  id: string;
  type: 'role' | 'member';
  allow: string[];
  deny: string[];
}
export interface GuildSnapshot {
  /** The guild's ID, which is also its @everyone role's. */
  everyoneId: string;
  roles: { id: string; name: string; color: number | null; mentionable: boolean }[];
  categories: { id: string; name: string }[];
  channels: { id: string; name: string; parentId: string | null; overwrites: ActualOverwrite[] }[];
  members: { id: string; roleIds: string[] }[];
}

type ParentRef = { kind: CategoryKind; key: string };
export type Operation =
  | { op: 'create_role'; key: string; name: string; color: number | null; mentionable: boolean }
  | {
      op: 'update_role';
      key: string;
      id: string;
      changes: { name?: string; color?: number | null; mentionable?: boolean };
    }
  | { op: 'create_category'; kind: CategoryKind; key: string; name: string }
  | { op: 'rename_category'; kind: CategoryKind; key: string; id: string; name: string }
  | {
      op: 'create_channel';
      kind: ChannelKind;
      key: string;
      name: string;
      parent: ParentRef;
      overwrites: readonly DesiredOverwrite[];
    }
  | {
      op: 'update_channel';
      kind: ChannelKind;
      key: string;
      id: string;
      name?: string;
      parent?: ParentRef;
    }
  | {
      op: 'set_overwrite';
      kind: ChannelKind;
      key: string;
      channelId: string;
      target: OverwriteTarget;
      allow: readonly ChannelPermission[];
      deny: readonly ChannelPermission[];
    }
  | { op: 'remove_overwrite'; kind: ChannelKind; key: string; channelId: string; targetId: string }
  | { op: 'add_member_role'; userId: string; role: RoleRef }
  | { op: 'remove_member_role'; userId: string; role: RoleRef }
  | { op: 'delete_channel'; kind: ChannelKind; key: string; id: string }
  | { op: 'delete_category'; kind: CategoryKind; key: string; id: string }
  | { op: 'delete_role'; key: string; id: string }
  | { op: 'forget'; kind: ObjectKind; key: string };

export interface ReconcileResult {
  operations: Operation[];
  /** Holders a team role should have who are not on the server: nothing can be given to them. */
  absentMembers: { roleKey: string; userId: string }[];
}

const sameSet = (actual: readonly string[], wanted: readonly string[]) => {
  const known = new Set<string>(CHANNEL_PERMISSIONS);
  const kept = new Set(actual.filter((permission) => known.has(permission)));
  return kept.size === new Set(wanted).size && wanted.every((permission) => kept.has(permission));
};

/**
 * What to do so the guild holds the desired state. Ligo finds its objects by stored ID only: an
 * object whose ID is gone is created again, and nothing it does not know is ever changed, even
 * with the same name. A role or category it created and no longer needs is deleted (a category
 * only once nothing else is left inside); a channel only when `release` lists it; a linked role
 * is only forgotten.
 */
export function reconcile(
  desired: DesiredState,
  guild: GuildSnapshot,
  known: readonly KnownObject[],
): ReconcileResult {
  const stored = (kind: ObjectKind, key: string) =>
    known.find((object) => object.kind === kind && object.key === key);
  const roles = new Map(guild.roles.map((role) => [role.id, role]));
  const categories = new Map(guild.categories.map((category) => [category.id, category]));
  const channels = new Map(guild.channels.map((channel) => [channel.id, channel]));
  // The object's current ID when it still exists in the guild; undefined when it must be made.
  const existing = (kind: ObjectKind, key: string, pool: Map<string, unknown>) => {
    const object = stored(kind, key);
    return object && pool.has(object.discordId) ? object : undefined;
  };

  const roleOps: Operation[] = [];
  const categoryOps: Operation[] = [];
  const channelOps: Operation[] = [];
  const overwriteOps: Operation[] = [];
  const addOps: Operation[] = [];
  const removeOps: Operation[] = [];
  const absentMembers: ReconcileResult['absentMembers'] = [];

  // A team role's ID now, or undefined when it is created in this pass.
  const liveRoleId = new Map<string, string | undefined>();
  for (const role of desired.roles) {
    const object = existing('team_role', role.key, roles);
    liveRoleId.set(role.key, object?.discordId);
    if (!object) {
      roleOps.push({ op: 'create_role', ...pick(role) });
      continue;
    }
    const actual = roles.get(object.discordId);
    if (!actual || !object.createdByLigo) continue;
    const changes: Extract<Operation, { op: 'update_role' }>['changes'] = {};
    if (actual.name !== role.name) changes.name = role.name;
    if (actual.color !== role.color) changes.color = role.color;
    if (actual.mentionable !== role.mentionable) changes.mentionable = role.mentionable;
    if (Object.keys(changes).length > 0)
      roleOps.push({ op: 'update_role', key: role.key, id: object.discordId, changes });
  }

  const membersInGuild = new Map(guild.members.map((member) => [member.id, member]));
  for (const role of desired.roles) {
    const id = liveRoleId.get(role.key);
    const wanted = new Set(role.members);
    for (const userId of wanted) {
      const member = membersInGuild.get(userId);
      if (!member) absentMembers.push({ roleKey: role.key, userId });
      else if (id === undefined || !member.roleIds.includes(id))
        addOps.push({ op: 'add_member_role', userId, role: { key: role.key } });
    }
    if (id === undefined) continue;
    for (const member of guild.members)
      if (member.roleIds.includes(id) && !wanted.has(member.id))
        removeOps.push({ op: 'remove_member_role', userId: member.id, role: { key: role.key } });
  }

  const liveCategoryId = new Map<string, string | undefined>();
  const identity = (kind: string, key: string) => `${kind}\u0000${key}`;
  for (const category of desired.categories) {
    const object = existing(category.kind, category.key, categories);
    liveCategoryId.set(identity(category.kind, category.key), object?.discordId);
    if (!object) {
      categoryOps.push({ op: 'create_category', ...category });
      continue;
    }
    if (categories.get(object.discordId)?.name !== category.name)
      categoryOps.push({ op: 'rename_category', ...category, id: object.discordId });
  }

  // The IDs of every team role Ligo holds: an overwrite for one of them is Ligo's to remove.
  const ownRoleIds = new Set(
    known.filter((object) => object.kind === 'team_role').map((object) => object.discordId),
  );
  // Channels Ligo keeps but moves to another category, to know which categories empty out.
  const moving = new Set<string>();
  for (const channel of desired.channels) {
    const object = existing(channel.kind, channel.key, channels);
    if (!object) {
      channelOps.push({ op: 'create_channel', ...channel });
      continue;
    }
    const actual = channels.get(object.discordId);
    if (!actual) continue;
    const parentId = liveCategoryId.get(identity(channel.parent.kind, channel.parent.key));
    const update: Extract<Operation, { op: 'update_channel' }> = {
      op: 'update_channel',
      kind: channel.kind,
      key: channel.key,
      id: object.discordId,
    };
    if (actual.name !== channel.name) update.name = channel.name;
    if (parentId === undefined || actual.parentId !== parentId) update.parent = channel.parent;
    if (update.name !== undefined || update.parent) channelOps.push(update);
    if (update.parent) moving.add(object.discordId);

    const targetIds = new Set<string>();
    for (const overwrite of channel.overwrites) {
      const targetId =
        'member' in overwrite.target
          ? overwrite.target.member
          : 'id' in overwrite.target.role
            ? overwrite.target.role.id
            : liveRoleId.get(overwrite.target.role.key);
      if (targetId !== undefined) targetIds.add(targetId);
      const current =
        targetId === undefined ? undefined : actual.overwrites.find((o) => o.id === targetId);
      if (
        current &&
        sameSet(current.allow, overwrite.allow) &&
        sameSet(current.deny, overwrite.deny)
      )
        continue;
      overwriteOps.push({
        op: 'set_overwrite',
        kind: channel.kind,
        key: channel.key,
        channelId: object.discordId,
        target: overwrite.target,
        allow: overwrite.allow,
        deny: overwrite.deny,
      });
    }
    // A team role of Ligo's that no longer belongs here loses its access (a slot handed over);
    // overwrites made by hand for anything else stay.
    for (const overwrite of actual.overwrites)
      if (overwrite.type === 'role' && ownRoleIds.has(overwrite.id) && !targetIds.has(overwrite.id))
        overwriteOps.push({
          op: 'remove_overwrite',
          kind: channel.kind,
          key: channel.key,
          channelId: object.discordId,
          targetId: overwrite.id,
        });
  }

  // What Ligo knows and no longer needs.
  const wanted = new Set([
    ...desired.roles.map((role) => identity('team_role', role.key)),
    ...desired.categories.map((category) => identity(category.kind, category.key)),
    ...desired.channels.map((channel) => identity(channel.kind, channel.key)),
  ]);
  const unneeded = known.filter((object) => !wanted.has(identity(object.kind, object.key)));
  const deleteChannels: Operation[] = [];
  const deleteCategories: Operation[] = [];
  const deleteRoles: Operation[] = [];
  const forgets: Operation[] = [];
  const leaving = new Set<string>();
  const released = new Set(
    (desired.release ?? []).map((channel) => identity(channel.kind, channel.key)),
  );
  for (const object of unneeded) {
    const kind = object.kind;
    if (!isChannelKind(kind)) continue;
    if (!channels.has(object.discordId)) forgets.push({ op: 'forget', kind, key: object.key });
    else if (!object.createdByLigo) forgets.push({ op: 'forget', kind, key: object.key });
    else if (released.has(identity(kind, object.key))) {
      deleteChannels.push({ op: 'delete_channel', kind, key: object.key, id: object.discordId });
      leaving.add(object.discordId);
    }
  }
  for (const object of unneeded) {
    const kind = object.kind;
    if (!isCategoryKind(kind)) continue;
    if (!categories.has(object.discordId)) {
      forgets.push({ op: 'forget', kind, key: object.key });
      continue;
    }
    if (!object.createdByLigo) {
      forgets.push({ op: 'forget', kind, key: object.key });
      continue;
    }
    // Emptied once Ligo's own channels have moved out or gone; anything else inside keeps it.
    const left = guild.channels.filter(
      (channel) =>
        channel.parentId === object.discordId &&
        !leaving.has(channel.id) &&
        !moving.has(channel.id),
    );
    if (left.length === 0)
      deleteCategories.push({ op: 'delete_category', kind, key: object.key, id: object.discordId });
  }
  for (const object of unneeded) {
    if (object.kind !== 'team_role') continue;
    if (roles.has(object.discordId) && object.createdByLigo)
      deleteRoles.push({ op: 'delete_role', key: object.key, id: object.discordId });
    else forgets.push({ op: 'forget', kind: object.kind, key: object.key });
  }

  return {
    operations: [
      ...roleOps,
      ...categoryOps,
      ...channelOps,
      ...overwriteOps,
      ...addOps,
      ...removeOps,
      ...deleteChannels,
      ...deleteCategories,
      ...deleteRoles,
      ...forgets,
    ],
    absentMembers,
  };
}

const pick = (role: DesiredRole) => ({
  key: role.key,
  name: role.name,
  color: role.color,
  mentionable: role.mentionable,
});
const isChannelKind = (kind: ObjectKind): kind is ChannelKind =>
  (CHANNEL_KINDS as readonly string[]).includes(kind);
const isCategoryKind = (kind: ObjectKind): kind is CategoryKind =>
  (CATEGORY_KINDS as readonly string[]).includes(kind);
