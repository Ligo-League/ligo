import { openTestDatabase } from '@ligo/db/testing';
import type { GuildSnapshot } from '@ligo/core';
import type {
  AutocompleteChoice,
  AutocompleteInteraction,
  ButtonInteraction,
  CommandAttachment,
  CommandContext,
  CommandInteraction,
  Form,
  FormSubmitInteraction,
  OutgoingMessage,
  ReplyMessage,
} from './commands/types.ts';
import { fakeEvidenceStore } from '../assets/evidence-store.ts';
import { fakeAssetStore, PNG_HEADER_FOR_TESTS } from '../assets/store.ts';
import type { DiscordGateway, GuildChange, GuildTextChannel } from './gateway.ts';

type OptionValue =
  | string
  | number
  | boolean
  | CommandAttachment
  | { user: { id: string; displayName: string } }
  | { channel: { id: string } };

export interface FakeInput {
  guildId?: string | null;
  user?: { id: string; displayName: string };
  memberRoleIds?: readonly string[];
  subcommand?: string;
  subcommandGroup?: string;
  options?: Record<string, OptionValue>;
  /** Where the command is used; a test channel unless set. */
  channelId?: string | null;
}

/** The channel a fake command is used in. */
export const FAKE_CHANNEL = '800000000000000099';

const actorOf = (input: FakeInput) => ({
  guildId: input.guildId ?? null,
  user: input.user ?? { id: '555555555555555555', displayName: 'Member' },
  memberRoleIds: input.memberRoleIds ?? [],
});

/** The message ID of a fake command's public reply. */
export const FAKE_REPLY_MESSAGE = '910000000000000001';

export interface FakeInteraction extends CommandInteraction {
  replies: ReplyMessage[];
  /** True once `defer` has been called. */
  deferred: boolean;
  /** True when it was deferred to answer the member alone. */
  deferredEphemeral: boolean;
}

/** An in-memory stand-in for a Discord slash-command interaction. */
export function fakeInteraction(commandName: string, input: FakeInput = {}): FakeInteraction {
  const replies: ReplyMessage[] = [];
  const option = (name: string) => input.options?.[name];
  return {
    ...actorOf(input),
    channelId: input.channelId === undefined ? FAKE_CHANNEL : input.channelId,
    commandName,
    options: {
      getSubcommand: () => input.subcommand ?? null,
      getSubcommandGroup: () => input.subcommandGroup ?? null,
      getString: (name) => {
        const value = option(name);
        return typeof value === 'string' ? value : null;
      },
      getInteger: (name) => {
        const value = option(name);
        return typeof value === 'number' ? value : null;
      },
      getBoolean: (name) => {
        const value = option(name);
        return typeof value === 'boolean' ? value : null;
      },
      getAttachment: (name) => {
        const value = option(name);
        return typeof value === 'object' && 'url' in value ? value : null;
      },
      getUser: (name) => {
        const value = option(name);
        return typeof value === 'object' && 'user' in value ? value.user : null;
      },
      getChannel: (name) => {
        const value = option(name);
        return typeof value === 'object' && 'channel' in value ? value.channel : null;
      },
    },
    replies,
    deferred: false,
    deferredEphemeral: false,
    get answered() {
      return replies.length > 0;
    },
    defer(options) {
      // Discord refuses to defer twice, or after a reply.
      if (this.deferred || replies.length > 0) {
        return Promise.reject(new Error('Interaction already acknowledged'));
      }
      this.deferred = true;
      this.deferredEphemeral = options?.ephemeral === true;
      return Promise.resolve();
    },
    reply(message) {
      // Discord refuses a second reply to the same interaction.
      if (replies.length > 0) return Promise.reject(new Error('Interaction already answered'));
      replies.push(message);
      return Promise.resolve(message.ephemeral ? null : { messageId: FAKE_REPLY_MESSAGE });
    },
  };
}

export interface FakeButton extends ButtonInteraction {
  replies: ReplyMessage[];
  /** What the message carrying the button was replaced with, if it was. */
  updates: OutgoingMessage[];
  /** The forms the click opened. */
  forms: Form[];
}

