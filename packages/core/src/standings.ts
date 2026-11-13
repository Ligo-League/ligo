import type { PointsSettings, TiebreakCriterion, TiebreakSettings } from './settings.ts';

// Standings are computed from results and settings every time; they are never stored or edited
// (design doc sections 4 and 5).

export type MatchSide = 'a' | 'b';

/** One match that counts. `a` and `b` are stage entries; the caller filters out the rest. */
export interface StandingsMatch {
  id: number;
  /** The week the match belongs to, if the stage has weeks; used by `rankChanges`. */
  week?: number | null;
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

/**
 * Each entry's move since the previous week, in places: positive when it went up. The previous
 * table counts the same results except those of the latest week that has one; a match without a
 * week, and every sanction, counts in both. An entry's change is null while the previous table
 * counts no match, since everyone shares first place there. Null when the settings cannot rank.
 */
export function rankChanges(input: StandingsInput): Map<number, number | null> | null {
  const current = computeStandings(input);
  if (!current.ok) return null;
  const weeks = input.matches.flatMap((match) => (match.week == null ? [] : [match.week]));
  const latest = weeks.length === 0 ? null : Math.max(...weeks);
  const before = input.matches.filter((match) => match.week !== latest);
  const previous =
    latest === null || before.length === 0 ? null : computeStandings({ ...input, matches: before });
  const changes = new Map<number, number | null>();
  for (const row of current.rows) {
    const old = previous?.ok
      ? previous.rows.find((candidate) => candidate.entry === row.entry)
      : undefined;
    changes.set(row.entry, old ? old.rank - row.rank : null);
  }
  return changes;
}

export type FormResult = 'W' | 'L';

/**
 * The latest results of one entry, oldest first, from matches given in the order they were
 * played. A forfeit is a win for the opponent and a loss for the team that forfeited.
 */
export function recentForm(
  matches: readonly StandingsMatch[],
  entry: number,
  count: number,
): FormResult[] {
  const results: FormResult[] = [];
  for (const match of matches) {
    if (match.a !== entry && match.b !== entry) continue;
    const side: MatchSide = match.a === entry ? 'a' : 'b';
    if (match.result.kind === 'forfeit') {
      results.push(match.result.forfeitedBy === side ? 'L' : 'W');
      continue;
    }
    let won = 0;
    let lost = 0;
    for (const game of match.result.games) {
      const [own, other] = side === 'a' ? [game.a, game.b] : [game.b, game.a];
      if (own > other) won += 1;
      if (own < other) lost += 1;
    }
    // A match nobody won (no game yet, or a tied series) says nothing about form.
    if (won !== lost) results.push(won > lost ? 'W' : 'L');
  }
  return count > 0 ? results.slice(-count) : [];
}
