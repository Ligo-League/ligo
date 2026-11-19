import { t, type Locale } from '../i18n/index.ts';
import { queuePostsOf } from '../services/queue-posts.ts';
import type { AppliedMove, DecideMoveReply } from '../services/roster-move-apply.ts';
import type { FileMoveReply, MoveView, WithdrawMoveReply } from '../services/roster-moves.ts';
import { buttonId } from './button-id.ts';
import type { CommandContext, OutgoingMessage } from './commands/types.ts';
import { discordTime, mention, notify, notifyQueue, pageLink } from './match-text.ts';

// What Discord shows of a mercato move (design doc section 7; O-35): its post in the staff
// queue, with Validate and Refuse while it waits; the decision on every such post; the approved
// move in the league's `#mercato`, mentioning nobody; and direct messages to whoever asked and,
// for a transfer, to the officials of the roster the player left.

type Poster = Pick<CommandContext, 'db' | 'gateway' | 'locale'>;

/** A move in words: "P7 remplace P5", "arrivée de P7 (remplaçant)", "départ de P5". */
export function moveLine(locale: Locale, move: Pick<MoveView, 'in' | 'out' | 'from'>): string {
  const from = move.from === null ? '' : ` ${t(locale, 'mercato.move.from', { team: move.from })}`;
  if (move.in && move.out) {
    return t(locale, 'mercato.move.swap', { in: move.in.name, out: move.out.name }) + from;
  }
  if (move.in) {
    const role = t(locale, `mercato.role.${move.in.role}`);
    return t(locale, 'mercato.move.in', { in: move.in.name, role }) + from;
  }
  return t(locale, 'mercato.move.out', { out: move.out?.name ?? '?' });
}

/** How a move ended, under its post; empty while it waits. */
function outcomeLine(locale: Locale, move: MoveView, decidedBy: string | null): string {
  const by = decidedBy === null ? '' : mention(decidedBy);
  if (move.status === 'approved') {
    if (move.exceptionReason !== null) {
      return t(locale, 'mercato.outcome.exception', { member: by, reason: move.exceptionReason });
    }
    return decidedBy === null
      ? t(locale, 'mercato.outcome.auto')
      : t(locale, 'mercato.outcome.approved', { member: by });
  }
  if (move.status === 'rejected') {
    return t(locale, 'mercato.outcome.rejected', { member: by, reason: move.reason ?? '' });
  }
  if (move.status === 'withdrawn') return t(locale, 'mercato.outcome.withdrawn');
  return '';
}

/**
 * The move's post in the staff queue: what is asked, by whom, the team's note and its page. While
 * it waits, it carries Validate and Refuse; once decided, its outcome instead.
 */
export function moveQueueMessage(
  locale: Locale,
  details: { team: { name: string; slug: string }; move: MoveView; publicUrl: URL },
  decidedBy: string | null = null,
): OutgoingMessage {
  const { move } = details;
  const lines = [
    t(locale, 'mercato.move.queue', {
      team: details.team.name,
      move: moveLine(locale, move),
      member: move.requester,
      link: pageLink(details.publicUrl, `/teams/${details.team.slug}/mercato`),
    }),
  ];
  if (!move.counted) lines.push(t(locale, 'mercato.move.notCounted'));
  // A block quote keeps the team's own words apart from the bot's.
  if (move.note) lines.push(`>>> ${move.note}`);
  const outcome = outcomeLine(locale, move, decidedBy);
  if (outcome) {
    lines.splice(move.note ? -1 : lines.length, 0, outcome);
    return { content: lines.join('\n') };
  }
  return {
    content: lines.join('\n'),
    buttons: [
      {
        customId: buttonId('move-approve', move.id, 0),
        label: t(locale, 'mercato.button.approve'),
        style: 'success',
      },
      {
        customId: buttonId('move-reject', move.id, 0),
        label: t(locale, 'mercato.button.reject'),
        style: 'danger',
      },
    ],
  };
}

/** Sends a direct message to each; returns how many could not receive it. */
async function tell(
  context: Poster,
  userIds: readonly string[],
  message: OutgoingMessage,
): Promise<number> {
  let failed = 0;
  for (const userId of userIds) {
    try {
      await context.gateway.sendDirectMessage(userId, message);
    } catch {
      // Closed direct messages are the member's choice: the team's page shows the outcome.
      failed += 1;
    }
  }
  return failed;
}

