import { ApplicationCommandOptionType } from 'discord.js';
import { announceWithCard } from '../match-card.ts';
import { catalogs, t, type Locale } from '../../i18n/index.ts';
import { recordForfeit, searchForfeitableMatches } from '../../services/forfeits.ts';
import { searchMatchesForStaff, validateResult, voidMatch } from '../../services/reports.ts';
import { fetchAndKeepEvidence } from '../../services/evidence.ts';
import { recordResult, searchMatches } from '../../services/results.ts';
import {
  readMatchTime,
  searchSchedulableMatches,
  setMatchTime,
} from '../../services/scheduling.ts';
import {
  addSanction,
  listSanctions,
  TEAM_SANCTION_KINDS,
  type SanctionEntry,
} from '../../services/sanctions.ts';
import { searchTeams } from '../../services/team-staff.ts';
import { suggestDays } from '../day-suggestions.ts';
import { announceReportDecision } from '../staff-decisions.ts';
import {
  discordTime,
  impossibleScore,
  matchFixture,
  matchLabel,
  matchLine,
  notify,
  storedLine,
} from '../match-text.ts';
import { described, english, MAX_CHOICE_LENGTH, MAX_CHOICES, STAFF_ONLY } from './describe.ts';
import {
  announceExclusion,
  exclusionGroup,
  exclusionRule,
  handleExclusionGroup,
} from './exclusion.ts';
import type { Command, CommandContext, CommandInteraction } from './types.ts';

const matchOption = {
  type: ApplicationCommandOptionType.Integer as const,
  name: 'match',
  ...described('command.staff.match.option.match'),
  required: true,
  autocomplete: true,
};

const teamOption = {
  type: ApplicationCommandOptionType.Integer as const,
  name: 'team',
  ...described('command.team.option.team'),
  required: true,
  autocomplete: true,
};
const reasonOption = (key: Parameters<typeof described>[0]) => ({
  type: ApplicationCommandOptionType.String as const,
  name: 'reason',
  ...described(key),
  required: true,
  max_length: 500,
});

// Dates are shown in French time, whatever the server's own zone.
const day = (locale: Locale, at: number) =>
  new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    timeZone: 'Europe/Paris',
    dateStyle: 'short',
  }).format(at);
const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

function sanctionLine(locale: Locale, entry: SanctionEntry): string {
  const kind =
    entry.kind === 'points' && entry.pointsDelta !== null
      ? t(locale, 'sanction.kindPoints', { points: signed(entry.pointsDelta) })
      : entry.kind === 'warning'
        ? t(locale, 'sanction.kind.warning')
        : entry.kind;
  return t(locale, 'sanction.line', { date: day(locale, entry.at), kind, reason: entry.reason });
}

