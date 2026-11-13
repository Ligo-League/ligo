import type { Db } from '@ligo/db';
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type AutocompleteInteraction as DiscordAutocomplete,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';
import type { Logger } from 'pino';
import { DEFAULT_LOCALE } from '../i18n/index.ts';
import type { Actor } from '../services/permissions.ts';
import type {
  AutocompleteInteraction,
  Command,
  CommandContext,
  CommandInteraction,
} from './commands/types.ts';
import { routeAutocomplete, routeCommand } from './router.ts';

// Discord shows at most this many suggestions for an option.
const MAX_CHOICES = 25;

/** Who used the command, with the roles Discord sent along with the interaction. */
function actorOf(interaction: ChatInputCommandInteraction | DiscordAutocomplete): Actor {
  const roles = interaction.member?.roles;
  // A cached member carries a role manager; an uncached one the plain list of role IDs.
  const memberRoleIds = !roles ? [] : Array.isArray(roles) ? roles : [...roles.cache.keys()];
  return {
    guildId: interaction.guildId,
    user: { id: interaction.user.id, displayName: interaction.user.displayName },
    memberRoleIds,
  };
}

/**
 * The gateway client. Guild Members is a privileged intent: it must be enabled in the Developer
 * Portal (docs/setup.md), and the reconciler will need it to read role membership.
 */
export function createDiscordClient(deps: {
  commands: readonly Command[];
  logger: Logger;
  db: Db;
}): Client {
  const { commands, logger, db } = deps;
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
  const contextNow = (): CommandContext => ({
    locale: DEFAULT_LOCALE,
    gatewayPingMs: client.ws.ping,
    db,
    now: () => Date.now(),
  });

  client.once(Events.ClientReady, (ready) => {
    logger.info({ user: ready.user.tag, guilds: ready.guilds.cache.size }, 'Discord client ready');
  });

  client.on(Events.Error, (error) => {
    logger.error({ err: error }, 'Discord client error');
  });

  client.on(Events.InteractionCreate, (interaction: Interaction) => {
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused(true);
      const adapter: AutocompleteInteraction = {
        ...actorOf(interaction),
        commandName: interaction.commandName,
        options: { getSubcommand: () => interaction.options.getSubcommand(false) },
        focused: { name: focused.name, value: focused.value },
        async respond(choices) {
          await interaction.respond(choices.slice(0, MAX_CHOICES));
        },
      };
      routeAutocomplete(commands, adapter, contextNow(), logger).catch((error: unknown) => {
        // Reached when the suggestions could not be sent, e.g. the member kept typing.
        logger.error({ err: error, command: interaction.commandName }, 'Could not suggest');
      });
      return;
    }
    if (!interaction.isChatInputCommand()) return;

    const adapter: CommandInteraction = {
      ...actorOf(interaction),
      commandName: interaction.commandName,
      options: {
        getSubcommand: () => interaction.options.getSubcommand(false),
        getString: (name) => interaction.options.getString(name),
        getInteger: (name) => interaction.options.getInteger(name),
        getAttachment: (name) => {
          const attachment = interaction.options.getAttachment(name);
          return (
            attachment && {
              url: attachment.url,
              contentType: attachment.contentType,
              size: attachment.size,
            }
          );
        },
      },
      get answered() {
        return interaction.replied || interaction.deferred;
      },
      async reply({ content, ephemeral }) {
        await interaction.reply(
          ephemeral ? { content, flags: MessageFlags.Ephemeral } : { content },
        );
      },
    };

    routeCommand(commands, adapter, contextNow(), logger).catch((error: unknown) => {
      // Reached only when even the error reply could not be sent (e.g. the interaction expired).
      logger.error({ err: error, command: interaction.commandName }, 'Could not answer command');
    });
  });

  return client;
}
