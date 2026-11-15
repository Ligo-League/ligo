import { t, type Locale } from '../i18n/index.ts';
import type { PostRef } from '../services/queue-posts.ts';
import type { StaffStepReply } from '../services/reports.ts';
import type { AnswerReply } from '../services/requests.ts';
import type { CommandContext, OutgoingMessage } from './commands/types.ts';
import { announceWithCard } from './match-card.ts';
import { disputeQueueMessage, mention, notify, storedLine } from './match-text.ts';
import { announceDecision } from './request-text.ts';

// What follows a staff decision, the same wherever staff took it: a button in the staff queue or
// the website. The decision is stored first; nothing here can undo it.

type Announcer = Pick<CommandContext, 'db' | 'gateway' | 'assets' | 'locale'>;
type Decided = Extract<StaffStepReply, { ok: true }>;

const DECIDED = { validated: 'validated', scheduled: 'rejected', void: 'voided' } as const;

/**
 * A report's posts once staff validated it, refused it (the match back to `scheduled`) or
 * annulled the match: the decision, without buttons.
 */
export function reportDecisionMessage(
  locale: Locale,
  reply: Decided,
  staffUserId: string,
): OutgoingMessage {
  const values = { line: storedLine(locale, reply.match), member: mention(staffUserId) };
  return { content: t(locale, `queue.${DECIDED[reply.status]}`, values) };
}

async function edit(context: Announcer, post: PostRef, message: OutgoingMessage): Promise<void> {
  try {
    await context.gateway.editMessage(post.channelId, post.messageId, message);
  } catch {
    // A post deleted or out of reach only looks out of date: the decision is stored.
  }
}

/**
 * After staff validate or refuse a report, or annul the match: every queue post about it and
 * its public post say so and lose their buttons, the disputes' posts keep the team's words with
 * the decision added, and a validated result is announced.
 */
export async function announceReportDecision(
  context: Announcer,
  reply: Decided,
  staffUserId: string,
): Promise<void> {
  const { locale } = context;
  const marked = reportDecisionMessage(locale, reply, staffUserId);
  for (const post of reply.posts) await edit(context, post, marked);
  if (reply.post) await edit(context, reply.post, marked);
  const line = storedLine(locale, reply.match);
  const outcome = t(locale, `queue.outcome.${DECIDED[reply.status]}`, {
    member: mention(staffUserId),
  });
  for (const dispute of reply.disputes) {
    const message = disputeQueueMessage(locale, line, dispute.raisedBy, dispute, outcome);
    for (const post of dispute.posts) await edit(context, post, message);
  }
  if (reply.status === 'validated') {
    await announceWithCard(
      context,
      reply.resultsChannelId,
      { content: t(locale, 'result.announce', { line }) },
      reply.match.id,
      'result',
    );
  }
}

/**
 * After staff answer a team request: its queue posts show the decision, the people concerned are
 * told directly, and the staff queue hears of any direct message that could not be delivered.
 */
export async function announceRequestDecision(
  context: Announcer,
  reply: Extract<AnswerReply, { ok: true }>,
): Promise<void> {
  const failed = await announceDecision(context, reply);
  if (failed > 0) {
    await notify(context, reply.queueChannelId, {
      content: t(context.locale, 'request.dmFailed', { id: reply.request.id, count: failed }),
    });
  }
}
