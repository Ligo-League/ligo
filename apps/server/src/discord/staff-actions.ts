import type { ExclusionSummary } from '@ligo/core';
import { t, type Locale } from '../i18n/index.ts';
import type { Excluded, ReinstateReply } from '../services/exclusions.ts';
import type { ForfeitReply } from '../services/forfeits.ts';
import type { RecordResultReply } from '../services/results.ts';
import type { SetTimeReply } from '../services/scheduling.ts';
import type { CommandContext, OutgoingMessage } from './commands/types.ts';
import { announceWithCard } from './match-card.ts';
import { discordTime, matchFixture, matchLine, mention, notify, storedLine } from './match-text.ts';
import { closeOpenReport } from './staff-decisions.ts';

// What Discord shows after a staff action on a match, taken on the website (phase 3f; design doc
// section 3): the result or forfeit announced with its picture, an exclusion told to the team and
// to staff, a new time announced, and what the action superseded closed. The action is stored
// first; nothing here can undo it.

type Announcer = Pick<CommandContext, 'db' | 'gateway' | 'assets' | 'locale'>;

/** A staff entry or correction: it counts at once, so it is announced like a validated report. */
export async function announceStaffResult(
  context: Announcer,
  reply: Extract<RecordResultReply, { ok: true }>,
  staffUserId: string,
): Promise<void> {
  const { locale } = context;
  const line = matchLine(locale, reply.match, reply);
  const member = mention(staffUserId);
  await closeOpenReport(
    context,
    reply,
    {
      content: t(locale, 'queue.entered', {
        line: storedLine(locale, reply.match),
        member,
        result: line,
      }),
    },
    {
      line: storedLine(locale, reply.match),
      outcome: t(locale, 'queue.outcome.entered', { member, result: line }),
    },
  );
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
}

/**
 * A forfeit: the report it replaces closes, the forfeit is announced, and a team reaching the
 * exclusion threshold is excluded and told, or staff are alerted when its automatic exclusion is
 * off or it was already excluded.
 */
export async function announceForfeit(
  context: Announcer,
  reply: Extract<ForfeitReply, { ok: true }>,
  staffUserId: string,
): Promise<void> {
  const { locale } = context;
  const fixture = matchFixture(locale, reply.match);
  const member = mention(staffUserId);
  await closeOpenReport(
    context,
    reply,
    { content: t(locale, 'queue.forfeited', { line: storedLine(locale, reply.match), member }) },
    {
      line: storedLine(locale, reply.match),
      outcome: t(locale, 'queue.outcome.forfeited', { member }),
    },
  );
  const detailsOf = (outcome: (typeof reply.teams)[number]) => ({
    fixture,
    team: reply.match[outcome.side].name,
    count: outcome.count,
  });
  const [only] = reply.teams;
  await announceWithCard(
    context,
    reply.resultsChannelId,
    {
      content:
        reply.side === 'both' || !only
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
}

/** A time set by staff: the proposals it ended lose their buttons, and the time is announced. */
export async function announceMatchTime(
  context: Announcer,
  reply: Extract<SetTimeReply, { ok: true }>,
): Promise<void> {
  const { locale } = context;
  const fixture = matchFixture(locale, reply.match);
  for (const proposal of reply.withdrawn) {
    try {
      await context.gateway.editMessage(proposal.post.channelId, proposal.post.messageId, {
        content: t(locale, 'schedule.superseded', { fixture, when: discordTime(proposal.at) }),
      });
    } catch {
      // A post deleted or out of reach only looks out of date: the time is stored.
    }
  }
  await announceWithCard(
    context,
    reply.scheduleChannelId,
    { content: t(locale, 'schedule.announce', { fixture, when: discordTime(reply.at) }) },
    reply.match.id,
    'time',
  );
}

/** How the 50% rule treated the team, in a sentence; empty when it could not be read. */
export function exclusionRule(locale: Locale, summary: ExclusionSummary | null): string {
  if (!summary) return '';
  const counts = { played: summary.played, total: summary.total };
  return t(locale, summary.resultsStand ? 'exclusion.rule.stand' : 'exclusion.rule.void', counts);
}

/** Sends the same direct message to each member; returns how many could not receive it. */
async function tellMembers(
  context: Announcer,
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
 * Tells everyone an exclusion concerns: the team's officials directly, with the reason and how to
 * appeal; the results channel publicly, without the reason, which can accuse a player; the staff
 * queue, with `queueContent` when given and with any direct message that could not be delivered.
 */
export async function announceExclusion(
  context: Announcer,
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

/**
 * A team reinstated on appeal: its officials are told directly with the reason, the results
 * channel announces it, and staff hear of any direct message that could not be delivered.
 */
export async function announceReinstatement(
  context: Announcer,
  reply: Extract<ReinstateReply, { ok: true }>,
): Promise<void> {
  const { locale } = context;
  const team = reply.team.name;
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
}
