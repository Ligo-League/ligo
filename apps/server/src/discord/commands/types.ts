import type { Db } from '@ligo/db';
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { Locale } from '../../i18n/index.ts';
import type { Actor } from '../../services/permissions.ts';
import type { ButtonTarget } from '../button-id.ts';
import type { DiscordGateway } from '../gateway.ts';

/** A file the bot attaches to its reply. */
export interface CommandFile {
  name: string;
  data: Uint8Array;
}

/** A button under a message. Its `customId` comes from `buttonId`. */
export interface MessageButton {
  customId: string;
  label: string;
  style: 'primary' | 'secondary' | 'success' | 'danger';
}

/** A message the bot sends: a reply, a post in a channel, or an edit. */
export interface OutgoingMessage {
  content: string;
  files?: readonly CommandFile[];
  buttons?: readonly MessageButton[];
  /** The only users the message may notify; a mention of anyone else shows without pinging. */
  mentionUserIds?: readonly string[];
}

/** A reply to an interaction; `ephemeral` shows it to the member alone. */
export interface ReplyMessage extends OutgoingMessage {
  ephemeral: boolean;
}

/** A file attached to a command, as Discord describes it. */
export interface CommandAttachment {
  url: string;
  contentType: string | null;
  size: number;
}

interface InteractionBase extends Actor {
  commandName: string;
}

/** The part of a Discord slash-command interaction that command handlers may use. */
export interface CommandInteraction extends InteractionBase {
  options: {
    /** The subcommand used, or null for a command that has none. */
    getSubcommand(): string | null;
    /** The value given for an option, or null when it was left out. */
    getString(name: string): string | null;
    getInteger(name: string): number | null;
    getAttachment(name: string): CommandAttachment | null;
    /** The member picked for a user option. */
    getUser(name: string): { id: string; displayName: string } | null;
    /** The channel picked for a channel option. */
    getChannel(name: string): { id: string } | null;
  };
  /** True once the reply itself has been sent; a deferral alone does not count. */
  readonly answered: boolean;
  /**
   * Tells Discord the reply is coming, for work that may take more than its 3 seconds, such as
   * rendering an image. The reply that follows is then visible to everyone.
   */
  defer(): Promise<void>;
  reply(message: ReplyMessage): Promise<void>;
}

export interface AutocompleteChoice {
  /** What the member sees, at most 100 characters. */
  name: string;
  /** What the command receives for the option. */
  value: number | string;
}

/** A member is typing an option that offers suggestions. */
export interface AutocompleteInteraction extends InteractionBase {
  options: Pick<CommandInteraction['options'], 'getSubcommand'>;
  /** The option being typed and its text so far. */
  focused: { name: string; value: string };
  respond(choices: readonly AutocompleteChoice[]): Promise<void>;
}

/** A member clicked a button under one of the bot's messages. */
export interface ButtonInteraction extends Actor {
  customId: string;
  /** True once the click has been answered, by a reply or by an update. */
  readonly answered: boolean;
  /** Answers with a new message. */
  reply(message: ReplyMessage): Promise<void>;
  /** Replaces the message the button sits on, for example to remove buttons that were used. */
  update(message: OutgoingMessage): Promise<void>;
}

export interface CommandContext {
  locale: Locale;
  gatewayPingMs: number;
  db: Db;
  gateway: DiscordGateway;
  /** The current time in Unix milliseconds; services take it as a parameter. */
  now(): number;
}

/** A slash command: a thin adapter that calls a service and formats the reply. */
export interface Command {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: CommandInteraction, context: CommandContext): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, context: CommandContext): Promise<void>;
}

/** What a kind of button does. Thin, like a command: it calls a service and formats the answer. */
export interface ButtonHandler {
  /** The first part of the custom IDs it answers. */
  action: string;
  execute(
    interaction: ButtonInteraction,
    target: ButtonTarget,
    context: CommandContext,
  ): Promise<void>;
}
