import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyExclusions, type PendingMatch } from './exclusion.ts';
import type { PointsSettings, TiebreakSettings } from './settings.ts';
import { computeStandings, type StandingsInput, type StandingsMatch } from './standings.ts';

// The 50% rule as the maintainer settled it on 13 November 2026 (O-04): only matches really
// played count as played, forfeits do not; half of all the team's matches of the regular season.
// At least half played: its results stand and every match not yet counted becomes a forfeit win
// for the opponent. Otherwise every one of its matches does, except those the opponent forfeited.

const X = 9; // the excluded team
let nextId = 1;
const played = (a: number, b: number, scoreA: number, scoreB: number): StandingsMatch => ({
  id: nextId++,
  a,
  b,
  result: { kind: 'played', games: [{ a: scoreA, b: scoreB }] },
});
const forfeit = (a: number, b: number, forfeitedBy: 'a' | 'b'): StandingsMatch => ({
  id: nextId++,
  a,
  b,
  result: { kind: 'forfeit', forfeitedBy },
});
const pending = (a: number, b: number): PendingMatch => ({ id: nextId++, a, b });
const forfeitBy = (match: { id: number; a: number; b: number }, entry: number) => ({
  id: match.id,
  a: match.a,
  b: match.b,
  result: { kind: 'forfeit', forfeitedBy: match.a === entry ? 'a' : 'b' },
});

describe('applyExclusions', () => {
  it('keeps the results of a team that played at least half, and forfeits the rest', () => {
    const results = [
      played(X, 1, 7, 3),
      played(2, X, 7, 5),
      played(X, 3, 2, 7),
      played(4, X, 1, 7),
    ];
    const left = [pending(X, 5), pending(6, X), pending(X, 7), pending(8, X)];
    // 4 played out of 8: exactly half.
    const outcome = applyExclusions(results, left, [X]);
    expect(outcome.matches).toEqual([...results, ...left.map((match) => forfeitBy(match, X))]);
    expect(outcome.exclusions).toEqual([{ entry: X, played: 4, total: 8, resultsStand: true }]);
  });

  it('turns every match of a team that played less than half into a forfeit win for its opponent', () => {
    const results = [played(X, 1, 7, 3), played(2, X, 7, 5), played(X, 3, 2, 7)];
    const left = [pending(X, 4), pending(5, X), pending(X, 6), pending(7, X)];
    const outcome = applyExclusions(results, left, [X]);
    expect(outcome.matches).toEqual([...results, ...left].map((match) => forfeitBy(match, X)));
    expect(outcome.exclusions).toEqual([{ entry: X, played: 3, total: 7, resultsStand: false }]);
  });

  it('does not count forfeits as played, whoever forfeited', () => {
    const results = [
      played(X, 1, 7, 3),
      played(2, X, 7, 5),
      played(X, 3, 7, 2),
      forfeit(X, 4, 'a'),
      forfeit(5, X, 'b'),
      forfeit(X, 6, 'a'),
      forfeit(7, X, 'a'),
    ];
    // 3 played out of 8 (the 8th is still to play): less than half.
    const outcome = applyExclusions(results, [pending(X, 8)], [X]);
    expect(outcome.exclusions[0]).toMatchObject({ played: 3, total: 8, resultsStand: false });
  });

  it('leaves a forfeit by the opponent as it is: not showing up earns no win', () => {
    const opponentForfeit = forfeit(7, X, 'a');
    const outcome = applyExclusions(
      [played(X, 1, 7, 3), opponentForfeit],
      [pending(X, 2), pending(X, 3)],
      [X],
    );
    expect(outcome.matches).toContainEqual(opponentForfeit);
  });

  it('drops a match between two excluded teams: nobody earns anything from it', () => {
    const between = played(X, 8, 7, 0);
    const outcome = applyExclusions([between, played(X, 1, 7, 3)], [pending(8, 2)], [X, 8]);
    expect(outcome.matches.map((match) => match.id)).not.toContain(between.id);
  });

  it('changes nothing without an exclusion', () => {
    const results = [played(1, 2, 7, 3)];
    expect(applyExclusions(results, [pending(1, 3)], [])).toEqual({
      matches: results,
      exclusions: [],
    });
  });

  it('treats every opponent alike when less than half was played', () => {
    const opponent = fc.integer({ min: 1, max: 8 });
    const result = fc.oneof(
      fc
        .tuple(opponent, fc.nat(7), fc.nat(7))
        .filter(([, a, b]) => a !== b)
        .map(([o, a, b]) => played(X, o, a, b)),
      fc
        .tuple(opponent, fc.boolean())
        .map(([o, excludedForfeited]) => forfeit(X, o, excludedForfeited ? 'a' : 'b')),
    );
    fc.assert(
      fc.property(
        fc.array(result, { maxLength: 9 }),
        fc.array(opponent, { maxLength: 9 }),
        (results, left) => {
          const pendingMatches = left.map((o) => pending(o, X));
          const outcome = applyExclusions(results, pendingMatches, [X]);
          const [summary] = outcome.exclusions;
          if (!summary || summary.resultsStand) return;
          for (const match of outcome.matches) {
            const xSide = match.a === X ? 'a' : 'b';
            const original = results.find((candidate) => candidate.id === match.id);
            const opponentForfeited =
              original?.result.kind === 'forfeit' && original.result.forfeitedBy !== xSide;
            // Every opponent gets the same forfeit win, unless it forfeited itself.
            expect(match.result).toEqual({
              kind: 'forfeit',
              forfeitedBy: opponentForfeited ? (xSide === 'a' ? 'b' : 'a') : xSide,
            });
          }
          expect(outcome.matches).toHaveLength(results.length + pendingMatches.length);
        },
      ),
    );
  });
});

describe('computeStandings with an excluded team', () => {
  const POINTS: PointsSettings = {
    outcomes: { win: 3, loss: 0 },
    forfeit: { winner: 3, loser: 0, counts_as_played: true },
  };
  const TIEBREAK: TiebreakSettings = { criteria: ['points', 'diff'], unresolved_tie: 'shared' };
  const input = (overrides: Partial<StandingsInput>): StandingsInput => ({
    entries: [1, 2, 3, X],
    matches: [],
    points: POINTS,
    tiebreak: TIEBREAK,
    forfeitScore: [0, 0],
    pointDeltas: [],
    ...overrides,
  });

  it('ranks the excluded team last, marked, after applying the rule', () => {
    // X beat 1 and 2, then left: 2 played out of 5, so both wins become forfeit wins for them.
    const result = computeStandings(
      input({
        matches: [played(X, 1, 7, 0), played(X, 2, 7, 0), played(3, 1, 7, 5)],
        pending: [pending(X, 3), pending(1, X), pending(2, X)],
        excluded: [X],
      }),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    // Everyone has 6 points; 3 leads on difference (+2), then 2 (0), then 1 (-2).
    expect(result.rows.map((row) => [row.entry, row.rank, row.excluded])).toEqual([
      [3, 1, false],
      [2, 2, false],
      [1, 3, false],
      [X, 4, true],
    ]);
    expect(result.rows.find((row) => row.entry === 1)).toMatchObject({ played: 3, points: 6 });
  });

  it('marks nobody as excluded without exclusions', () => {
    const result = computeStandings(input({ matches: [played(1, 2, 7, 3)] }));
    expect(result.ok && result.rows.every((row) => !row.excluded)).toBe(true);
  });
});
