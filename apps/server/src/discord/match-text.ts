import { describeGameScores, type GameScoreSettings } from '@ligo/core';
import type { LeagueMatch } from '@ligo/db';
import { t, type Locale } from '../i18n/index.ts';
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
 * Posts in one of the league's channels when it is set. A notice that cannot be delivered must
 * not undo the step it reports, which is already stored: the failure is left to the caller's
 * reply and to Discord's own audit of the bot's permissions.
 */
export async function notify(
  context: CommandContext,
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
