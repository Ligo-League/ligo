import { openTestDatabase } from '@ligo/db/testing';
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
import type { DiscordGateway } from './gateway.ts';

type OptionValue =
  | string
  | number
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
}

const actorOf = (input: FakeInput) => ({
  guildId: input.guildId ?? null,
  user: input.user ?? { id: '555555555555555555', displayName: 'Member' },
  memberRoleIds: input.memberRoleIds ?? [],
});

export interface FakeInteraction extends CommandInteraction {
  replies: ReplyMessage[];
  /** True once `defer` has been called. */
  deferred: boolean;
}

/** An in-memory stand-in for a Discord slash-command interaction. */
export function fakeInteraction(commandName: string, input: FakeInput = {}): FakeInteraction {
  const replies: ReplyMessage[] = [];
  const option = (name: string) => input.options?.[name];
  return {
    ...actorOf(input),
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
    get answered() {
      return replies.length > 0;
    },
    defer() {
      // Discord refuses to defer twice, or after a reply.
      if (this.deferred || replies.length > 0) {
        return Promise.reject(new Error('Interaction already acknowledged'));
      }
      this.deferred = true;
      return Promise.resolve();
    },
    reply(message) {
      // Discord refuses a second reply to the same interaction.
      if (replies.length > 0) return Promise.reject(new Error('Interaction already answered'));
      replies.push(message);
      return Promise.resolve();
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
    options: { getSubcommand: () => input.subcommand ?? null },
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
  /** Set to make the next calls fail, as when Discord is unreachable or a channel is gone. */
  failing: boolean;
}

/** An in-memory Discord: messages are kept in a list, downloads return a few fixed bytes. */
export function fakeGateway(): FakeGateway {
  const gateway: FakeGateway = {
    posted: [],
    downloads: [],
    failing: false,
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
    downloadAttachment(url, maxBytes) {
      if (gateway.failing) return Promise.reject(new Error('Discord is unreachable'));
      gateway.downloads.push(url);
      const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      return data.byteLength > maxBytes
        ? Promise.reject(new Error('Attachment is too large'))
        : Promise.resolve(data);
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
    now: () => 1_800_000_000_000,
    ...overrides,
  };
}
