import type { MatchSide } from './standings.ts';

export interface SidesAssignment {
  /** Picks the starting side and starts the veto (team A of the veto). */
  sideChooser: MatchSide;
  otSideChooser: MatchSide;
  host: MatchSide;
  /** True when the ranks were equal and the coin decided. */
  byCoin: boolean;
}

const other = (side: MatchSide): MatchSide => (side === 'a' ? 'b' : 'a');

/**
 * Who picks the starting side, the overtime side, and who hosts, from the two teams' ranks at
 * match time (design doc section 5). Equal ranks follow `coin`, flipped by the caller so that
 * this stays pure; the coin's team then picks the starting side and the other hosts (O-12).
 */
export function assignSides(rankA: number, rankB: number, coin: MatchSide): SidesAssignment {
  // The lower-ranked team has the larger rank number.
  const sideChooser = rankA === rankB ? coin : rankA > rankB ? 'a' : 'b';
  return {
    sideChooser,
    otSideChooser: other(sideChooser),
    host: other(sideChooser),
    byCoin: rankA === rankB,
  };
}
