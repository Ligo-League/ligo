import { catalogs, t } from '../../i18n/index.ts';
import { ping } from '../../services/ping.ts';
import type { Command } from './types.ts';

export const pingCommand: Command = {
  data: {
    name: 'ping',
    description: catalogs.fr['command.ping.description'],
    description_localizations: {
      'en-US': catalogs.en['command.ping.description'],
      'en-GB': catalogs.en['command.ping.description'],
    },
  },
  async execute(interaction, context) {
    const { gatewayMs } = ping({ gatewayPingMs: context.gatewayPingMs });
    const content =
      gatewayMs === null
        ? t(context.locale, 'ping.replyNoLatency')
        : t(context.locale, 'ping.reply', { gatewayMs });
    await interaction.reply({ content, ephemeral: true });
  },
};
