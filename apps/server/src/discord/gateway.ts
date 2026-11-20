import type { ChannelPermission, GuildSnapshot } from '@ligo/core';
import {
  ChannelType,
  DiscordAPIError,
  OverwriteType,
  PermissionFlagsBits,
  type CategoryChannel,
  type Client,
  type PermissionOverwriteOptions,
  type TextChannel,
} from 'discord.js';
import { isDiscordAttachmentUrl } from '../services/attachments.ts';
import type { OutgoingMessage } from './commands/types.ts';
import { toDiscordMessage } from './outgoing.ts';

/**
 * What the bot does outside the reply to an interaction. Services and commands use this
 * interface, so tests run on an in-memory fake and never reach Discord.
 */
export interface DiscordGateway {
  /** Posts in a channel found by its stored ID. */
  postMessage(
    channelId: string,
    message: OutgoingMessage,
  ): Promise<{ messageId: string; url: string }>;
  editMessage(channelId: string, messageId: string, message: OutgoingMessage): Promise<void>;
  /** Sends a direct message. Rejects when the member closed them or left every shared server. */
  sendDirectMessage(userId: string, message: OutgoingMessage): Promise<void>;
  /** Downloads a file attached to a command. Rejects other hosts and files over `maxBytes`. */
  downloadAttachment(url: string, maxBytes: number): Promise<Uint8Array>;
  /**
   * The role IDs a user holds in a server, read from Discord; null when they are not a member.
   * The website checks the staff role with it (design doc section 7). Rejects when Discord is
   * unreachable or the bot is not connected yet.
   */
  memberRoleIds(guildId: string, userId: string): Promise<string[] | null>;
  /**
   * The servers the bot is in where a user may manage the server: its owner, or a member with
   * Manage Server (Administrator included). Rights to a league's Discord settings come from
   * there (maintainer, 15 November 2026). Rejects when Discord is unreachable.
   */
  manageableGuilds(userId: string): Promise<{ id: string; name: string }[]>;
  /**
   * The roles of a server the bot is in that a league may use as its staff role: neither
   * @everyone nor a role an integration manages. Null when the bot is not in the server.
   */
  guildRoles(guildId: string): Promise<{ id: string; name: string }[] | null>;
  /**
   * The text channels of a server the bot is in, in the order Discord lists them, with their
   * category's name. Null when the bot is not in the server. The website offers them as the
   * league's channels, and a channel ID typed by hand is checked against them.
   */
  guildTextChannels(guildId: string): Promise<GuildTextChannel[] | null>;
  /** Where an invitation leads, and when it expires; null for one Discord does not know. */
  resolveInvite(url: string): Promise<{ guildId: string; expiresAt: number | null } | null>;
  /**
   * The member of a server whose Discord username is exactly `username`, ignoring case; null
   * when nobody is. The website names a team's official this way, as `/team` does with Discord's
   * user picker. Rejects when Discord is unreachable.
   */
  findMember(
    guildId: string,
    username: string,
  ): Promise<{ id: string; displayName: string } | null>;
  /**
   * What the reconciler compares (design doc section 6): the server's roles, categories, text
   * channels with their permission overwrites, and members with their roles. Null when the bot
   * is not in the server. Rejects when Discord is unreachable.
   */
  guildSnapshot(guildId: string): Promise<GuildSnapshot | null>;
  /**
   * Makes one change the reconciler decided, with `reason` in the server's audit log. Returns
   * the ID of what it created, null otherwise. Rejects when Discord refuses (a missing
   * permission, a role above the bot's) or is unreachable.
   */
  changeGuild(guildId: string, change: GuildChange, reason: string): Promise<string | null>;
}

