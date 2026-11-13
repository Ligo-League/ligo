import type { ForfeitThresholds } from './settings.ts';
import type { StandingsMatch } from './standings.ts';

// A team's forfeits are counted from its forfeit matches every time, never stored: an annulled
// forfeit stops counting by itself.

/** How many of the given matches the entry forfeited. The caller passes one stage's matches. */
export function countForfeits(matches: readonly StandingsMatch[], entry: number): number {
  return matches.filter(({ a, b, result }) => {
    if (result.kind !== 'forfeit') return false;
    return (result.forfeitedBy === 'a' ? a : b) === entry;
  }).length;
}

export type ForfeitConsequence = 'none' | 'warning' | 'exclusion';

/**
 * What a team's forfeit count calls for, right after a forfeit brought it to `count`. The
 * warning is due once, on the forfeit that reaches its threshold. Exclusion is due from its
 * threshold on, for as long as staff have not acted: it is a decision for them, not something
 * this function carries out.
 */
export function forfeitConsequence(
  count: number,
  thresholds: ForfeitThresholds,
): ForfeitConsequence {
  if (thresholds.exclusion_at !== null && count >= thresholds.exclusion_at) return 'exclusion';
  if (thresholds.warning_at !== null && count === thresholds.warning_at) return 'warning';
  return 'none';
}