/** An in-memory stand-in for a click on a button. */
export function fakeButton(customId: string, input: FakeInput = {}): FakeButton {
  const replies: ReplyMessage[] = [];
  const updates: OutgoingMessage[] = [];
  const forms: Form[] = [];
  const once = () => {
    // Discord accepts one answer per click: a reply, an update or a form.
    if (replies.length + updates.length + forms.length > 0) {
      throw new Error('Interaction already answered');
    }
  };
  return {
    ...actorOf(input),
    customId,
    replies,
    updates,
    forms,
    get answered() {
      return replies.length + updates.length + forms.length > 0;
    },
    showForm(form) {
      try {
        once();
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      forms.push(form);
      return Promise.resolve();
    },
    reply(message) {
      try {
        once();
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      replies.push(message);
      return Promise.resolve();
    },
    update(message) {
      try {
        once();
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      updates.push(message);
      return Promise.resolve();
    },
  };
}

export interface FakeForm extends FormSubmitInteraction {
  replies: ReplyMessage[];
  updates: OutgoingMessage[];
}

/** An in-memory stand-in for a sent form, with what was typed and picked in it. */
export function fakeForm(
  customId: string,
  values: { text?: Record<string, string>; selected?: Record<string, readonly string[]> } = {},
  input: FakeInput = {},
): FakeForm {
  const replies: ReplyMessage[] = [];
  const updates: OutgoingMessage[] = [];
  const once = () => {
    if (replies.length + updates.length > 0) {
      return Promise.reject(new Error('Interaction already answered'));
    }
    return null;
  };
  return {
    ...actorOf(input),
    customId,
    replies,
    updates,
    get answered() {
      return replies.length + updates.length > 0;
    },
    getText: (id) => values.text?.[id] || null,
    getSelected: (id) => values.selected?.[id] ?? [],
    reply(message) {
      const refused = once();
      if (refused) return refused;
      replies.push(message);
      return Promise.resolve();
    },
    update(message) {
      const refused = once();
      if (refused) return refused;
      updates.push(message);
      return Promise.resolve();
    },
  };
}

export interface FakeAutocomplete extends AutocompleteInteraction {
  responses: AutocompleteChoice[][];
}

/** An in-memory stand-in for the interaction Discord sends while an option is being typed. */
export function fakeAutocomplete(
  commandName: string,
  focused: { name: string; value: string },
  input: FakeInput = {},
): FakeAutocomplete {
  const responses: AutocompleteChoice[][] = [];
  return {
    ...actorOf(input),
    commandName,
    options: {
      getSubcommand: () => input.subcommand ?? null,
      getInteger: (name) => {
        const value = input.options?.[name];
        return typeof value === 'number' ? value : null;
      },
    },
    focused,
    responses,
    respond(choices) {
      responses.push([...choices]);
      return Promise.resolve();
    },
  };
}

export interface FakeGateway extends DiscordGateway {
  /** Every message posted, in order; an edit replaces the `message` of its entry. */
  posted: { channelId: string; messageId: string; message: OutgoingMessage; edits: number }[];
  /** Addresses downloaded, in order. */
  downloads: string[];
  /** Direct messages sent, in order. */
  direct: { userId: string; message: OutgoingMessage }[];
  /** Set to make the next calls fail, as when Discord is unreachable or a channel is gone. */
  failing: boolean;
  /** Each member's roles, by `guildId:userId`; anyone else is not a member. */
  members: Map<string, string[]>;
  /** How many times the roles were read, to check caching. */
  roleReads: number;
  /** What a download returns: a PNG header unless a test sets other bytes. */
  downloadData: Uint8Array;
  /** The servers the bot is in: their name, roles, text channels and who may manage them. */
  guilds: Map<
    string,
    {
      name: string;
      roles: { id: string; name: string }[];
      managers: string[];
      channels?: GuildTextChannel[];
    }
  >;
  /** Invitations Discord knows, by address. */
  invites: Map<string, { guildId: string; expiresAt: number | null }>;
  /** Members found by username, by `guildId:username` (lower case). */
  usernames: Map<string, { id: string; displayName: string }>;
  /** What the reconciler reads of each server; `changeGuild` changes it as Discord would. */
  snapshots: Map<string, GuildSnapshot>;
  /** Every change made to a server, in order. */
  changes: { guildId: string; change: GuildChange; reason: string }[];
  /** Kinds of change Discord refuses, as for a role above the bot's. */
  refused: Set<GuildChange['kind']>;
}

/** Applies one change to a snapshot as Discord would; returns the ID of what it created. */
function changeSnapshot(guild: GuildSnapshot, change: GuildChange, freshId: () => string) {
  const channel = (id: string) => {
    const found = guild.channels.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`Unknown channel ${id}`);
    return found;
  };
  const member = (id: string) => {
    const found = guild.members.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`Unknown member ${id}`);
    return found;
  };
  switch (change.kind) {
    case 'create_role': {
      const id = freshId();
      guild.roles.push({
        id,
        name: change.name,
        color: change.color,
        mentionable: change.mentionable,
      });
      return id;
    }
    case 'edit_role': {
      const role = guild.roles.find((candidate) => candidate.id === change.roleId);
      if (!role) throw new Error(`Unknown role ${change.roleId}`);
      if (change.name !== undefined) role.name = change.name;
      if (change.color !== undefined) role.color = change.color;
      if (change.mentionable !== undefined) role.mentionable = change.mentionable;
      return null;
    }
    case 'create_category': {
      const id = freshId();
      guild.categories.push({ id, name: change.name });
      return id;
    }
    case 'create_text_channel': {
      const id = freshId();
      guild.channels.push({
        id,
        name: change.name,
        parentId: change.parentId,
        overwrites: change.overwrites.map((overwrite) => ({
          id: overwrite.targetId,
          type: overwrite.targetType,
          allow: [...overwrite.allow],
          deny: [...overwrite.deny],
        })),
      });
      return id;
    }
    case 'edit_channel': {
      const category = guild.categories.find((candidate) => candidate.id === change.channelId);
      if (category) {
        if (change.name !== undefined) category.name = change.name;
        return null;
      }
      const found = channel(change.channelId);
      if (change.name !== undefined) found.name = change.name;
      if (change.parentId !== undefined) found.parentId = change.parentId;
      return null;
    }
    case 'set_overwrite': {
      const found = channel(change.channelId);
      found.overwrites = [
        ...found.overwrites.filter((overwrite) => overwrite.id !== change.targetId),
        {
          id: change.targetId,
          type: change.targetType,
          allow: [...change.allow],
          deny: [...change.deny],
        },
      ];
      return null;
    }
    case 'remove_overwrite': {
      const found = channel(change.channelId);
      found.overwrites = found.overwrites.filter((overwrite) => overwrite.id !== change.targetId);
      return null;
    }
    case 'add_member_role':
      member(change.userId).roleIds.push(change.roleId);
      return null;
    case 'remove_member_role': {
      const found = member(change.userId);
      found.roleIds = found.roleIds.filter((id) => id !== change.roleId);
      return null;
    }
    case 'delete_channel':
      guild.channels = guild.channels.filter((candidate) => candidate.id !== change.channelId);
      guild.categories = guild.categories.filter((candidate) => candidate.id !== change.channelId);
      return null;
    case 'delete_role':
      guild.roles = guild.roles.filter((role) => role.id !== change.roleId);
      for (const one of guild.members)
        one.roleIds = one.roleIds.filter((id) => id !== change.roleId);
      return null;
  }
}

/** An in-memory Discord: messages are kept in a list, downloads return `downloadData`. */
export function fakeGateway(): FakeGateway {
  const gateway: FakeGateway = {
    posted: [],
    downloads: [],
    direct: [],
    failing: false,
    members: new Map(),
    roleReads: 0,
    downloadData: PNG_HEADER_FOR_TESTS,
    guilds: new Map(),
    invites: new Map(),
    usernames: new Map(),
    snapshots: new Map(),
    changes: [],
    refused: new Set(),
    postMessage(channelId, message) {
      if (gateway.failing) return Promise.reject(new Error('Discord is unreachable'));
      const messageId = String(900_000_000_000_000_000n + BigInt(gateway.posted.length + 1));
      gateway.posted.push({ channelId, messageId, message, edits: 0 });
      return Promise.resolve({
        messageId,
        url: `https://discord.com/channels/1/${channelId}/${messageId}`,
      });
    },
    editMessage(channelId, messageId, message) {
      if (gateway.failing) return Promise.reject(new Error('Discord is unreachable'));
      const entry = gateway.posted.find(
        (candidate) => candidate.channelId === channelId && candidate.messageId === messageId,
      );
      if (!entry) return Promise.reject(new Error('Unknown message'));
      entry.message = message;
      entry.edits += 1;
      return Promise.resolve();
    },
    sendDirectMessage(userId, message) {
      if (gateway.failing) return Promise.reject(new Error('Direct messages are closed'));
      gateway.direct.push({ userId, message });
      return Promise.resolve();
    },
    downloadAttachment(url, maxBytes) {
      if (gateway.failing) return Promise.reject(new Error('Discord is unreachable'));
      gateway.downloads.push(url);
      const data = gateway.downloadData;
      return data.byteLength > maxBytes
        ? Promise.reject(new Error('Attachment is too large'))
        : Promise.resolve(data);
    },
    memberRoleIds(guildId, userId) {
      if (gateway.failing) return Promise.reject(new Error('Discord is unreachable'));
      gateway.roleReads += 1;
      return Promise.resolve(gateway.members.get(`${guildId}:${userId}`) ?? null);
    },
    manageableGuilds(userId) {
      if (gateway.failing) return Promise.reject(new Error('Discord is unreachable'));
      return Promise.resolve(
        [...gateway.guilds]
          .filter(([, guild]) => guild.managers.includes(userId))
          .map(([id, guild]) => ({ id, name: guild.name })),
      );
    },
    guildRoles(guildId) {
      if (gateway.failing) return Promise.reject(new Error('Discord is unreachable'));
      return Promise.resolve(gateway.guilds.get(guildId)?.roles ?? null);
    },
    guildTextChannels(guildId) {
      if (gateway.failing) return Promise.reject(new Error('Discord is unreachable'));
      const guild = gateway.guilds.get(guildId);
      return Promise.resolve(guild ? (guild.channels ?? []) : null);
    },
    resolveInvite(url) {
      if (gateway.failing) return Promise.reject(new Error('Discord is unreachable'));
      return Promise.resolve(gateway.invites.get(url) ?? null);
    },
    findMember(guildId, username) {
      if (gateway.failing) return Promise.reject(new Error('Discord is unreachable'));
      const key = `${guildId}:${username.trim().toLowerCase()}`;
      return Promise.resolve(gateway.usernames.get(key) ?? null);
    },
    guildSnapshot(guildId) {
      if (gateway.failing) return Promise.reject(new Error('Discord is unreachable'));
      const guild = gateway.snapshots.get(guildId);
      // A copy: the reconciler must see the server as it was when read.
      return Promise.resolve(guild ? (JSON.parse(JSON.stringify(guild)) as GuildSnapshot) : null);
    },
    changeGuild(guildId, change, reason) {
      if (gateway.failing) return Promise.reject(new Error('Discord is unreachable'));
      if (gateway.refused.has(change.kind)) return Promise.reject(new Error('Missing Permissions'));
      const guild = gateway.snapshots.get(guildId);
      if (!guild) return Promise.reject(new Error('Unknown Guild'));
      try {
        const created = changeSnapshot(guild, change, () =>
          String(950_000_000_000_000_000n + BigInt(gateway.changes.length + 1)),
        );
        gateway.changes.push({ guildId, change, reason });
        return Promise.resolve(created);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
  return gateway;
}

/** A command context in French over an empty in-memory database, unless overridden. */
export function fakeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    locale: 'fr',
    gatewayPingMs: 10,
    db: openTestDatabase(),
    gateway: fakeGateway(),
    assets: fakeAssetStore(),
    evidence: fakeEvidenceStore(),
    now: () => 1_800_000_000_000,
    publicUrl: new URL('http://localhost:3000'),
    ...overrides,
  };
}
