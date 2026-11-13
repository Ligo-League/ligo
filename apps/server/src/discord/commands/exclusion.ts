import type { ExclusionSummary } from '@ligo/core';
import { ApplicationCommandOptionType } from 'discord.js';
import { t, type Locale } from '../../i18n/index.ts';
import {
  excludeTeam,
  reinstateTeam,
  setAutoExclusion,
  type Excluded,
} from '../../services/exclusions.ts';
import { notify } from '../match-text.ts';
import { described } from './describe.ts';
import type { CommandContext, CommandInteraction, OutgoingMessage } from './types.ts';

// `/staff exclusion` and the messages an exclusion sends (design doc section 5; O-04, O-05).

const teamOption = {
  type: ApplicationCommandOptionType.Integer as const,
  name: 'team',
  ...described('command.team.option.team'),
  required: true,
  autocomplete: true,
};
const reasonOption = {
  type: ApplicationCommandOptionType.String as const,
  name: 'reason',
  ...described('command.staff.exclusion.option.reason'),
  required: true,
  max_length: 500,
};

export const exclusionGroup = {
  type: ApplicationCommandOptionType.SubcommandGroup as const,
  name: 'exclusion',
  ...described('command.staff.exclusion.description'),
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand as const,
      name: 'exclude',
      ...described('command.staff.exclusion.exclude.description'),
      options: [teamOption, reasonOption],
    },
    {
      type: ApplicationCommandOptionType.Subcommand as const,
      name: 'reinstate',
      ...described('command.staff.exclusion.reinstate.description'),
      options: [teamOption, reasonOption],
    },
    {
      type: ApplicationCommandOptionType.Subcommand as const,
      name: 'auto',
      ...described('command.staff.exclusion.auto.description'),
      options: [
        teamOption,
        {
          type: ApplicationCommandOptionType.Boolean as const,
          name: 'enabled',
          ...described('command.staff.exclusion.option.enabled'),
          required: true,
        },
        reasonOption,
      ],
    },
  ],
};

/** How the 50% rule treated the team, in a sentence; empty when it could not be read. */
export function exclusionRule(locale: Locale, summary: ExclusionSummary | null): string {
  if (!summary) return '';
  const counts = { played: summary.played, total: summary.total };
  return t(locale, summary.resultsStand ? 'exclusion.rule.stand' : 'exclusion.rule.void', counts);
}

/** Sends the same direct message to each member; returns how many could not receive it. */
async function tellMembers(
  context: CommandContext,
  memberIds: readonly string[],
  message: OutgoingMessage,
): Promise<number> {
  let failed = 0;
  for (const userId of memberIds) {
    try {
      await context.gateway.sendDirectMessage(userId, message);
    } catch {
      // Closed direct messages are the member's choice: the public announcement still goes out.
      failed += 1;
    }
  }
  return failed;
}

/**
 * Tells everyone an exclusion concerns: the team's manager and staff directly, with the reason
 * and how to appeal; the results channel publicly, without the reason, which can accuse a
 * player; the staff queue, with `queueContent` when given and with any direct message that
 * could not be delivered.
 */
export async function announceExclusion(
  context: CommandContext,
  details: {
    team: string;
    reason: string;
    excluded: Excluded;
    resultsChannelId: string | null;
    queueChannelId: string | null;
    queueContent?: string;
  },
): Promise<void> {
  const { locale } = context;
  const rule = exclusionRule(locale, details.excluded.summary);
  const season = details.excluded.season;
  const failed = await tellMembers(context, details.excluded.memberIds, {
    content: t(locale, 'exclusion.dm', {
      team: details.team,
      season: season.name,
      competition: season.competition,
      reason: details.reason,
      rule,
    }),
  });
  await notify(context, details.resultsChannelId, {
    content: t(locale, 'exclusion.announce', { team: details.team, rule }),
  });
  const queue = [
    details.queueContent,
    failed > 0 ? t(locale, 'exclusion.dmFailed', { team: details.team, count: failed }) : undefined,
  ].filter((line): line is string => line !== undefined);
  if (queue.length > 0) {
    await notify(context, details.queueChannelId, { content: queue.join('\n') });
  }
}

export async function handleExclusionGroup(
  interaction: CommandInteraction,
  context: CommandContext,
): Promise<void> {
  const { locale, db } = context;
  const privately = (content: string) => interaction.reply({ content, ephemeral: true });
  const teamId = interaction.options.getInteger('team');
  if (teamId === null) {
    await privately(t(locale, 'exclusion.error.team_not_found'));
    return;
  }
  const reason = interaction.options.getString('reason') ?? '';
  const action = interaction.options.getSubcommand();

  if (action === 'exclude') {
    const reply = excludeTeam(db, interaction, { teamId, reason }, context.now());
    if (!reply.ok) {
      await privately(t(locale, `exclusion.error.${reply.error}`));
      return;
    }
    const team = reply.team.name;
    // The private answer first: the messages to the team may take a moment, and a deferred
    // answer would be public.
    await privately(
      t(locale, 'exclusion.excluded', {
        team,
        rule: exclusionRule(locale, reply.excluded.summary),
      }),
    );
    await announceExclusion(context, {
      team,
      reason: reply.reason,
      excluded: reply.excluded,
      resultsChannelId: reply.resultsChannelId,
      queueChannelId: reply.queueChannelId,
    });
    return;
  }

  if (action === 'reinstate') {
    const reply = reinstateTeam(db, interaction, { teamId, reason }, context.now());
    if (!reply.ok) {
      await privately(t(locale, `exclusion.error.${reply.error}`));
      return;
    }
    const team = reply.team.name;
    await privately(t(locale, 'exclusion.reinstated', { team }));
    const failed = await tellMembers(context, reply.memberIds, {
      content: t(locale, 'exclusion.dmReinstated', { team, reason: reply.reason }),
    });
    await notify(context, reply.resultsChannelId, {
      content: t(locale, 'exclusion.announceReinstated', { team }),
    });
    if (failed > 0) {
      await notify(context, reply.queueChannelId, {
        content: t(locale, 'exclusion.dmFailed', { team, count: failed }),
      });
    }
    return;
  }

  const enabled = interaction.options.getBoolean('enabled');
  if (action !== 'auto' || enabled === null) {
    await privately(t(locale, 'error.unknownCommand'));
    return;
  }
  const reply = setAutoExclusion(db, interaction, { teamId, enabled, reason }, context.now());
  await privately(
    reply.ok
      ? t(locale, reply.enabled ? 'exclusion.autoOn' : 'exclusion.autoOff', {
          team: reply.team.name,
          reason: reply.reason,
        })
      : t(locale, `exclusion.error.${reply.error}`),
  );
}