/** One change to a server, every object named by its Discord ID. */
export type GuildChange =
  | { kind: 'create_role'; name: string; color: number | null; mentionable: boolean }
  | {
      kind: 'edit_role';
      roleId: string;
      name?: string;
      color?: number | null;
      mentionable?: boolean;
    }
  | { kind: 'create_category'; name: string }
  | {
      kind: 'create_text_channel';
      name: string;
      parentId: string;
      overwrites: ResolvedOverwrite[];
    }
  /** A category or a text channel: a new name, and for a text channel a new category. */
  | { kind: 'edit_channel'; channelId: string; name?: string; parentId?: string }
  | ({ kind: 'set_overwrite'; channelId: string } & ResolvedOverwrite)
  | { kind: 'remove_overwrite'; channelId: string; targetId: string }
  | { kind: 'add_member_role'; userId: string; roleId: string }
  | { kind: 'remove_member_role'; userId: string; roleId: string }
  /** A category or a text channel. */
  | { kind: 'delete_channel'; channelId: string }
  | { kind: 'delete_role'; roleId: string };

export interface ResolvedOverwrite {
  targetId: string;
  targetType: 'role' | 'member';
  allow: readonly ChannelPermission[];
  deny: readonly ChannelPermission[];
}

export interface GuildTextChannel {
  id: string;
  name: string;
  /** The category it sits in, if any. */
  category: string | null;
}

// Enough to find one exact username among the names that start with it.
const MEMBER_SEARCH_LIMIT = 25;

// Discord's error codes for a user who is not a member, a server the bot is not in, and an
// invitation that does not exist.
const UNKNOWN_MEMBER = 10007;
const UNKNOWN_GUILD = 10004;
const UNKNOWN_INVITE = 10006;
const isDiscordError = (error: unknown, ...codes: number[]) =>
  error instanceof DiscordAPIError && typeof error.code === 'number' && codes.includes(error.code);

const DOWNLOAD_TIMEOUT_MS = 10_000;

/** Ligo's permission names and Discord's flags (`@ligo/core` CHANNEL_PERMISSIONS). */
const PERMISSION_FLAGS = {
  view_channel: 'ViewChannel',
  send_messages: 'SendMessages',
  read_message_history: 'ReadMessageHistory',
  attach_files: 'AttachFiles',
  embed_links: 'EmbedLinks',
  add_reactions: 'AddReactions',
  pin_messages: 'PinMessages',
} as const satisfies Record<ChannelPermission, keyof typeof PermissionFlagsBits>;
const PERMISSIONS = Object.entries(PERMISSION_FLAGS) as [
  ChannelPermission,
  (typeof PERMISSION_FLAGS)[ChannelPermission],
][];
const flagsOf = (names: readonly ChannelPermission[]) =>
  names.map((name) => PermissionFlagsBits[PERMISSION_FLAGS[name]]);
/** The whole overwrite: what it allows, what it denies, and every other flag Ligo sets unset. */
const overwriteOptions = (
  allow: readonly ChannelPermission[],
  deny: readonly ChannelPermission[],
) =>
  Object.fromEntries(
    PERMISSIONS.map(([name, flag]) => [
      flag,
      allow.includes(name) ? true : deny.includes(name) ? false : null,
    ]),
  ) as PermissionOverwriteOptions;
const overwriteType = (type: 'role' | 'member') =>
  type === 'role' ? OverwriteType.Role : OverwriteType.Member;

