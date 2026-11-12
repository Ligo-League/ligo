import { ApplicationCommandOptionType } from 'discord.js';
import { catalogs, t } from '../../i18n/index.ts';
import { getStandings } from '../../services/standings.ts';
import { formatStandingsTable } from '../standings-table.ts';
import type { Command } from './types.ts';

// Discord refuses a message longer than this.
const MESSAGE_LIMIT = 2000;

export const standingsCommand: Command = {
  data: {
    name: 'standings',
    description: catalogs.fr['command.standings.description'],
    description_localizations: {
      'en-US': catalogs.en['command.standings.description'],
      'en-GB': catalogs.en['command.standings.description'],
    },
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: 'division',
        description: catalogs.fr['command.standings.option.division'],
        description_localizations: {
          'en-US': catalogs.en['command.standings.option.division'],
          'en-GB': catalogs.en['command.standings.option.division'],
        },
        required: false,
      },
    ],
  },
  async execute(interaction, context) {
    const { locale } = context;
    const standings = getStandings(context.db, {
      guildId: interaction.guildId,
      division: interaction.options.getString('division'),
    });

    if (!standings.ok) {
      const content =
        standings.error === 'unknown_division'
          ? t(locale, 'standings.unknownDivision', { divisions: standings.divisions.join(', ') })
          : t(locale, `standings.${standings.error}`);
      await interaction.reply({ content, ephemeral: true });
      return;
    }

    const content = standings.tables
      .map((table) => {
        const title = t(locale, 'standings.title', {
          competition: standings.competition,
          season: standings.season,
          division: table.division,
        });
        return `**${title}**\n\`\`\`\n${formatStandingsTable(locale, table)}\n\`\`\``;
      })
      .join('\n');
    if (content.length > MESSAGE_LIMIT) {
      const divisions = standings.tables.map((table) => table.division).join(', ');
      await interaction.reply({
        content: t(locale, 'standings.tooLong', { divisions }),
        ephemeral: true,
      });
      return;
    }
    await interaction.reply({ content, ephemeral: false });
  },
};
