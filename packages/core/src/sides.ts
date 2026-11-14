import type { MatchSide } from './standings.ts';

export interface SidesAssignment {
  /** Team A of the veto: the lower-ranked team, or the winner of the coin toss. */
  lead: MatchSide;
  /** True when the ranks were equal and the coin decided. */
  byCoin: boolean;
  /** Who has side selection and who picks the overtime side; after a coin toss, the veto says. */
  sideChooser: MatchSide | null;
  otSideChooser: MatchSide | null;
  /** Null after a coin toss: the teams agree on the host (O-12). */
  host: MatchSide | null;
}

const other = (side: MatchSide): MatchSide => (side === 'a' ? 'b' : 'a');

/**
 * Who leads the veto, picks the sides and hosts, from the two teams' ranks at match time (design
 * doc section 5). The lower-ranked team has side selection and bans first, the higher-ranked one
 * hosts. Equal ranks follow `coin`, tossed by the caller so that this stays pure: its winner
 * leads, and makes BLAST's choice in the veto itself (O-11, O-12).
 */
export function assignSides(rankA: number, rankB: number, coin: MatchSide): SidesAssignment {
  if (rankA === rankB) {
    return { lead: coin, byCoin: true, sideChooser: null, otSideChooser: null, host: null };
  }
  // The lower-ranked team has the larger rank number.
  const lead = rankA > rankB ? 'a' : 'b';
  return { lead, byCoin: false, sideChooser: lead, otSideChooser: other(lead), host: other(lead) };
}