/** Reads a stream to the end, giving up as soon as it holds more than `maxBytes`. */
export async function readCapped(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Attachment is larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

/**
 * Discord as the services see it. `current` gives the connected client at each call: the server
 * replaces the client when a login fails and is tried again (`keepConnecting`).
 */
export function createDiscordGateway(current: () => Client): DiscordGateway {
  const sendable = async (channelId: string) => {
    const channel = await current().channels.fetch(channelId);
    if (!channel?.isSendable()) throw new Error(`Channel ${channelId} cannot receive messages`);
    return channel;
  };

  return {
    async postMessage(channelId, message) {
      const channel = await sendable(channelId);
      const posted = await channel.send(toDiscordMessage(message));
      return { messageId: posted.id, url: posted.url };
    },

    async editMessage(channelId, messageId, message) {
      const channel = await sendable(channelId);
      await channel.messages.edit(messageId, toDiscordMessage(message));
    },

    async sendDirectMessage(userId, message) {
      const user = await current().users.fetch(userId);
      await user.send(toDiscordMessage(message));
    },

    async downloadAttachment(url, maxBytes) {
      // Error messages never repeat the address: it is a signed link.
      if (!isDiscordAttachmentUrl(url)) throw new Error('Not a Discord attachment address');
      const response = await fetch(url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        redirect: 'error',
      });
      if (!response.ok || !response.body) {
        throw new Error(`Discord answered ${response.status} for an attachment`);
      }
      return readCapped(response.body, maxBytes);
    },

    async memberRoleIds(guildId, userId) {
      const guild = await current().guilds.fetch(guildId);
      try {
        const member = await guild.members.fetch(userId);
        return [...member.roles.cache.keys()];
      } catch (error) {
        if (error instanceof DiscordAPIError && error.code === UNKNOWN_MEMBER) return null;
        throw error;
      }
    },

    async manageableGuilds(userId) {
      const found: { id: string; name: string }[] = [];
      for (const guild of current().guilds.cache.values()) {
        try {
          const member = await guild.members.fetch(userId);
          if (guild.ownerId === userId || member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            found.push({ id: guild.id, name: guild.name });
          }
        } catch (error) {
          if (!isDiscordError(error, UNKNOWN_MEMBER)) throw error;
        }
      }
      return found.sort((x, y) => x.name.localeCompare(y.name));
    },

    async guildRoles(guildId) {
      try {
        const guild = await current().guilds.fetch(guildId);
        const roles = await guild.roles.fetch();
        return [...roles.values()]
          .filter((role) => role.id !== guild.id && !role.managed)
          .sort((x, y) => y.position - x.position)
          .map((role) => ({ id: role.id, name: role.name }));
      } catch (error) {
        if (isDiscordError(error, UNKNOWN_GUILD)) return null;
        throw error;
      }
    },

    async guildTextChannels(guildId) {
      try {
        const guild = await current().guilds.fetch(guildId);
        const channels = await guild.channels.fetch();
        const position = (id: string | null) =>
          id === null ? -1 : (channels.get(id)?.rawPosition ?? -1);
        return [...channels.values()]
          .filter((channel): channel is TextChannel => channel?.type === ChannelType.GuildText)
          .sort(
            (x, y) => position(x.parentId) - position(y.parentId) || x.rawPosition - y.rawPosition,
          )
          .map((channel) => ({
            id: channel.id,
            name: channel.name,
            category: channel.parent?.name ?? null,
          }));
      } catch (error) {
        if (isDiscordError(error, UNKNOWN_GUILD)) return null;
        throw error;
      }
    },

    async findMember(guildId, username) {
      const wanted = username.trim().toLowerCase();
      if (wanted === '') return null;
      const guild = await current().guilds.fetch(guildId);
      // Discord matches names starting with the query; only the exact username is taken.
      const found = await guild.members.search({ query: wanted, limit: MEMBER_SEARCH_LIMIT });
      const member = [...found.values()].find((one) => one.user.username.toLowerCase() === wanted);
      return member ? { id: member.id, displayName: member.displayName } : null;
    },

    async resolveInvite(url) {
      try {
        const invite = await current().fetchInvite(url);
        return invite.guild
          ? { guildId: invite.guild.id, expiresAt: invite.expiresTimestamp }
          : null;
      } catch (error) {
        if (isDiscordError(error, UNKNOWN_INVITE)) return null;
        throw error;
      }
    },

    async guildSnapshot(guildId) {
      let guild;
      try {
        guild = await current().guilds.fetch(guildId);
      } catch (error) {
        if (isDiscordError(error, UNKNOWN_GUILD)) return null;
        throw error;
      }
      const [roles, channels, members] = await Promise.all([
        guild.roles.fetch(),
        guild.channels.fetch(),
        guild.members.fetch(),
      ]);
      const listed = [...channels.values()].filter((channel) => channel !== null);
      return {
        everyoneId: guild.id,
        roles: [...roles.values()].map((role) => ({
          id: role.id,
          name: role.name,
          color: role.colors.primaryColor === 0 ? null : role.colors.primaryColor,
          mentionable: role.mentionable,
        })),
        categories: listed
          .filter(
            (channel): channel is CategoryChannel => channel.type === ChannelType.GuildCategory,
          )
          .map((channel) => ({ id: channel.id, name: channel.name })),
        channels: listed
          .filter((channel): channel is TextChannel => channel.type === ChannelType.GuildText)
          .map((channel) => ({
            id: channel.id,
            name: channel.name,
            parentId: channel.parentId,
            overwrites: [...channel.permissionOverwrites.cache.values()].map((overwrite) => ({
              id: overwrite.id,
              type: overwrite.type === OverwriteType.Role ? ('role' as const) : ('member' as const),
              allow: PERMISSIONS.filter(([, flag]) =>
                overwrite.allow.has(PermissionFlagsBits[flag]),
              ).map(([name]) => name),
              deny: PERMISSIONS.filter(([, flag]) =>
                overwrite.deny.has(PermissionFlagsBits[flag]),
              ).map(([name]) => name),
            })),
          })),
        members: [...members.values()].map((member) => ({
          id: member.id,
          // Every member holds @everyone, whose ID is the server's.
          roleIds: [...member.roles.cache.keys()].filter((id) => id !== guild.id),
        })),
      };
    },

    async changeGuild(guildId, change, reason) {
      const guild = await current().guilds.fetch(guildId);
      const channel = async (id: string) => {
        const found = await guild.channels.fetch(id);
        if (!found) throw new Error(`Channel ${id} is gone`);
        return found;
      };
      switch (change.kind) {
        case 'create_role': {
          const role = await guild.roles.create({
            name: change.name,
            colors: { primaryColor: change.color ?? 0 },
            mentionable: change.mentionable,
            reason,
          });
          return role.id;
        }
        case 'edit_role': {
          await guild.roles.edit(change.roleId, {
            ...(change.name === undefined ? {} : { name: change.name }),
            ...(change.color === undefined ? {} : { colors: { primaryColor: change.color ?? 0 } }),
            ...(change.mentionable === undefined ? {} : { mentionable: change.mentionable }),
            reason,
          });
          return null;
        }
        case 'create_category': {
          const created = await guild.channels.create({
            name: change.name,
            type: ChannelType.GuildCategory,
            reason,
          });
          return created.id;
        }
        case 'create_text_channel': {
          const created = await guild.channels.create({
            name: change.name,
            type: ChannelType.GuildText,
            parent: change.parentId,
            permissionOverwrites: change.overwrites.map((overwrite) => ({
              id: overwrite.targetId,
              type: overwriteType(overwrite.targetType),
              allow: flagsOf(overwrite.allow),
              deny: flagsOf(overwrite.deny),
            })),
            reason,
          });
          return created.id;
        }
        case 'edit_channel': {
          const found = await channel(change.channelId);
          if (found.type === ChannelType.GuildCategory) {
            if (change.name !== undefined) await found.setName(change.name, reason);
          } else if (found.type === ChannelType.GuildText) {
            await found.edit({
              ...(change.name === undefined ? {} : { name: change.name }),
              // Moving keeps the channel's own overwrites: they are what Ligo manages.
              ...(change.parentId === undefined
                ? {}
                : { parent: change.parentId, lockPermissions: false }),
              reason,
            });
          }
          return null;
        }
        case 'set_overwrite': {
          const found = await channel(change.channelId);
          if (found.type !== ChannelType.GuildText) throw new Error('Not a text channel');
          // `create` replaces the whole overwrite of that role or member.
          await found.permissionOverwrites.create(
            change.targetId,
            overwriteOptions(change.allow, change.deny),
            { type: overwriteType(change.targetType), reason },
          );
          return null;
        }
        case 'remove_overwrite': {
          const found = await channel(change.channelId);
          if (found.type !== ChannelType.GuildText) throw new Error('Not a text channel');
          await found.permissionOverwrites.delete(change.targetId, reason);
          return null;
        }
        case 'add_member_role':
          await guild.members.addRole({ user: change.userId, role: change.roleId, reason });
          return null;
        case 'remove_member_role':
          await guild.members.removeRole({ user: change.userId, role: change.roleId, reason });
          return null;
        case 'delete_channel':
          await (await channel(change.channelId)).delete(reason);
          return null;
        case 'delete_role':
          await guild.roles.delete(change.roleId, reason);
          return null;
      }
    },
  };
}
