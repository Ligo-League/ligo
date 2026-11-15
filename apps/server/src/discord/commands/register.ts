import { catalogs, t } from '../../i18n/index.ts';
import { registrationLink } from '../../services/registrations.ts';
import { english } from './describe.ts';
import type { Command } from './types.ts';

// Quick access from Discord: the registration itself happens on the website, where the logo is
// uploaded and the rulebook read (design doc section 3).

export const registerCommand: Command = {
  data: {
    name: 'register',
    description: catalogs.fr['command.register.description'],
    description_localizations: english('command.register.description'),
  },
  async execute(interaction, context) {
    const link = registrationLink(context.db, interaction.guildId);
    const content = link.ok
      ? t(context.locale, 'register.open', {
          competition: link.competition,
          season: link.season,
          url: new URL(link.path, context.publicUrl).href,
        })
      : link.error === 'closed'
        ? t(context.locale, 'register.closed', { competition: link.competition ?? '' })
        : t(context.locale, 'register.not_linked');
    await interaction.reply({ content, ephemeral: true });
  },
};
