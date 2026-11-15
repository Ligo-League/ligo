import { DiscordAPIError, PermissionFlagsBits, type Client } from 'discord.js';
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

export function createDiscordGateway(client: Client): DiscordGateway {
  const sendable = async (channelId: string) => {
    const channel = await client.channels.fetch(channelId);
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
      const user = await client.users.fetch(userId);
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
      const guild = await client.guilds.fetch(guildId);
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
      for (const guild of client.guilds.cache.values()) {
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
        const guild = await client.guilds.fetch(guildId);
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

    async findMember(guildId, username) {
      const wanted = username.trim().toLowerCase();
      if (wanted === '') return null;
      const guild = await client.guilds.fetch(guildId);
      // Discord matches names starting with the query; only the exact username is taken.
      const found = await guild.members.search({ query: wanted, limit: MEMBER_SEARCH_LIMIT });
      const member = [...found.values()].find((one) => one.user.username.toLowerCase() === wanted);
      return member ? { id: member.id, displayName: member.displayName } : null;
    },

    async resolveInvite(url) {
      try {
        const invite = await client.fetchInvite(url);
        return invite.guild
          ? { guildId: invite.guild.id, expiresAt: invite.expiresTimestamp }
          : null;
      } catch (error) {
        if (isDiscordError(error, UNKNOWN_INVITE)) return null;
        throw error;
      }
    },
  };
}
