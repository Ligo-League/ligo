import { ApplicationCommandOptionType, InteractionContextType } from 'discord.js';
import { catalogs, t, type Locale, type MessageKey } from '../../i18n/index.ts';
import { helpFacts, type HelpFacts } from '../../services/help.ts';
import { SCREENSHOT_MAX_BYTES } from '../../services/results.ts';
import { described } from './describe.ts';
import type { Command } from './types.ts';

// Discord gives a command one short sentence of description; /help says the rest.

/** The pages of /help, one per command, or per group of /staff. */
export const HELP_TOPICS = [
  'standings',
  'match',
  'staff-match',
  'staff-sanction',
  'team',
  'league',
] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];

const PAGES: Record<HelpTopic, MessageKey> = {
  standings: 'help.page.standings',
  match: 'help.page.match',
  'staff-match': 'help.page.staffMatch',
  'staff-sanction': 'help.page.staffSanction',
  team: 'help.page.team',
  league: 'help.page.league',
};

/** The list of commands: staff commands only for staff, who also get the order of setup. */
export function helpOverview(locale: Locale, facts: HelpFacts): string {
  const parts = [t(locale, 'help.overview')];
  if (facts.staff) parts.push(t(locale, 'help.overview.staff'));
  return parts.join('\n\n');
}

/** One command explained, with the league's own settings where the explanation depends on them. */
export function helpPage(locale: Locale, topic: HelpTopic, facts: HelpFacts): string {
  const { rules } = facts;
  if (topic === 'match') {
    // Without a linked league, the steps of a league whose staff validate are the usual case.
    const steps =
      rules?.validation === 'opponent' ? 'help.match.steps.opponent' : 'help.match.steps.staff';
    return [
      t(locale, PAGES.match, { maxMb: Math.floor(SCREENSHOT_MAX_BYTES / (1024 * 1024)) }),
      t(locale, steps),
    ].join('\n\n');
  }
  if (topic === 'staff-match') {
    const thresholds = [
      rules?.forfeits?.warning_at &&
        t(locale, 'help.forfeit.warning', { count: rules.forfeits.warning_at }),
      rules?.forfeits?.exclusion_at &&
        t(locale, 'help.forfeit.exclusion', { count: rules.forfeits.exclusion_at }),
    ].filter((line): line is string => typeof line === 'string');
    // The thresholds hang under the `forfeit` line they belong to.
    const page = [t(locale, PAGES['staff-match']), ...thresholds.map((line) => `  – ${line}`)];
    return [page.join('\n'), t(locale, 'help.staffMatch.footer')].join('\n\n');
  }
  if (topic === 'team') {
    const page = t(locale, PAGES.team);
    return rules ? `${page}\n${t(locale, 'help.team.max', { max: rules.teamStaffMax })}` : page;
  }
  return t(locale, PAGES[topic]);
}

export const helpCommand: Command = {
  data: {
    name: 'help',
    ...described('command.help.description'),
    contexts: [InteractionContextType.Guild],
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: 'command',
        ...described('command.help.option.command'),
        required: false,
        choices: HELP_TOPICS.map((topic) => ({
          // Command names read the same in both languages.
          name: catalogs.fr[`help.choice.${topic}`],
          value: topic,
        })),
      },
    ],
  },

  async execute(interaction, context) {
    const { locale } = context;
    const facts = helpFacts(context.db, interaction);
    const asked = interaction.options.getString('command');
    const topic = HELP_TOPICS.find((known) => known === asked);
    await interaction.reply({
      content: topic ? helpPage(locale, topic, facts) : helpOverview(locale, facts),
      ephemeral: true,
    });
  },
};
