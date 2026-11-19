import { t, type Locale } from '../i18n/index.ts';
import type { CloseWindowReply, OpenWindowReply } from '../services/mercato-windows.ts';
import { queuePostsOf } from '../services/queue-posts.ts';
import type { FileMoveReply, MoveView, WithdrawMoveReply } from '../services/roster-moves.ts';
import type { CommandContext } from './commands/types.ts';
import { discordTime, notify, notifyQueue, pageLink } from './match-text.ts';

// What the league's `#mercato` channel shows of its windows (design doc section 7): when staff
// open one, with its dates, limit and block, and when they close it early. These posts mention
// nobody, since every team is concerned. Without a `#mercato` channel, nothing is posted: the
// website shows the windows anyway.

type Poster = Pick<CommandContext, 'gateway' | 'locale'>;

/** The window's rules in a sentence or two: the move limit, then the block when there is one. */
function windowRules(
  locale: Locale,
  window: { maxMovesPerTeam: number | null; lockHours: number },
): string {
  const limit =
    window.maxMovesPerTeam === null
      ? t(locale, 'mercato.window.noLimit')
      : t(locale, 'mercato.window.limit', { count: window.maxMovesPerTeam });
  return window.lockHours === 0
    ? limit
    : `${limit} ${t(locale, 'mercato.window.lock', { hours: window.lockHours })}`;
}

export async function announceWindowOpened(
  context: Poster,
  reply: Extract<OpenWindowReply, { ok: true }>,
): Promise<boolean> {
  const { locale } = context;
  return notify(context, reply.mercatoChannelId, {
    content: t(locale, 'mercato.window.opened', {
      competition: reply.competition.name,
      season: reply.season.name,
      from: discordTime(reply.window.opensAt),
      to: discordTime(reply.window.closesAt),
      rules: windowRules(locale, reply.window),
    }),
  });
}

export async function announceWindowClosed(
  context: Poster,
  reply: Extract<CloseWindowReply, { ok: true }>,
): Promise<boolean> {
  const { locale } = context;
  const { window } = reply;
  return notify(context, reply.mercatoChannelId, {
    content: reply.wasOpen
      ? t(locale, 'mercato.window.closed', { to: discordTime(window.closesAt) })
      : t(locale, 'mercato.window.cancelled', {
          from: discordTime(window.opensAt),
          to: discordTime(window.closesAt),
        }),
  });
}

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

/**
 * A move filed: the staff queue hears of it, with a link to where staff answer it. The post is
 * kept, so a later decision or withdrawal can mark it.
 */
export async function announceMoveFiled(
  context: Pick<CommandContext, 'db' | 'gateway' | 'now' | 'locale'>,
  reply: Extract<FileMoveReply, { ok: true }>,
  publicUrl: URL,
): Promise<boolean> {
  const { locale } = context;
  return notifyQueue(
    context,
    reply.queueChannelId,
    {
      content: t(locale, 'mercato.move.filed', {
        team: reply.team.name,
        move: moveLine(locale, reply.move),
        member: reply.move.requester,
        link: pageLink(publicUrl, `/teams/${reply.team.slug}/mercato`),
      }),
    },
    { entity: 'request', entityId: reply.move.id },
  );
}

/** A move taken back: its staff queue posts say so, so nobody answers it. */
export async function announceMoveWithdrawn(
  context: Pick<CommandContext, 'db' | 'gateway' | 'locale'>,
  reply: Extract<WithdrawMoveReply, { ok: true }>,
  team: string,
): Promise<void> {
  const { locale } = context;
  const content = t(locale, 'mercato.move.withdrawn', {
    team,
    move: moveLine(locale, reply.move),
  });
  for (const post of queuePostsOf(context.db, { entity: 'request', entityId: reply.move.id })) {
    try {
      await context.gateway.editMessage(post.channelId, post.messageId, { content });
    } catch {
      // A post deleted or out of reach only looks out of date: the move is withdrawn.
    }
  }
}
