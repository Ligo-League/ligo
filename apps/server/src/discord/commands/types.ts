import type { Db } from '@ligo/db';
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { Locale } from '../../i18n/index.ts';
import type { Actor } from '../../services/permissions.ts';

/** A file the bot attaches to its reply. */
export interface CommandFile {
  name: string;
  data: Uint8Array;
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
  };
  /** True once the reply itself has been sent; a deferral alone does not count. */
  readonly answered: boolean;
  /**
   * Tells Discord the reply is coming, for work that may take more than its 3 seconds, such as
   * rendering an image. The reply that follows is then visible to everyone.
   */
  defer(): Promise<void>;
  reply(message: {
    content: string;
    ephemeral: boolean;
    files?: readonly CommandFile[];
  }): Promise<void>;
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

export interface CommandContext {
  locale: Locale;
  gatewayPingMs: number;
  db: Db;
  /** The current time in Unix milliseconds; services take it as a parameter. */
  now(): number;
}

/** A slash command: a thin adapter that calls a service and formats the reply. */
export interface Command {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: CommandInteraction, context: CommandContext): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, context: CommandContext): Promise<void>;
}
