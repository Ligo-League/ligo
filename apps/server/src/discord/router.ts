import { t } from '../i18n/index.ts';
import type {
  AutocompleteInteraction,
  Command,
  CommandContext,
  CommandInteraction,
} from './commands/types.ts';

export interface ErrorLogger {
  error(details: object, message: string): void;
}

/**
 * Runs the command an interaction asks for. A failure is logged and answered with a private,
 * generic message: error details never reach the channel.
 */
export async function routeCommand(
  commands: readonly Command[],
  interaction: CommandInteraction,
  context: CommandContext,
  logger: ErrorLogger,
): Promise<void> {
  const command = commands.find((candidate) => candidate.data.name === interaction.commandName);
  if (!command) {
    await interaction.reply({
      content: t(context.locale, 'error.unknownCommand'),
      ephemeral: true,
    });
    return;
  }

  try {
    await command.execute(interaction, context);
  } catch (error) {
    logger.error({ err: error, command: interaction.commandName }, 'Command failed');
    if (!interaction.answered) {
      await interaction.reply({ content: t(context.locale, 'error.unexpected'), ephemeral: true });
    }
  }
}

/**
 * Asks a command for the suggestions of the option being typed. A command without suggestions,
 * or one that fails, answers with none: Discord then shows an empty list instead of an error.
 */
export async function routeAutocomplete(
  commands: readonly Command[],
  interaction: AutocompleteInteraction,
  context: CommandContext,
  logger: ErrorLogger,
): Promise<void> {
  const command = commands.find((candidate) => candidate.data.name === interaction.commandName);
  if (!command?.autocomplete) {
    await interaction.respond([]);
    return;
  }

  try {
    await command.autocomplete(interaction, context);
  } catch (error) {
    logger.error({ err: error, command: interaction.commandName }, 'Autocomplete failed');
    await interaction.respond([]);
  }
}
