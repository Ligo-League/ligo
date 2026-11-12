import type { PointsSettings, TiebreakCriterion, TiebreakSettings } from './settings.ts';

// Standings are computed from results and settings every time; they are never stored or edited
// (design doc sections 4 and 5).

export type MatchSide = 'a' | 'b';

/** One match that counts. `a` and `b` are stage entries; the caller filters out the rest. */
export interface StandingsMatch {
  id: number;
  a: number;
  b: number;
  result:
    | { kind: 'played'; games: readonly { a: number; b: number }[] }
    | { kind: 'forfeit'; forfeitedBy: MatchSide };
}

export interface StandingsInput {
  /** Every entry of the stage, in the order rows should keep inside a shared rank. */
  entries: readonly number[];
  matches: readonly StandingsMatch[];
  points: PointsSettings;
  tiebreak: TiebreakSettings;
  /** Rounds credited to the winner and to the loser of a forfeit. */
  forfeitScore: readonly [number, number];
  /** Sanction point deltas; several per entry add up. */
  pointDeltas: readonly { entry: number; delta: number }[];
}

export interface StandingsRow {
  entry: number;
  /** 1-based; entries equal on every criterion share a rank and the next rank is skipped. */
  rank: number;
  shared: boolean;
  played: number;
  wins: number;
  losses: number;
  scoreFor: number;
  scoreAgainst: number;
  diff: number;
  points: number;
}

export type StandingsError =
  | { kind: 'unsupported_criterion'; criterion: TiebreakCriterion }
  | { kind: 'duplicate_entry'; entry: number }
  | { kind: 'unknown_entry'; entry: number }
  | { kind: 'same_entry'; matchId: number }
  | { kind: 'drawn_game'; matchId: number }
  | { kind: 'unsupported_series'; matchId: number };

export type StandingsResult =
  | {
      ok: true;
      rows: StandingsRow[];
      /** Groups of entries the criteria could not separate; `unresolved_tie` says what follows. */
      unresolvedTies: number[][];
    }
  | { ok: false; error: StandingsError };

type Tally = Omit<StandingsRow, 'rank' | 'shared'>;

// Head-to-head criteria and staff decisions are not computed yet: asking for one is an error,
// because skipping it would rank teams by a rule the league did not choose.
const CRITERION_VALUE: Partial<Record<TiebreakCriterion, (tally: Tally) => number>> = {
  points: (tally) => tally.points,
  diff: (tally) => tally.diff,
  score_for: (tally) => tally.scoreFor,
  wins: (tally) => tally.wins,
};

const fail = (error: StandingsError): StandingsResult => ({ ok: false, error });

export function computeStandings(input: StandingsInput): StandingsResult {
  const readers: ((tally: Tally) => number)[] = [];
  for (const criterion of input.tiebreak.criteria) {
    const read = CRITERION_VALUE[criterion];
    if (!read) return fail({ kind: 'unsupported_criterion', criterion });
    readers.push(read);
  }

  const tallies = new Map<number, Tally>();
  for (const entry of input.entries) {
    if (tallies.has(entry)) return fail({ kind: 'duplicate_entry', entry });
    tallies.set(entry, {
      entry,
      played: 0,
      wins: 0,
      losses: 0,
      scoreFor: 0,
      scoreAgainst: 0,
      diff: 0,
      points: 0,
    });
  }

  for (const match of input.matches) {
    const a = tallies.get(match.a);
    if (!a) return fail({ kind: 'unknown_entry', entry: match.a });
    const b = tallies.get(match.b);
    if (!b) return fail({ kind: 'unknown_entry', entry: match.b });
    if (a === b) return fail({ kind: 'same_entry', matchId: match.id });

    if (match.result.kind === 'forfeit') {
      const [winner, loser] = match.result.forfeitedBy === 'a' ? [b, a] : [a, b];
      const { forfeit } = input.points;
      credit(winner, loser, input.forfeitScore, forfeit.winner, forfeit.loser);
      if (forfeit.counts_as_played) countMatch(winner, loser);
    } else {
      // A league phase played as a series needs its own rule for rounds (design doc section 5).
      const [game, ...others] = match.result.games;
      if (!game || others.length > 0) {
        return fail({ kind: 'unsupported_series', matchId: match.id });
      }
      if (game.a === game.b) return fail({ kind: 'drawn_game', matchId: match.id });
      const aWon = game.a > game.b;
      const [winner, loser] = aWon ? [a, b] : [b, a];
      const score: [number, number] = aWon ? [game.a, game.b] : [game.b, game.a];
      const { outcomes } = input.points;
      credit(winner, loser, score, outcomes.win, outcomes.loss);
      countMatch(winner, loser);
    }
  }

  for (const { entry, delta } of input.pointDeltas) {
    const tally = tallies.get(entry);
    if (!tally) return fail({ kind: 'unknown_entry', entry });
    tally.points += delta;
  }

  const compare = (x: Tally, y: Tally): number => {
    for (const read of readers) {
      const difference = read(y) - read(x);
      if (difference !== 0) return difference;
    }
    return 0;
  };
  // Array.prototype.sort is stable, so tied entries keep the order of `input.entries`.
  const ordered = [...tallies.values()].sort(compare);

  const rows: StandingsRow[] = [];
  const unresolvedTies: number[][] = [];
  let group: StandingsRow[] = [];
  let previous: Tally | undefined;
  const closeGroup = () => {
    if (group.length > 1) {
      for (const row of group) row.shared = true;
      unresolvedTies.push(group.map((row) => row.entry));
    }
  };
  for (const [index, tally] of ordered.entries()) {
    if (!previous || compare(previous, tally) !== 0) {
      closeGroup();
      group = [];
    }
    const row: StandingsRow = { ...tally, rank: group[0]?.rank ?? index + 1, shared: false };
    group.push(row);
    rows.push(row);
    previous = tally;
  }
  closeGroup();

  return { ok: true, rows, unresolvedTies };
}

function credit(
  winner: Tally,
  loser: Tally,
  score: readonly [number, number],
  winnerPoints: number,
  loserPoints: number,
): void {
  const [winnerScore, loserScore] = score;
  winner.scoreFor += winnerScore;
  winner.scoreAgainst += loserScore;
  loser.scoreFor += loserScore;
  loser.scoreAgainst += winnerScore;
  winner.diff = winner.scoreFor - winner.scoreAgainst;
  loser.diff = loser.scoreFor - loser.scoreAgainst;
  winner.points += winnerPoints;
  loser.points += loserPoints;
}

function countMatch(winner: Tally, loser: Tally): void {
  winner.played += 1;
  winner.wins += 1;
  loser.played += 1;
  loser.losses += 1;
}