async function sanctionGroup(
  interaction: CommandInteraction,
  context: CommandContext,
): Promise<void> {
  const { locale, db } = context;
  const privately = (content: string) => interaction.reply({ content, ephemeral: true });
  const teamId = interaction.options.getInteger('team');
  if (teamId === null) {
    await privately(t(locale, 'sanction.error.team_not_found'));
    return;
  }

  if (interaction.options.getSubcommand() === 'list') {
    const reply = listSanctions(db, interaction, teamId);
    if (!reply.ok) {
      await privately(t(locale, `sanction.error.${reply.error}`));
      return;
    }
    const team = reply.team.name;
    await privately(
      reply.sanctions.length === 0
        ? t(locale, 'sanction.list.none', { team })
        : [
            t(locale, 'sanction.list.title', { team }),
            ...reply.sanctions.map((entry) => sanctionLine(locale, entry)),
          ].join('\n'),
    );
    return;
  }

  const kind = TEAM_SANCTION_KINDS.find((known) => known === interaction.options.getString('kind'));
  if (interaction.options.getSubcommand() !== 'add' || !kind) {
    await privately(t(locale, 'error.unknownCommand'));
    return;
  }
  const reply = addSanction(
    db,
    interaction,
    {
      teamId,
      kind,
      points: interaction.options.getInteger('points'),
      reason: interaction.options.getString('reason') ?? '',
    },
    context.now(),
  );
  await privately(
    reply.ok
      ? t(locale, 'sanction.added', {
          team: reply.team.name,
          sanction: sanctionLine(locale, reply.sanction),
        })
      : t(locale, `sanction.error.${reply.error}`),
  );
}

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
            name: 'schedule',
            ...described('command.staff.match.schedule.description'),
            options: [
              matchOption,
              {
                type: ApplicationCommandOptionType.String,
                name: 'date',
                ...described('command.match.option.date'),
                required: true,
                autocomplete: true,
                max_length: 10,
              },
              {
                type: ApplicationCommandOptionType.String,
                name: 'time',
                ...described('command.match.option.time'),
                required: true,
                max_length: 5,
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
            options: [matchOption, reasonOption('command.staff.match.void.option.reason')],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: 'forfeit',
            ...described('command.staff.match.forfeit.description'),
            options: [
              matchOption,
              {
                type: ApplicationCommandOptionType.String,
                name: 'team',
                ...described('command.staff.match.forfeit.option.team'),
                required: true,
                choices: (['a', 'b', 'both'] as const).map((side) => ({
                  name: catalogs.fr[`command.staff.match.forfeit.side.${side}`],
                  name_localizations: english(`command.staff.match.forfeit.side.${side}`),
                  value: side,
                })),
              },
            ],
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.SubcommandGroup,
        name: 'sanction',
        ...described('command.staff.sanction.description'),
        options: [
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: 'add',
            ...described('command.staff.sanction.add.description'),
            options: [
              teamOption,
              {
                type: ApplicationCommandOptionType.String,
                name: 'kind',
                ...described('command.staff.sanction.option.kind'),
                required: true,
                choices: TEAM_SANCTION_KINDS.map((kind) => ({
                  name: catalogs.fr[`sanction.kind.${kind}`],
                  name_localizations: english(`sanction.kind.${kind}`),
                  value: kind,
                })),
              },
              reasonOption('command.staff.sanction.option.reason'),
              {
                type: ApplicationCommandOptionType.Integer,
                name: 'points',
                ...described('command.staff.sanction.option.points'),
                required: false,
                min_value: -100,
                max_value: 100,
              },
            ],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: 'list',
            ...described('command.staff.sanction.list.description'),
            options: [teamOption],
          },
        ],
      },
      exclusionGroup,
    ],
  },

  async execute(interaction, context) {
    const { locale, db } = context;
    const privately = (content: string) => interaction.reply({ content, ephemeral: true });
    const action = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup();
    if (group === 'sanction') {
      await sanctionGroup(interaction, context);
      return;
    }
    if (group === 'exclusion') {
      await handleExclusionGroup(interaction, context);
      return;
    }
    if (group !== 'match') {
      await privately(t(locale, 'error.unknownCommand'));
      return;
    }
    const matchId = interaction.options.getInteger('match');
    if (matchId === null) {
      // Free text typed instead of a suggestion never arrives as a number.
      await privately(t(locale, 'match.error.match_not_found'));
      return;
    }

    if (action === 'schedule') {
      const time = readMatchTime(
        db,
        interaction,
        interaction.options.getString('date') ?? '',
        interaction.options.getString('time') ?? '',
      );
      if (!time.ok) {
        await privately(t(locale, `schedule.error.${time.error}`));
        return;
      }
      const reply = setMatchTime(db, interaction, { matchId, at: time.at }, context.now());
      if (!reply.ok) {
        await privately(t(locale, `schedule.error.${reply.error}`));
        return;
      }
      const text = { fixture: matchFixture(locale, reply.match), when: discordTime(reply.at) };
      // The private answer first: the picture takes a moment to draw.
      await privately(t(locale, 'staff.match.scheduled', text));
      await announceWithCard(
        context,
        reply.scheduleChannelId,
        { content: t(locale, 'schedule.announce', text) },
        reply.match.id,
        'time',
      );
      return;
    }

    if (action === 'validate') {
      const reply = validateResult(db, interaction, { matchId }, context.now());
      if (!reply.ok) {
        await privately(t(locale, `match.error.${reply.error}`));
        return;
      }
      await privately(
        t(locale, 'staff.match.validated', { line: storedLine(locale, reply.match) }),
      );
      // The report's posts close, and the result is announced, as from the queue's button.
      await announceReportDecision(context, reply, interaction.user.id);
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
      if (reply.ok) await announceReportDecision(context, reply, interaction.user.id);
      return;
    }

    if (action === 'forfeit') {
      const side = (['a', 'b', 'both'] as const).find(
        (known) => known === interaction.options.getString('team'),
      );
      if (!side) {
        await privately(t(locale, 'error.unknownCommand'));
        return;
      }
      const reply = recordForfeit(
        db,
        interaction,
        {
          matchId,
          side,
          warningReason: (count) => t(locale, 'sanction.reason.forfeits', { count }),
          exclusionReason: (count) => t(locale, 'sanction.reason.exclusion', { count }),
        },
        context.now(),
      );
      if (!reply.ok) {
        await privately(t(locale, `match.error.${reply.error}`));
        return;
      }
      const fixture = matchFixture(locale, reply.match);
      const detailsOf = (outcome: (typeof reply.teams)[number]) => ({
        fixture,
        team: reply.match[outcome.side].name,
        count: outcome.count,
      });
      const both = reply.side === 'both';
      const lines = both ? [t(locale, 'staff.match.forfeitBoth', { fixture })] : [];
      for (const outcome of reply.teams) {
        const details = detailsOf(outcome);
        lines.push(
          t(locale, both ? 'staff.match.forfeitBoth.count' : 'staff.match.forfeit', details),
        );
        if (outcome.excluded) {
          lines.push(t(locale, 'staff.match.forfeit.excluded', details));
        } else if (outcome.consequence === 'exclusion' && outcome.autoExclusionOffReason !== null) {
          lines.push(t(locale, 'staff.match.forfeit.exclusionOff', details));
        } else if (outcome.consequence !== 'none') {
          lines.push(t(locale, `staff.match.forfeit.${outcome.consequence}`, details));
        }
      }
      // The private answer first: the picture and the messages to the team take a moment.
      await privately(lines.join('\n'));
      const [only] = reply.teams;
      await announceWithCard(
        context,
        reply.resultsChannelId,
        {
          content:
            both || !only
              ? t(locale, 'result.announceForfeitBoth', {
                  fixture,
                  teamA: reply.match.a.name,
                  teamB: reply.match.b.name,
                })
              : t(locale, 'result.announceForfeit', detailsOf(only)),
        },
        reply.match.id,
        'result',
      );
      for (const outcome of reply.teams) {
        const details = detailsOf(outcome);
        if (outcome.excluded) {
          await announceExclusion(context, {
            team: details.team,
            reason: t(locale, 'sanction.reason.exclusion', { count: outcome.count }),
            excluded: outcome.excluded,
            resultsChannelId: reply.resultsChannelId,
            queueChannelId: reply.queueChannelId,
            queueContent: t(locale, 'exclusion.queue.auto', {
              ...details,
              rule: exclusionRule(locale, outcome.excluded.summary),
            }),
          });
        } else if (outcome.consequence === 'exclusion') {
          await notify(context, reply.queueChannelId, {
            content:
              outcome.autoExclusionOffReason === null
                ? t(locale, 'queue.exclusion', details)
                : t(locale, 'exclusion.queue.off', {
                    ...details,
                    reason: outcome.autoExclusionOffReason,
                  }),
          });
        }
      }
      return;
    }

    const scoreA = interaction.options.getInteger('score_a');
    const scoreB = interaction.options.getInteger('score_b');
    if (action !== 'result' || scoreA === null || scoreB === null) {
      await privately(t(locale, 'error.unknownCommand'));
      return;
    }
    const screenshot = interaction.options.getAttachment('screenshot');
    const reply = recordResult(
      db,
      interaction,
      { matchId, scoreA, scoreB, screenshot },
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
    // A staff entry counts at once, so it is announced like a validated report.
    const line = matchLine(locale, reply.match, reply);
    await announceWithCard(
      context,
      reply.resultsChannelId,
      {
        content: reply.previous
          ? t(locale, 'result.announceCorrected', {
              line,
              previousA: reply.previous.scoreA,
              previousB: reply.previous.scoreB,
            })
          : t(locale, 'result.announce', { line }),
      },
      reply.match.id,
      'result',
    );
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
    // After the reply: downloading a large screenshot must not keep staff waiting.
    if (screenshot && reply.evidenceId !== null) {
      await fetchAndKeepEvidence(
        db,
        context.gateway,
        context.evidence,
        { evidenceId: reply.evidenceId, matchId: reply.match.id },
        screenshot.url,
      );
    }
  },

  async autocomplete(interaction, context) {
    const action = interaction.options.getSubcommand();
    const query = interaction.focused.value;
    if (interaction.focused.name === 'team') {
      const teams = searchTeams(context.db, interaction, query, MAX_CHOICES);
      await interaction.respond(
        teams.map((team) => ({
          name: `${team.name} (${team.tag}) · ${team.division}`.slice(0, MAX_CHOICE_LENGTH),
          value: team.teamId,
        })),
      );
      return;
    }
    if (interaction.focused.name === 'date') {
      await suggestDays(interaction, context);
      return;
    }
    if (interaction.focused.name !== 'match') {
      await interaction.respond([]);
      return;
    }
    const found =
      action === 'schedule'
        ? searchSchedulableMatches(context.db, interaction, query, MAX_CHOICES)
        : action === 'validate' || action === 'void'
          ? searchMatchesForStaff(context.db, interaction, action, query, MAX_CHOICES)
          : action === 'forfeit'
            ? searchForfeitableMatches(context.db, interaction, query, MAX_CHOICES)
            : searchMatches(context.db, interaction, query, MAX_CHOICES);
    await interaction.respond(
      found.map((candidate) => ({
        name: matchLabel(context.locale, candidate),
        value: candidate.id,
      })),
    );
  },
};
