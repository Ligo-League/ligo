import { describeGameScores, type GameScoreSettings } from '@ligo/core';
import type { LeagueMatch } from '@ligo/db';
import { t, type Locale } from '../i18n/index.ts';
import { recordQueuePost, type QueueEntity } from '../services/queue-posts.ts';
import type { DisputeDetails } from '../services/reports.ts';
import { MAX_CHOICE_LENGTH } from './commands/describe.ts';
import type { CommandContext, OutgoingMessage } from './commands/types.ts';

// How matches and results read in messages. Text only: no decision is taken here.

const names = (found: LeagueMatch) => ({
  division: found.division?.name ?? '—',
  week: found.week ?? '?',
  teamA: found.a.name,
  teamB: found.b.name,
});

/** "Ligue 1, semaine 3 : Bravo 7–5 Charlie". */
export function matchLine(
  locale: Locale,
  found: LeagueMatch,
  score: { scoreA: number; scoreB: number },
): string {
  return t(locale, 'match.line', { ...names(found), ...score });
}

/** The line of a match with the score it holds, reported or final. */
export function storedLine(locale: Locale, found: LeagueMatch): string {
  return found.game ? matchLine(locale, found, found.game) : matchFixture(locale, found);
}

/** "Ligue 1, semaine 3 : Bravo – Charlie". */
export function matchFixture(locale: Locale, found: LeagueMatch): string {
  return t(locale, 'match.fixture', names(found));
}

/** A suggestion: "L1 · S3 · BRV – CHA", with the stored score once the result is validated. */
export function matchLabel(locale: Locale, found: LeagueMatch): string {
  const base = {
    division: found.division?.categoryPrefix ?? '—',
    week: found.week ?? '?',
    teamA: found.a.tag,
    teamB: found.b.tag,
  };
  const label =
    found.status === 'validated' && found.game
      ? t(locale, 'match.labelWithResult', {
          ...base,
          scoreA: found.game.scoreA,
          scoreB: found.game.scoreB,
        })
      : t(locale, 'match.label', base);
  return label.slice(0, MAX_CHOICE_LENGTH);
}

/** Why a score was refused, with the scores the league's rule allows. */
export function impossibleScore(locale: Locale, rule: GameScoreSettings): string {
  const { regulation, overtime, endless } = describeGameScores(rule);
  const score = ([winner, loser]: readonly [number, number]) => `${winner}–${loser}`;
  return t(locale, 'match.error.impossible_score', {
    widest: score(regulation.from),
    closest: score(regulation.to),
    overtime: overtime.map(score).join(', ') + (endless ? '…' : ''),
  });
}

/**
 * A time as Discord shows it: in each reader's own time zone and language. `F` is the full date
 * and time, `D` the date alone, `R` relative ("in 4 minutes").
 */
export const discordTime = (at: number, style: 'F' | 'D' | 'R' = 'F') =>
  `<t:${String(Math.floor(at / 1000))}:${style}>`;

/** A calendar day (`YYYY-MM-DD`) as a short label: "jeu. 5 nov.". */
export function dayLabel(locale: Locale, date: string): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(Date.UTC(year, month - 1, day));
}

/** A mention of a Discord user. It pings only when the message names them in `mentionUserIds`. */
export const mention = (discordUserId: string) => `<@${discordUserId}>`;

/**
 * A page of the website, written so that Discord shows it without an embed (design doc section 6):
 * the bot's replies stay short, and the link is there to jump to the page.
 */
export const pageLink = (publicUrl: URL, path: string) => `<${new URL(path, publicUrl).href}>`;

/** The reason in the member's language; "other" is worded by the bot, not the league. */
export function reasonLabel(locale: Locale, dispute: Pick<DisputeDetails, 'label'>): string {
  if (!dispute.label) return t(locale, 'dispute.reason.other');
  return dispute.label[locale] ?? dispute.label.fr;
}

/**
 * A dispute's post in the staff queue: who disputed and why, then the team's own words in a
 * block quote, which keeps them apart from the bot's and runs to the end of the message. Once
 * staff decided, `outcome` goes between the two.
 */
export function disputeQueueMessage(
  locale: Locale,
  line: string,
  raisedBy: string | null,
  dispute: Pick<DisputeDetails, 'label' | 'details'>,
  outcome: string | null = null,
): OutgoingMessage {
  const lines = [
    t(locale, 'queue.disputedWithReason', {
      line,
      member: raisedBy === null ? '?' : mention(raisedBy),
      reason: reasonLabel(locale, dispute),
    }),
  ];
  if (outcome !== null) lines.push(outcome);
  // Mentions in the team's words never ping: the message names no one to notify.
  if (dispute.details !== null) lines.push(`>>> ${dispute.details}`);
  return { content: lines.join('\n') };
}

/**
 * Posts in the staff queue and records the post by what it is about, so that whoever handles it
 * can later mark it as handled. False when there is no queue or the post failed.
 */
export async function notifyQueue(
  context: Pick<CommandContext, 'db' | 'gateway' | 'now'>,
  channelId: string | null,
  message: OutgoingMessage,
  about: { entity: QueueEntity; entityId: number },
): Promise<boolean> {
  if (!channelId) return false;
  try {
    const post = await context.gateway.postMessage(channelId, message);
    recordQueuePost(context.db, about, { channelId, messageId: post.messageId }, context.now());
    return true;
  } catch {
    return false;
  }
}

/**
 * Posts in one of the league's channels when it is set. A notice that cannot be delivered must
 * not undo the step it reports, which is already stored: the failure is left to the caller's
 * reply and to Discord's own audit of the bot's permissions.
 */
export async function notify(
  context: Pick<CommandContext, 'gateway'>,
  channelId: string | null,
  message: OutgoingMessage,
): Promise<boolean> {
  if (!channelId) return false;
  try {
    await context.gateway.postMessage(channelId, message);
    return true;
  } catch {
    return false;
  }
}
