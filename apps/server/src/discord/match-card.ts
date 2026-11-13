import { renderMatchCardPng, type MatchCardInput } from '@ligo/render';
import { t, type Locale } from '../i18n/index.ts';
import { loadLogos } from '../services/logos.ts';
import { matchCardFacts, type MatchCardFacts } from '../services/match-card.ts';
import type { CommandContext, CommandFile, OutgoingMessage } from './commands/types.ts';
import { notify } from './match-text.ts';

// The social image of one match (design doc section 11), attached to the announcement the bot
// already posts, so that staff can save it and share it.

export type MatchCardKind = 'time' | 'result';

/**
 * The zone's short standard name at that moment: CET, CEST, GMT, GMT+9… A picture shows one
 * time for every reader, so it names its zone in a form that reads the same in any language.
 */
function zoneName(at: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' });
  return parts.formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
}

/** The texts and teams of the picture, in the league's language and time zone. */
export function matchCardInput(
  locale: Locale,
  facts: MatchCardFacts,
  kind: MatchCardKind,
): Omit<MatchCardInput, 'teams'> {
  const { match } = facts;
  const base = {
    eyebrow: t(locale, 'card.eyebrow', { competition: facts.competition, season: facts.season }),
    title: t(locale, 'card.title', {
      division: match.division?.name ?? facts.competition,
      week: match.week ?? '?',
    }),
    theme: facts.theme,
  };
  if (kind === 'time') {
    const at = match.scheduledAt ?? 0;
    const format = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
        ...options,
        timeZone: facts.timeZone,
      }).format(at);
    return {
      ...base,
      label: t(locale, 'card.label.time'),
      center: t(locale, 'card.vs'),
      winner: null,
      lines: [
        t(locale, 'card.when', {
          date: format({ weekday: 'long', day: 'numeric', month: 'long' }),
          time: format({ hour: '2-digit', minute: '2-digit', hour12: false }),
          zone: zoneName(at, facts.timeZone),
        }),
      ],
    };
  }
  const game = match.game;
  const forfeitSide = match.status === 'forfeit' ? (game?.forfeitSide ?? null) : null;
  if (forfeitSide) {
    return {
      ...base,
      label: t(locale, 'card.label.result'),
      center: t(locale, 'card.forfeit'),
      winner: forfeitSide === 'a' ? 1 : 0,
      lines: [t(locale, 'card.forfeitBy', { team: match[forfeitSide].name })],
    };
  }
  const scoreA = game?.scoreA ?? 0;
  const scoreB = game?.scoreB ?? 0;
  const winner = scoreA === scoreB ? null : scoreA > scoreB ? 0 : 1;
  return {
    ...base,
    label: t(locale, 'card.label.result'),
    center: `${scoreA} – ${scoreB}`,
    winner,
    lines: [
      ...(winner === null
        ? []
        : [t(locale, 'card.winner', { team: match[winner === 0 ? 'a' : 'b'].name })]),
      ...(facts.map ? [facts.map] : []),
    ],
  };
}

/** The picture as a file to attach, or null when it cannot be made: the text goes out anyway. */
export async function matchCardFile(
  context: Pick<CommandContext, 'db' | 'assets' | 'locale'>,
  matchId: number,
  kind: MatchCardKind,
): Promise<CommandFile | null> {
  try {
    const facts = matchCardFacts(context.db, matchId);
    if (!facts) return null;
    const { a, b } = facts.teams;
    const logos = await loadLogos(context.assets, [a.logoKey, b.logoKey]);
    const team = (side: typeof a) => ({
      name: side.name,
      colors: side.colors,
      logo: side.logoKey === null ? null : (logos.get(side.logoKey) ?? null),
    });
    const data = await renderMatchCardPng({
      ...matchCardInput(context.locale, facts, kind),
      teams: [team(a), team(b)],
    });
    return { name: `match-${String(matchId)}-${kind}.png`, data };
  } catch {
    // An image is a bonus on an announcement whose step is already stored.
    return null;
  }
}

/** Posts an announcement in one of the league's channels with the match's picture attached. */
export async function announceWithCard(
  context: CommandContext,
  channelId: string | null,
  message: OutgoingMessage,
  matchId: number,
  kind: MatchCardKind,
): Promise<boolean> {
  if (!channelId) return false;
  const file = await matchCardFile(context, matchId, kind);
  return notify(context, channelId, file ? { ...message, files: [file] } : message);
}