/** An applied move: `#mercato` announces it, and a transferred player's old roster is told. */
async function announceApplied(
  context: Poster,
  details: {
    competition: string;
    team: string;
    move: MoveView;
    applied: AppliedMove;
    mercatoChannelId: string | null;
  },
): Promise<void> {
  const { locale } = context;
  const { move, applied } = details;
  const starts =
    move.in && applied.startsAt !== null
      ? ` ${t(locale, 'mercato.announce.startsAt', {
          player: move.in.name,
          when: discordTime(applied.startsAt),
        })}`
      : '';
  await notify(context, details.mercatoChannelId, {
    content:
      t(locale, 'mercato.announce', {
        competition: details.competition,
        team: details.team,
        move: moveLine(locale, move),
      }) + starts,
  });
  const from = applied.fromTeam;
  if (from && move.in) {
    const lines = [
      t(locale, 'mercato.dm.transferred', {
        player: move.in.name,
        team: from.name,
        to: details.team,
      }),
    ];
    if (from.lostCaptain) lines.push(t(locale, 'mercato.dm.lostCaptain', { team: from.name }));
    await tell(context, from.officials, { content: lines.join('\n') });
  }
}

/**
 * A move filed: the staff queue gets its post, kept so a later decision marks it. A move applied
 * at once (a staff exception, or a league approving moves automatically) is announced too.
 */
export async function announceMoveFiled(
  context: Pick<CommandContext, 'db' | 'gateway' | 'now' | 'locale'>,
  reply: Extract<FileMoveReply, { ok: true }>,
  publicUrl: URL,
  staffUserId: string | null = null,
): Promise<boolean> {
  const message = moveQueueMessage(
    context.locale,
    { team: reply.team, move: reply.move, publicUrl },
    reply.move.exceptionReason === null ? null : staffUserId,
  );
  const posted = await notifyQueue(context, reply.queueChannelId, message, {
    entity: 'request',
    entityId: reply.move.id,
  });
  if (reply.applied) {
    await announceApplied(context, {
      competition: reply.competition.name,
      team: reply.team.name,
      move: reply.move,
      applied: reply.applied,
      mercatoChannelId: reply.mercatoChannelId,
    });
  }
  return posted;
}

/** Edits every post about the move to `message`; a post out of reach is left as it is. */
async function editPosts(context: Poster, moveId: number, message: OutgoingMessage) {
  for (const post of queuePostsOf(context.db, { entity: 'request', entityId: moveId })) {
    try {
      await context.gateway.editMessage(post.channelId, post.messageId, message);
    } catch {
      // A post deleted or out of reach only looks out of date: the decision is stored.
    }
  }
}

/** A move taken back: its staff queue posts say so, so nobody answers it. */
export async function announceMoveWithdrawn(
  context: Poster,
  reply: Extract<WithdrawMoveReply, { ok: true }>,
  team: { name: string; slug: string },
  publicUrl: URL,
): Promise<void> {
  await editPosts(
    context,
    reply.move.id,
    moveQueueMessage(context.locale, { team, move: reply.move, publicUrl }),
  );
}

/**
 * Staff decided: every queue post shows it, an approved move is announced, and whoever asked
 * hears of it directly; staff hear of a message that could not be delivered.
 */
export async function announceMoveDecision(
  context: Poster,
  reply: Extract<DecideMoveReply, { ok: true }>,
  staffUserId: string,
  publicUrl: URL,
): Promise<void> {
  const { locale } = context;
  await editPosts(
    context,
    reply.move.id,
    moveQueueMessage(locale, { team: reply.team, move: reply.move, publicUrl }, staffUserId),
  );
  if (reply.applied) {
    await announceApplied(context, {
      competition: reply.competition.name,
      team: reply.team.name,
      move: reply.move,
      applied: reply.applied,
      mercatoChannelId: reply.mercatoChannelId,
    });
  }
  const line = moveLine(locale, reply.move);
  const dm =
    reply.decision === 'approve'
      ? t(locale, 'mercato.dm.approved', { team: reply.team.name, move: line })
      : t(locale, 'mercato.dm.rejected', {
          team: reply.team.name,
          move: line,
          reason: reply.move.reason ?? '',
        });
  const failed =
    reply.requesterDiscordId === null
      ? 0
      : await tell(context, [reply.requesterDiscordId], { content: dm });
  if (failed > 0) {
    await notify(context, reply.queueChannelId, {
      content: t(locale, 'mercato.dmFailed', { team: reply.team.name }),
    });
  }
}
