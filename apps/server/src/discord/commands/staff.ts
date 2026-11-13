import { ApplicationCommandOptionType } from 'discord.js';
import { t } from '../../i18n/index.ts';
import { searchMatchesForStaff, validateResult, voidMatch } from '../../services/reports.ts';
import { recordResult, searchMatches } from '../../services/results.ts';
import { impossibleScore, matchFixture, matchLabel, notify, storedLine } from '../match-text.ts';
import { described, MAX_CHOICES, STAFF_ONLY } from './describe.ts';
import type { Command } from './types.ts';

const matchOption = {
  type: ApplicationCommandOptionType.Integer as const,
  name: 'match',
  ...described('command.staff.match.option.match'),
  required: true,
  autocomplete: true,
};

// League-staff actions, grouped under one hidden command so members never see them.
export const staffCommand: Command = {
  data: {
    name: 'staff',
    ...described('command.staff.description'),
    ...STAFF_ONLY,
    options: [
      {
        type: ApplicationCommandOptionType.SubcommandGroup,
        name: 'match',
        ...described('command.staff.match.description'),
        options: [
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: 'result',
            ...described('command.staff.match.result.description'),
            options: [
              matchOption,
              {
                type: ApplicationCommandOptionType.Integer,
                name: 'score_a',
                ...described('command.match.option.scoreA'),
                required: true,
                min_value: 0,
              },
              {
                type: ApplicationCommandOptionType.Integer,
                name: 'score_b',
                ...described('command.match.option.scoreB'),
                required: true,
                min_value: 0,
              },
              {
                type: ApplicationCommandOptionType.Attachment,
                name: 'screenshot',
                ...described('command.staff.match.result.option.screenshot'),
                required: false,
              },
            ],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: 'validate',
            ...described('command.staff.match.validate.description'),
            options: [matchOption],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: 'void',
            ...described('command.staff.match.void.description'),
            options: [
              matchOption,
              {
                type: ApplicationCommandOptionType.String,
                name: 'reason',
                ...described('command.staff.match.void.option.reason'),
                required: true,
                max_length: 500,
              },
            ],
          },
        ],
      },
    ],
  },

  async execute(interaction, context) {
    const { locale, db } = context;
    const privately = (content: string) => interaction.reply({ content, ephemeral: true });
    const action = interaction.options.getSubcommand();
    if (interaction.options.getSubcommandGroup() !== 'match') {
      await privately(t(locale, 'error.unknownCommand'));
      return;
    }
    const matchId = interaction.options.getInteger('match');
    if (matchId === null) {
      // Free text typed instead of a suggestion never arrives as a number.
      await privately(t(locale, 'match.error.match_not_found'));
      return;
    }

    if (action === 'validate') {
      const reply = validateResult(db, interaction, { matchId }, context.now());
      if (!reply.ok) {
        await privately(t(locale, `match.error.${reply.error}`));
        return;
      }
      const line = storedLine(locale, reply.match);
      await notify(context, reply.resultsChannelId, {
        content: t(locale, 'result.announce', { line }),
      });
      await privately(t(locale, 'staff.match.validated', { line }));
      return;
    }

    if (action === 'void') {
      const reason = interaction.options.getString('reason') ?? '';
      const reply = voidMatch(db, interaction, { matchId, reason }, context.now());
      await privately(
        reply.ok
          ? t(locale, 'staff.match.voided', { fixture: matchFixture(locale, reply.match) })
          : t(locale, `match.error.${reply.error}`),
      );
      return;
    }

    const scoreA = interaction.options.getInteger('score_a');
    const scoreB = interaction.options.getInteger('score_b');
    if (action !== 'result' || scoreA === null || scoreB === null) {
      await privately(t(locale, 'error.unknownCommand'));
      return;
    }
    const reply = recordResult(
      db,
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
    const action = interaction.options.getSubcommand();
    if (interaction.focused.name !== 'match') {
      await interaction.respond([]);
      return;
    }
    const query = interaction.focused.value;
    const found =
      action === 'validate' || action === 'void'
        ? searchMatchesForStaff(context.db, interaction, action, query, MAX_CHOICES)
        : searchMatches(context.db, interaction, query, MAX_CHOICES);
    await interaction.respond(
      found.map((candidate) => ({
        name: matchLabel(context.locale, candidate),
        value: candidate.id,
      })),
    );
  },
};
