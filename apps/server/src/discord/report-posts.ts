import { t, type Locale, type MessageKey } from '../i18n/index.ts';
import {
  recordReportPost,
  type AnswerReply,
  type ReportDetails,
  type ReportReply,
} from '../services/reports.ts';
import { buttonId } from './button-id.ts';
import type { CommandContext, MessageButton, OutgoingMessage } from './commands/types.ts';
import { announceWithCard } from './match-card.ts';
import {
  disputeQueueMessage,
  matchLine,
  mention,
  notifyQueue,
  pageLink,
  storedLine,
} from './match-text.ts';

// What Discord shows of a result report, the same wherever the team acted: `/match report` and
// its buttons, or the match page (phase 3e, M-32). The report or answer is stored first; nothing
// here can undo it.

type Poster = Pick<CommandContext, 'db' | 'gateway' | 'assets' | 'locale' | 'now'> & {
  publicUrl?: URL;
};
type Reported = Extract<ReportReply, { ok: true }>;
type Answered = Extract<AnswerReply, { ok: true }>;
type ButtonKind = 'confirm' | 'dispute' | 'validate' | 'reject';

/** The buttons under a report: the other team's, then the staff's in the queue. */
export function reportButtons(
  locale: Locale,
  report: Pick<ReportDetails, 'match' | 'evidenceId'>,
  audience: 'opponent' | 'staff',
): MessageButton[] {
  const button = (kind: ButtonKind, style: MessageButton['style']): MessageButton => ({
    customId: buttonId(`report-${kind}`, report.match.id, report.evidenceId),
    label: t(locale, `report.button.${kind}`),
    style,
  });
  return audience === 'opponent'
    ? [button('confirm', 'success'), button('dispute', 'danger')]
    : [button('validate', 'success'), button('reject', 'danger')];
}

/** The report's post in the staff queue, with the staff's buttons. */
export function reportQueueMessage(
  locale: Locale,
  report: ReportDetails,
  reporterUserId: string,
): OutgoingMessage {
  return {
    content: t(locale, 'queue.report', {
      line: matchLine(locale, report.match, report),
      reporter: mention(reporterUserId),
      team: report.match[report.side].name,
    }),
    buttons: reportButtons(locale, report, 'staff'),
  };
}

/** The report for the other team: the screenshot, its two buttons, its officials mentioned. */
export function reportPostMessage(
  locale: Locale,
  reply: Reported,
  reporterUserId: string,
  publicUrl: URL | undefined,
): OutgoingMessage {
  const { opponentIds } = reply;
  const text = {
    reporter: mention(reporterUserId),
    team: reply.match[reply.side].name,
    line: matchLine(locale, reply.match, reply),
  };
  const posted =
    opponentIds.length > 0
      ? t(locale, 'report.posted', { ...text, opponents: opponentIds.map(mention).join(' ') })
      : t(locale, 'report.postedNoOpponent', text);
  const lines = [posted];
  if (!reply.queued) lines.push(t(locale, 'report.notQueued'));
  if (publicUrl) {
    lines.push(
      t(locale, 'match.pageLink', {
        url: pageLink(publicUrl, `/matches/${String(reply.match.id)}`),
      }),
    );
  }
  return {
    content: lines.join('\n'),
    files: [reply.screenshot],
    buttons: reportButtons(locale, reply, 'opponent'),
    mentionUserIds: opponentIds,
  };
}

/** Posts the report in a channel and keeps where; false when Discord refused it. */
export async function postReport(
  context: Poster,
  channelId: string,
  reply: Reported,
  reporterUserId: string,
): Promise<boolean> {
  try {
    const post = await context.gateway.postMessage(
      channelId,
      reportPostMessage(context.locale, reply, reporterUserId, context.publicUrl),
    );
    recordReportPost(context.db, reply.evidenceId, { channelId, messageId: post.messageId });
    return true;
  } catch {
    // The report is stored; the match page shows it to both teams.
    return false;
  }
}

/**
 * The report's post once answered, without its buttons. It names no dispute reason: a reason can
 * accuse a player, and staff decide.
 */
export function answeredReportMessage(
  locale: Locale,
  reply: Answered,
  memberUserId: string,
): OutgoingMessage {
  return {
    content: t(locale, `report.${reply.status}`, {
      line: storedLine(locale, reply.match),
      member: mention(memberUserId),
    }),
  };
}

/**
 * After the other team answers a report: its public post shows the answer (unless the click
 * that answered already replaced it), and staff hear of it. A validated result is announced.
 */
export async function announceReportAnswer(
  context: Poster,
  reply: Answered,
  memberUserId: string,
  options: { editPost: boolean },
): Promise<void> {
  const { locale } = context;
  if (options.editPost && reply.post) {
    try {
      await context.gateway.editMessage(
        reply.post.channelId,
        reply.post.messageId,
        answeredReportMessage(locale, reply, memberUserId),
      );
    } catch {
      // A post deleted or out of reach only looks out of date: the answer is stored.
    }
  }
  const line = storedLine(locale, reply.match);
  const member = mention(memberUserId);
  if (reply.status === 'validated') {
    // The report's post in the staff queue no longer waits for staff: it says so, without buttons.
    for (const post of reply.posts) {
      try {
        await context.gateway.editMessage(post.channelId, post.messageId, {
          content: t(locale, 'queue.validatedByOpponent', { line, member }),
        });
      } catch {
        // A post deleted or out of reach only looks out of date: the result is stored.
      }
    }
    await announceWithCard(
      context,
      reply.resultsChannelId,
      { content: t(locale, 'result.announce', { line }) },
      reply.match.id,
      'result',
    );
    return;
  }
  if (reply.dispute) {
    await notifyQueue(
      context,
      reply.queueChannelId,
      disputeQueueMessage(locale, line, memberUserId, reply.dispute),
      { entity: 'dispute', entityId: reply.dispute.id },
    );
    return;
  }
  // A confirmation that would have validated, waiting for MOSS files: staff see why it waits.
  const key: MessageKey =
    reply.waiting.length > 0 ? 'queue.confirmedWaitingMoss' : `queue.${reply.status}`;
  await notifyQueue(
    context,
    reply.queueChannelId,
    { content: t(locale, key, { line, member }) },
    { entity: 'match', entityId: reply.match.id },
  );
}
