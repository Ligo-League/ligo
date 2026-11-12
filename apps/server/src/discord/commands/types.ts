import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { Locale } from '../../i18n/index.ts';

/** The part of a Discord slash-command interaction that command handlers may use. */
export interface CommandInteraction {
  commandName: string;
  /** True once a reply or a deferral has been sent. */
  readonly answered: boolean;
  reply(message: { content: string; ephemeral: boolean }): Promise<void>;
}

export interface CommandContext {
  locale: Locale;
  gatewayPingMs: number;
}

/** A slash command: a thin adapter that calls a service and formats the reply. */
export interface Command {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: CommandInteraction, context: CommandContext): Promise<void>;
}
