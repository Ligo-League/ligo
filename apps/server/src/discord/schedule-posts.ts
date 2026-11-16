import { t, type Locale } from '../i18n/index.ts';
import {
  recordProposalPost,
  type AnswerProposalReply,
  type ProposeReply,
} from '../services/scheduling.ts';
import { buttonId } from './button-id.ts';
import type { CommandContext, OutgoingMessage } from './commands/types.ts';
import { announceWithCard } from './match-card.ts';
import { discordTime, matchFixture, mention, pageLink } from './match-text.ts';

// What Discord shows of a proposed time, the same wherever the team acted: `/match propose-time`
// or the match page (M-32). The proposal is stored first; nothing here can undo it.

type Poster = Pick<CommandContext, 'db' | 'gateway' | 'assets' | 'locale'> & { publicUrl?: URL };
type Proposed = Extract<ProposeReply, { ok: true }>;
type Answered = Extract<AnswerProposalReply, { ok: true }>;

export function proposalButtons(locale: Locale, matchId: number, proposalId: number) {
  return [
    {
      customId: buttonId('time-accept', matchId, proposalId),
      label: t(locale, 'schedule.button.accept'),
      style: 'success' as const,
    },
    {
      customId: buttonId('time-decline', matchId, proposalId),
      label: t(locale, 'schedule.button.decline'),
      style: 'danger' as const,
    },
  ];
}

/** The proposal, mentioning the other side's officials and captain, with their two buttons. */
function proposalMessage(
  locale: Locale,
  reply: Proposed,
  proposerUserId: string,
  publicUrl: URL | undefined,
): OutgoingMessage {
  const { opponentIds } = reply;
  const text = {
    proposer: mention(proposerUserId),
    team: reply.match[reply.side].name,
    fixture: matchFixture(locale, reply.match),
    when: discordTime(reply.at),
  };
  const lines = [
    opponentIds.length > 0
      ? t(locale, 'schedule.proposed', { ...text, opponents: opponentIds.map(mention).join(' ') })
      : t(locale, 'schedule.proposedNoOpponent', text),
  ];
  if (publicUrl) {
    lines.push(
      t(locale, 'match.pageLink', {
        url: pageLink(publicUrl, `/matches/${String(reply.match.id)}`),
      }),
    );
  }
  return {
    content: lines.join('\n'),
    buttons: proposalButtons(locale, reply.match.id, reply.proposalId),
    mentionUserIds: opponentIds,
  };
}

/** Posts the proposal in a channel and keeps where; false when Discord refused it. */
export async function postProposal(
  context: Poster,
  channelId: string,
  reply: Proposed,
  proposerUserId: string,
): Promise<boolean> {
  try {
    const post = await context.gateway.postMessage(
      channelId,
      proposalMessage(context.locale, reply, proposerUserId, context.publicUrl),
    );
    recordProposalPost(context.db, reply.proposalId, { channelId, messageId: post.messageId });
    return true;
  } catch {
    // The proposal is stored; the match page shows it to both teams.
    return false;
  }
}

/** The proposal's post once answered: the answer, without buttons. */
export function answeredMessage(
  locale: Locale,
  reply: Answered,
  answererUserId: string,
): OutgoingMessage {
  return {
    content: t(locale, `schedule.${reply.status}`, {
      fixture: matchFixture(locale, reply.match),
      when: discordTime(reply.at),
      member: mention(answererUserId),
    }),
  };
}

/**
 * After a proposal is answered: its post shows the answer and loses its buttons, and an agreed
 * time is announced in the schedule channel.
 */
export async function announceAnswer(
  context: Poster,
  reply: Answered,
  answererUserId: string,
): Promise<void> {
  const { locale } = context;
  if (reply.post) {
    try {
      await context.gateway.editMessage(
        reply.post.channelId,
        reply.post.messageId,
        answeredMessage(locale, reply, answererUserId),
      );
    } catch {
      // A post deleted or out of reach only looks out of date: the answer is stored.
    }
  }
  if (reply.status !== 'accepted') return;
  await announceWithCard(
    context,
    reply.scheduleChannelId,
    {
      content: t(locale, 'schedule.announce', {
        fixture: matchFixture(locale, reply.match),
        when: discordTime(reply.at),
        member: mention(answererUserId),
      }),
    },
    reply.match.id,
    'time',
  );
}
