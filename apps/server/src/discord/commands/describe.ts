import { InteractionContextType } from 'discord.js';
import { catalogs, type MessageKey } from '../../i18n/index.ts';

// Shared pieces of command definitions. French is the default text; English is its translation
// for members whose Discord is in English.

export const english = (key: MessageKey) => ({
  'en-US': catalogs.en[key],
  'en-GB': catalogs.en[key],
});

/** The description of a command, subcommand or option, in both languages. */
export const described = (key: MessageKey) => ({
  description: catalogs.fr[key],
  description_localizations: english(key),
});

/**
 * For league-staff commands: hidden from everyone but administrators until a server admin opens
 * them to the staff role (Server Settings > Integrations), and unusable in direct messages.
 * This is only tidiness: the service behind each command checks the staff role itself.
 */
export const STAFF_ONLY = {
  default_member_permissions: '0',
  contexts: [InteractionContextType.Guild],
};

// Discord shows at most 25 suggestions, each at most 100 characters long.
export const MAX_CHOICES = 25;
export const MAX_CHOICE_LENGTH = 100;
