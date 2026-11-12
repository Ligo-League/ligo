import { Client, Events, GatewayIntentBits, MessageFlags, type Interaction } from 'discord.js';
import type { Logger } from 'pino';
import { DEFAULT_LOCALE } from '../i18n/index.ts';
import type { Command, CommandInteraction } from './commands/types.ts';
import { routeCommand } from './router.ts';

/**
 * The gateway client. Guild Members is a privileged intent: it must be enabled in the Developer
 * Portal (docs/setup.md), and the reconciler will need it to read role membership.
 */
export function createDiscordClient(deps: {
  commands: readonly Command[];
  logger: Logger;
}): Client {
  const { commands, logger } = deps;
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  client.once(Events.ClientReady, (ready) => {
    logger.info({ user: ready.user.tag, guilds: ready.guilds.cache.size }, 'Discord client ready');
  });

  client.on(Events.Error, (error) => {
    logger.error({ err: error }, 'Discord client error');
  });

  client.on(Events.InteractionCreate, (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const adapter: CommandInteraction = {
      commandName: interaction.commandName,
      get answered() {
        return interaction.replied || interaction.deferred;
      },
      async reply({ content, ephemeral }) {
        await interaction.reply(
          ephemeral ? { content, flags: MessageFlags.Ephemeral } : { content },
        );
      },
    };
    const context = { locale: DEFAULT_LOCALE, gatewayPingMs: client.ws.ping };

    routeCommand(commands, adapter, context, logger).catch((error: unknown) => {
      // Reached only when even the error reply could not be sent (e.g. the interaction expired).
      logger.error({ err: error, command: interaction.commandName }, 'Could not answer command');
    });
  });

  return client;
}
