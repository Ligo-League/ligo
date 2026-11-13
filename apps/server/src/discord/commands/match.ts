import { describeGameScores, type GameScoreSettings } from '@ligo/core';
import type { LeagueMatch } from '@ligo/db';
import { ApplicationCommandOptionType, InteractionContextType } from 'discord.js';
import { catalogs, t, type Locale, type MessageKey } from '../../i18n/index.ts';
import { recordResult, searchMatches } from '../../services/results.ts';
import type { Command } from './types.ts';

// Discord shows at most 25 suggestions, each at most 100 characters long.
const MAX_CHOICES = 25;
const MAX_CHOICE_LENGTH = 100;

const french = (key: MessageKey) => catalogs.fr[key];
const english = (key: MessageKey) => ({
  'en-US': catalogs.en[key],
  'en-GB': catalogs.en[key],
});
const described = (key: MessageKey) => ({
  description: french(key),
  description_localizations: english(key),
});

/** "L1 · S3 · BRV – CHA", or with the stored score when the match already has a result. */
function matchLabel(locale: Locale, found: LeagueMatch): string {
  const base = {
    division: found.division?.categoryPrefix ?? '—',
    week: found.week ?? '?',
    teamA: found.a.tag,
    teamB: found.b.tag,
  };
  const label =
    found.status === 'validated' && found.game
      ? t(locale, 'match.labelWithResult', {
          ...base,
          scoreA: found.game.scoreA,
          scoreB: found.game.scoreB,
        })
      : t(locale, 'match.label', base);
  return label.slice(0, MAX_CHOICE_LENGTH);
}

/** Why a score was refused, with the scores the league's rule allows. */
function impossibleScore(locale: Locale, rule: GameScoreSettings): string {
  const { regulation, overtime, endless } = describeGameScores(rule);
  const score = ([winner, loser]: readonly [number, number]) => `${winner}–${loser}`;
  return t(locale, 'match.error.impossible_score', {
    widest: score(regulation.from),
    closest: score(regulation.to),
    overtime: overtime.map(score).join(', ') + (endless ? '…' : ''),
  });
}

export const matchCommand: Command = {
  data: {
    name: 'match',
    ...described('command.match.description'),
    // Hidden from everyone but administrators until a server admin opens it to the staff role
    // (Server Settings > Integrations). This is only tidiness: the service checks the role.
    default_member_permissions: '0',
    contexts: [InteractionContextType.Guild],
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'result',
        ...described('command.match.result.description'),
        options: [
          {
            type: ApplicationCommandOptionType.Integer,
            name: 'match',
            ...described('command.match.result.option.match'),
            required: true,
            autocomplete: true,
          },
          {
            type: ApplicationCommandOptionType.Integer,
            name: 'score_a',
            ...described('command.match.result.option.scoreA'),
            required: true,
            min_value: 0,
          },
          {
            type: ApplicationCommandOptionType.Integer,
            name: 'score_b',
            ...described('command.match.result.option.scoreB'),
            required: true,
            min_value: 0,
          },
          {
            type: ApplicationCommandOptionType.Attachment,
            name: 'screenshot',
            ...described('command.match.result.option.screenshot'),
            required: false,
          },
        ],
      },
    ],
  },

  async execute(interaction, context) {
    const { locale } = context;
    const privately = (content: string) => interaction.reply({ content, ephemeral: true });
    if (interaction.options.getSubcommand() !== 'result') {
      await privately(t(locale, 'error.unknownCommand'));
      return;
    }

    const matchId = interaction.options.getInteger('match');
    const scoreA = interaction.options.getInteger('score_a');
    const scoreB = interaction.options.getInteger('score_b');
    if (matchId === null || scoreA === null || scoreB === null) {
      // Free text typed instead of a suggestion never reaches here as a number.
      await privately(t(locale, 'match.error.match_not_found'));
      return;
    }

    const reply = recordResult(
      context.db,
      interaction,
      { matchId, scoreA, scoreB, screenshot: interaction.options.getAttachment('screenshot') },
      context.now(),
    );
    if (!reply.ok) {
      await privately(
        reply.error === 'impossible_score'
          ? impossibleScore(locale, reply.rule)
          : t(locale, `match.error.${reply.error}`),
      );
      return;
    }

    const details = {
      division: reply.match.division?.name ?? '—',
      week: reply.match.week ?? '?',
      teamA: reply.match.a.name,
      teamB: reply.match.b.name,
      scoreA: reply.scoreA,
      scoreB: reply.scoreB,
    };
    await privately(
      reply.previous
        ? t(locale, 'match.result.corrected', {
            ...details,
            previousA: reply.previous.scoreA,
            previousB: reply.previous.scoreB,
          })
        : t(locale, 'match.result.recorded', details),
    );
  },

  async autocomplete(interaction, context) {
    if (interaction.focused.name !== 'match') {
      await interaction.respond([]);
      return;
    }
    const found = searchMatches(context.db, interaction, interaction.focused.value, MAX_CHOICES);
    await interaction.respond(
      found.map((candidate) => ({
        name: matchLabel(context.locale, candidate),
        value: candidate.id,
      })),
    );
  },
};
