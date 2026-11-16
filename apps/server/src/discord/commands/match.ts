import { ApplicationCommandOptionType, InteractionContextType } from 'discord.js';
import { t } from '../../i18n/index.ts';
import {
  checkReport,
  recordReportPost,
  reportResult,
  searchReportableMatches,
} from '../../services/reports.ts';
import { impossibleScore, matchLabel } from '../match-text.ts';
import { reportPostMessage, reportQueueMessage } from '../report-posts.ts';
import { described, MAX_CHOICE_LENGTH, MAX_CHOICES } from './describe.ts';
import type { Command } from './types.ts';

// `/match report`, for teams in their voice call right after the match: the score and the
// screenshot every report needs. Everything else a match needs is on its page (design doc
// section 3, maintainer, 16 November 2026); the reply links to it.

export const matchCommand: Command = {
  data: {
    name: 'match',
    ...described('command.match.description'),
    contexts: [InteractionContextType.Guild],
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'report',
        ...described('command.match.report.description'),
        options: [
          {
            type: ApplicationCommandOptionType.Integer,
            name: 'match',
            ...described('command.match.report.option.match'),
            required: true,
            autocomplete: true,
          },
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
            ...described('command.match.report.option.screenshot'),
            required: true,
          },
        ],
      },
    ],
  },

  async execute(interaction, context) {
    const { locale } = context;
    const privately = (content: string) => interaction.reply({ content, ephemeral: true });
    if (interaction.options.getSubcommand() !== 'report') {
      await privately(t(locale, 'error.unknownCommand'));
      return;
    }
    const matchId = interaction.options.getInteger('match');
    const scoreA = interaction.options.getInteger('score_a');
    const scoreB = interaction.options.getInteger('score_b');
    if (matchId === null || scoreA === null || scoreB === null) {
      // Free text typed instead of a suggestion never arrives as a number.
      await privately(t(locale, 'match.error.match_not_found'));
      return;
    }
    const request = {
      matchId,
      scoreA,
      scoreB,
      screenshot: interaction.options.getAttachment('screenshot'),
    };

    // A refusal is private, so it is decided before the public reply is announced.
    const check = checkReport(context.db, interaction, request);
    if (!check.ok) {
      await privately(
        check.error === 'impossible_score'
          ? impossibleScore(locale, check.rule)
          : t(locale, `match.error.${check.error}`),
      );
      return;
    }

    // Fetching the screenshot and posting it for staff can take longer than Discord waits.
    await interaction.defer();
    const reply = await reportResult(
      context.db,
      context.gateway,
      context.evidence,
      interaction,
      request,
      (report) => reportQueueMessage(locale, report, interaction.user.id),
      context.now(),
    );
    if (!reply.ok) {
      await interaction.reply({
        content:
          reply.error === 'impossible_score'
            ? impossibleScore(locale, reply.rule)
            : t(locale, `match.error.${reply.error}`),
        ephemeral: true,
      });
      return;
    }

    const post = await interaction.reply({
      ...reportPostMessage(locale, reply, interaction.user.id, context.publicUrl),
      ephemeral: false,
    });
    // Kept so that an answer given on the website edits it too.
    if (post && interaction.channelId !== null) {
      recordReportPost(context.db, reply.evidenceId, {
        channelId: interaction.channelId,
        messageId: post.messageId,
      });
    }
  },

  async autocomplete(interaction, context) {
    if (interaction.focused.name !== 'match') {
      await interaction.respond([]);
      return;
    }
    const { locale } = context;
    const query = interaction.focused.value.trim();
    const found = searchReportableMatches(context.db, interaction, query, MAX_CHOICES);
    if (found.ok && found.matches.length > 0) {
      await interaction.respond(
        found.matches.map((candidate) => ({
          name: matchLabel(locale, candidate),
          value: candidate.id,
        })),
      );
      return;
    }
    // Discord shows no message in a list of suggestions: one entry says why it is empty. Its
    // value names no match, so picking it ends in the same explanation from the command.
    const reason = !found.ok
      ? t(locale, `match.error.${found.error}`)
      : query === ''
        ? t(locale, 'report.hint.nothingLeft')
        : t(locale, 'report.hint.noMatch', { query });
    await interaction.respond([{ name: reason.slice(0, MAX_CHOICE_LENGTH), value: 0 }]);
  },
};
