import type { LeagueMatch } from '@ligo/db';

/**
 * A filter for matches from what a member has typed so far: a team name or tag, a division or
 * its prefix, "s3" for a week. Each typed word must start one of the match's words, so "1" finds
 * Ligue 1 but not week "s1".
 */
export function matchQuery(query: string): (candidate: LeagueMatch) => boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (candidate) => {
    const tokens = [
      candidate.division?.name ?? '',
      candidate.division?.categoryPrefix ?? '',
      candidate.week === null ? '' : `s${candidate.week}`,
      candidate.a.name,
      candidate.a.tag,
      candidate.b.name,
      candidate.b.tag,
    ]
      .join(' ')
      .toLowerCase()
      .split(/\s+/);
    return words.every((word) => tokens.some((token) => token.startsWith(word)));
  };
}
