import { t, type Locale } from '../i18n/index.ts';
import type { PostRef } from '../services/queue-posts.ts';
import type { PersonRef, RequestView } from '../services/requests.ts';
import { buttonId } from './button-id.ts';
import type { CommandContext, OutgoingMessage } from './commands/types.ts';
import { discordTime, mention } from './match-text.ts';

// How a team request reads in Discord: in the staff queue, in replies and in direct messages.
// Mentions show names without notifying anyone unless a message says otherwise.

const nameOf = (person: PersonRef) =>
  person.discordUserId ? mention(person.discordUserId) : person.displayName;

/** What the request asks, in a sentence: "Ajouter @X comme coach." */
export function requestWhat(locale: Locale, request: RequestView): string {
  const subject = nameOf(request.subject);
  if (request.kind === 'team_owner') return t(locale, 'request.what.owner', { subject });
  if (request.kind === 'team_member_add') {
    const role = t(locale, `team.role.${request.role ?? 'manager'}`).toLowerCase();
    return t(locale, 'request.what.add', { subject, role });
  }
  return request.subject.playerId === request.requester.playerId
    ? t(locale, 'request.what.leave', { subject })
    : t(locale, 'request.what.remove', { subject });
}

/** The line a request ends with once decided, or nothing while it waits. */
function outcome(locale: Locale, request: RequestView): string {
  const by = request.decidedBy ? nameOf(request.decidedBy) : '?';
  if (request.status === 'approved') return t(locale, 'request.outcome.approved', { by });
  if (request.status === 'rejected') {
    return t(locale, 'request.outcome.rejected', { by, reason: request.reason ?? '' });
  }
  if (request.status === 'withdrawn') return t(locale, 'request.outcome.withdrawn', { by });
  return '';
}

/**
 * The request's post in the staff queue: what is asked, by whom, by when, and the team's note.
 * While it waits, it carries the Approve and Refuse buttons; once decided, its outcome instead.
 */
export function requestQueueMessage(locale: Locale, request: RequestView): OutgoingMessage {
  const lines = [
    t(locale, 'request.queue.title', {
      id: request.id,
      team: request.team.name,
      tag: request.team.tag,
    }),
    requestWhat(locale, request),
    request.deadline === null
      ? t(locale, 'request.queue.by', { requester: nameOf(request.requester) })
      : t(locale, 'request.queue.byWithDeadline', {
          requester: nameOf(request.requester),
          deadline: discordTime(request.deadline),
        }),
  ];
  // A block quote keeps the team's own words apart from the bot's.
  if (request.note) lines.push(`>>> ${request.note}`);
  const decided = outcome(locale, request);
  if (decided) {
    // The outcome goes above the note, which runs to the end of the message.
    lines.splice(request.note ? -1 : lines.length, 0, decided);
    return { content: lines.join('\n') };
  }
  return {
    content: lines.join('\n'),
    buttons: [
      {
        customId: buttonId('request-approve', request.id, 0),
        label: t(locale, 'request.button.approve'),
        style: 'success',
      },
      {
        customId: buttonId('request-reject', request.id, 0),
        label: t(locale, 'request.button.reject'),
        style: 'danger',
      },
    ],
  };
}

/** A notice in the staff queue for a change that applied at once: nothing to decide. */
export function appliedNotice(locale: Locale, request: RequestView): OutgoingMessage {
  return {
    content: t(locale, 'request.queue.applied', {
      team: request.team.name,
      tag: request.team.tag,
      what: requestWhat(locale, request),
      requester: nameOf(request.requester),
    }),
  };
}

/** The direct message telling the team of a decision. */
export function decisionMessage(locale: Locale, request: RequestView): OutgoingMessage {
  const values = { id: request.id, team: request.team.name, what: requestWhat(locale, request) };
  return {
    content:
      request.status === 'rejected'
        ? t(locale, 'request.dm.rejected', { ...values, reason: request.reason ?? '' })
        : t(locale, 'request.dm.approved', values),
  };
}

/** Where a post is, as a link Discord opens. */
export const postLink = (guildId: string, post: PostRef) =>
  `https://discord.com/channels/${guildId}/${post.channelId}/${post.messageId}`;

/**
 * Marks the request's posts in the staff queue as decided, and tells the people concerned
 * directly. Returns how many of them could not be told, for the staff queue to know.
 */
export async function announceDecision(
  context: CommandContext,
  decided: { request: RequestView; posts: readonly PostRef[]; recipientIds: readonly string[] },
): Promise<number> {
  const { locale } = context;
  const marked = requestQueueMessage(locale, decided.request);
  // The post that was clicked is among them: updating it twice is harmless.
  for (const post of decided.posts) {
    try {
      await context.gateway.editMessage(post.channelId, post.messageId, marked);
    } catch {
      // The decision is stored; a post that could not be updated only looks out of date.
    }
  }
  let failed = 0;
  for (const userId of decided.recipientIds) {
    try {
      await context.gateway.sendDirectMessage(userId, decisionMessage(locale, decided.request));
    } catch {
      // Closed direct messages are the member's choice.
      failed += 1;
    }
  }
  return failed;
}

/** One line per request in a list: number, team, what, and by when staff answer. */
export function requestLine(locale: Locale, request: RequestView, now: number): string {
  const what = requestWhat(locale, request);
  const base = t(locale, 'request.list.line', {
    id: request.id,
    tag: request.team.tag,
    what,
    at: discordTime(request.requestedAt, 'R'),
  });
  if (request.deadline === null) return base;
  const key = request.deadline < now ? 'request.list.overdue' : 'request.list.deadline';
  return `${base} ${t(locale, key, { deadline: discordTime(request.deadline, 'R') })}`;
}
