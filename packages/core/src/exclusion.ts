import type { MatchSide, StandingsMatch } from './standings.ts';

// The 50% rule (design doc section 5; maintainer, 13 November 2026, O-04). It is applied when
// standings are computed, never written into results: reinstating a team restores every match.

/** A match of the stage that does not count yet: still to play, or reported but not validated. */
export interface PendingMatch {
  id: number;
  week?: number | null;
  a: number;
  b: number;
}

export interface ExclusionSummary {
  entry: number;
  /** Matches really played, with a validated score; forfeits are not. */
  played: number;
  /** All the team's matches of the stage, void ones aside. */
  total: number;
  /** True when it played at least half: its validated results stand. */
  resultsStand: boolean;
}

const other = (side: MatchSide): MatchSide => (side === 'a' ? 'b' : 'a');

/**
 * The matches that count once the excluded entries are applied. A team that played at least half
 * of its matches keeps its validated results, and each of its other matches becomes a forfeit win
 * for the opponent. A team that played less sees every one of its matches become a forfeit win
 * for the opponent, except a match the opponent forfeited, which stays the opponent's loss. A
 * match between two excluded teams counts for neither.
 */
export function applyExclusions(
  matches: readonly StandingsMatch[],
  pending: readonly PendingMatch[],
  excluded: readonly number[],
): { matches: StandingsMatch[]; exclusions: ExclusionSummary[] } {
  if (excluded.length === 0) return { matches: [...matches], exclusions: [] };
  const isExcluded = (entry: number) => excluded.includes(entry);

  const exclusions = excluded.map((entry): ExclusionSummary => {
    const mine = (match: { a: number; b: number }) => match.a === entry || match.b === entry;
    const played = matches.filter((match) => mine(match) && match.result.kind === 'played').length;
    const total = matches.filter(mine).length + pending.filter(mine).length;
    return { entry, played, total, resultsStand: played * 2 >= total };
  });
  const standing = (entry: number) =>
    exclusions.find((summary) => summary.entry === entry)?.resultsStand ?? true;

  const result: StandingsMatch[] = [];
  for (const match of matches) {
    const excludedSides = (['a', 'b'] as const).filter((side) => isExcluded(match[side]));
    const [side] = excludedSides;
    if (excludedSides.length === 2) continue;
    if (side === undefined || standing(match[side])) {
      result.push(match);
      continue;
    }
    const opponentForfeited =
      match.result.kind === 'forfeit' && match.result.forfeitedBy === other(side);
    result.push(
      opponentForfeited ? match : { ...match, result: { kind: 'forfeit', forfeitedBy: side } },
    );
  }
  for (const match of pending) {
    const excludedSides = (['a', 'b'] as const).filter((side) => isExcluded(match[side]));
    const [side] = excludedSides;
    if (side === undefined || excludedSides.length === 2) continue;
    result.push({ ...match, result: { kind: 'forfeit', forfeitedBy: side } });
  }
  return { matches: result, exclusions };
}
