import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PointsSettings, TiebreakSettings } from './settings.ts';
import {
  computeStandings,
  type StandingsInput,
  type StandingsMatch,
  type StandingsRow,
} from './standings.ts';

// LFR Season 3 (design doc section 5): 3 points per win, ranking by points then round difference,
// a forfeit scored 0-0.
const POINTS: PointsSettings = {
  outcomes: { win: 3, loss: 0 },
  forfeit: { winner: 3, loser: 0, counts_as_played: true },
};
const TIEBREAK: TiebreakSettings = { criteria: ['points', 'diff'], unresolved_tie: 'shared' };

const input = (overrides: Partial<StandingsInput>): StandingsInput => ({
  entries: [1, 2, 3, 4],
  matches: [],
  points: POINTS,
  tiebreak: TIEBREAK,
  forfeitScore: [0, 0],
  pointDeltas: [],
  ...overrides,
});

let nextMatchId = 1;
const played = (a: number, b: number, scoreA: number, scoreB: number): StandingsMatch => ({
  id: nextMatchId++,
  a,
  b,
  result: { kind: 'played', games: [{ a: scoreA, b: scoreB }] },
});
const forfeit = (a: number, b: number, forfeitedBy: 'a' | 'b'): StandingsMatch => ({
  id: nextMatchId++,
  a,
  b,
  result: { kind: 'forfeit', forfeitedBy },
});

function rowsOf(overrides: Partial<StandingsInput>): StandingsRow[] {
  const result = computeStandings(input(overrides));
  if (!result.ok) throw new Error(`Expected standings, got ${JSON.stringify(result.error)}`);
  return result.rows;
}
const rowOf = (rows: StandingsRow[], entry: number): StandingsRow => {
  const row = rows.find((candidate) => candidate.entry === entry);
  if (!row) throw new Error(`No row for entry ${entry}`);
  return row;
};

describe('computeStandings: columns', () => {
  it('gives every entry an empty row and a shared first place before any match', () => {
    const rows = rowsOf({});
    expect(rows.map((row) => row.entry)).toEqual([1, 2, 3, 4]);
    for (const row of rows) {
      expect(row).toMatchObject({ rank: 1, shared: true, played: 0, wins: 0, losses: 0 });
      expect(row).toMatchObject({ scoreFor: 0, scoreAgainst: 0, diff: 0, points: 0 });
    }
  });

  it('counts a played match: J, V, D, rounds for and against, difference, points', () => {
    const rows = rowsOf({ matches: [played(1, 2, 7, 4)] });
    expect(rowOf(rows, 1)).toMatchObject({
      played: 1,
      wins: 1,
      losses: 0,
      scoreFor: 7,
      scoreAgainst: 4,
      diff: 3,
      points: 3,
    });
    expect(rowOf(rows, 2)).toMatchObject({
      played: 1,
      wins: 0,
      losses: 1,
      scoreFor: 4,
      scoreAgainst: 7,
      diff: -3,
      points: 0,
    });
  });

  it('takes the points per outcome from the settings', () => {
    const points: PointsSettings = { ...POINTS, outcomes: { win: 1, loss: 0 } };
    const rows = rowsOf({ points, matches: [played(1, 2, 7, 4), played(1, 3, 8, 7)] });
    expect(rowOf(rows, 1).points).toBe(2);
  });

  it('adds sanction point deltas to the points', () => {
    const rows = rowsOf({
      matches: [played(1, 2, 7, 4), played(3, 4, 7, 5)],
      pointDeltas: [
        { entry: 1, delta: -2 },
        { entry: 1, delta: -1 },
        { entry: 4, delta: 1 },
      ],
    });
    expect(rowOf(rows, 1).points).toBe(0);
    expect(rowOf(rows, 4).points).toBe(1);
    expect(rows.map((row) => row.entry)).toEqual([3, 4, 1, 2]);
  });
});

describe('computeStandings: ranking', () => {
  it('ranks by points, then by round difference', () => {
    const rows = rowsOf({
      matches: [played(1, 3, 7, 5), played(2, 4, 7, 1), played(3, 4, 7, 6)],
    });
    expect(rows.map((row) => [row.entry, row.rank, row.shared])).toEqual([
      [2, 1, false], // 3 pts, +6
      [1, 2, false], // 3 pts, +2
      [3, 3, false], // 3 pts, -1
      [4, 4, false], // 0 pts
    ]);
  });

  it('breaks the Season 2 tie on difference: 8 points each, 23 beats 21', () => {
    // Vaevictis (+23) and Origin's Esport (+21) both won 8 matches at 1 point per win.
    const points: PointsSettings = { ...POINTS, outcomes: { win: 1, loss: 0 } };
    const vaevictis = Array.from({ length: 8 }, (_, i) => played(1, 3, 7, i < 7 ? 4 : 5)); // 7×3 + 2
    const origins = Array.from({ length: 8 }, (_, i) => played(2, 4, 7, i < 5 ? 4 : 5)); // 5×3 + 3×2
    const rows = rowsOf({ points, matches: [...origins, ...vaevictis] });
    expect(rows.slice(0, 2).map((row) => [row.entry, row.points, row.diff, row.rank])).toEqual([
      [1, 8, 23, 1],
      [2, 8, 21, 2],
    ]);
  });

  it('shares a rank between entries equal on every criterion, and skips the next rank', () => {
    const result = computeStandings(
      input({ matches: [played(1, 4, 7, 2), played(2, 4, 7, 5), played(3, 4, 7, 5)] }),
    );
    if (!result.ok) throw new Error('Expected standings');
    expect(result.rows.map((row) => [row.entry, row.rank, row.shared])).toEqual([
      [1, 1, false],
      [2, 2, true],
      [3, 2, true],
      [4, 4, false],
    ]);
    expect(result.unresolvedTies).toEqual([[2, 3]]);
  });

  it('keeps the given entry order inside a shared rank', () => {
    const rows = rowsOf({ entries: [4, 3, 2, 1] });
    expect(rows.map((row) => row.entry)).toEqual([4, 3, 2, 1]);
  });

  it('reports no unresolved tie when the criteria separate everyone', () => {
    const result = computeStandings(input({ entries: [1, 2], matches: [played(1, 2, 7, 4)] }));
    expect(result).toMatchObject({ ok: true, unresolvedTies: [] });
  });

  it.each([
    ['score_for', [played(1, 3, 8, 7), played(2, 4, 7, 6)], [1, 2]],
    ['wins', [played(1, 3, 7, 6), played(1, 4, 7, 6), played(2, 3, 7, 0)], [1, 2]],
  ] as const)('supports the %s criterion', (criterion, matches, top) => {
    // Points are neutralised so that only the criterion under test can order the entries.
    const rows = rowsOf({
      points: { outcomes: { win: 0, loss: 0 }, forfeit: POINTS.forfeit },
      tiebreak: { criteria: ['points', criterion], unresolved_tie: 'shared' },
      matches: [...matches],
    });
    expect(rows.slice(0, 2).map((row) => row.entry)).toEqual(top);
  });
});

describe('computeStandings: forfeits', () => {
  it('gives the forfeit points and, at 0-0, moves no rounds (Season 3)', () => {
    const rows = rowsOf({ matches: [forfeit(1, 2, 'b')] });
    expect(rowOf(rows, 1)).toMatchObject({ played: 1, wins: 1, losses: 0, points: 3 });
    expect(rowOf(rows, 1)).toMatchObject({ scoreFor: 0, scoreAgainst: 0, diff: 0 });
    expect(rowOf(rows, 2)).toMatchObject({ played: 1, wins: 0, losses: 1, points: 0, diff: 0 });
  });

  it('credits the forfeit score to the opponent of the team that forfeited (7-0, Season 2)', () => {
    const rows = rowsOf({ forfeitScore: [7, 0], matches: [forfeit(1, 2, 'a')] });
    expect(rowOf(rows, 2)).toMatchObject({ wins: 1, scoreFor: 7, scoreAgainst: 0, diff: 7 });
    expect(rowOf(rows, 1)).toMatchObject({ losses: 1, scoreFor: 0, scoreAgainst: 7, diff: -7 });
  });

  it('uses the forfeit points, not the win points', () => {
    const points: PointsSettings = {
      outcomes: { win: 3, loss: 0 },
      forfeit: { winner: 2, loser: -1, counts_as_played: true },
    };
    const rows = rowsOf({ points, matches: [forfeit(1, 2, 'b')] });
    expect(rowOf(rows, 1).points).toBe(2);
    expect(rowOf(rows, 2).points).toBe(-1);
  });

  it('leaves J, V and D alone when a forfeit does not count as played', () => {
    const points: PointsSettings = {
      ...POINTS,
      forfeit: { winner: 3, loser: 0, counts_as_played: false },
    };
    const rows = rowsOf({ points, forfeitScore: [7, 0], matches: [forfeit(1, 2, 'b')] });
    expect(rowOf(rows, 1)).toMatchObject({ played: 0, wins: 0, losses: 0, points: 3, diff: 7 });
    expect(rowOf(rows, 2)).toMatchObject({ played: 0, wins: 0, losses: 0, points: 0, diff: -7 });
  });
});

describe('computeStandings: refusals', () => {
  it.each(['h2h_points', 'h2h_diff', 'staff_decision'] as const)(
    'refuses the %s criterion instead of ignoring it',
    (criterion) => {
      const result = computeStandings(
        input({ tiebreak: { criteria: ['points', criterion], unresolved_tie: 'shared' } }),
      );
      expect(result).toEqual({ ok: false, error: { kind: 'unsupported_criterion', criterion } });
    },
  );

  it('refuses a drawn game: there are no draws', () => {
    const match = played(1, 2, 6, 6);
    expect(computeStandings(input({ matches: [match] }))).toEqual({
      ok: false,
      error: { kind: 'drawn_game', matchId: match.id },
    });
  });

  it.each([
    ['no game', []],
    [
      'several games',
      [
        { a: 7, b: 4 },
        { a: 7, b: 5 },
      ],
    ],
  ])('refuses a played match with %s: a series has no rounds rule yet', (_name, games) => {
    const match: StandingsMatch = { id: 90, a: 1, b: 2, result: { kind: 'played', games } };
    expect(computeStandings(input({ matches: [match] }))).toEqual({
      ok: false,
      error: { kind: 'unsupported_series', matchId: 90 },
    });
  });

  it('refuses a match with an entry that is not in the stage', () => {
    const match = played(1, 9, 7, 4);
    expect(computeStandings(input({ matches: [match] }))).toEqual({
      ok: false,
      error: { kind: 'unknown_entry', entry: 9 },
    });
  });

  it('refuses a match of an entry against itself', () => {
    const match = played(2, 2, 7, 4);
    expect(computeStandings(input({ matches: [match] }))).toEqual({
      ok: false,
      error: { kind: 'same_entry', matchId: match.id },
    });
  });

  it('refuses a point delta for an entry that is not in the stage', () => {
    expect(computeStandings(input({ pointDeltas: [{ entry: 9, delta: -1 }] }))).toEqual({
      ok: false,
      error: { kind: 'unknown_entry', entry: 9 },
    });
  });

  it('refuses an entry listed twice', () => {
    expect(computeStandings(input({ entries: [1, 2, 1] }))).toEqual({
      ok: false,
      error: { kind: 'duplicate_entry', entry: 1 },
    });
  });
});

describe('computeStandings: properties', () => {
  const settings = fc.record({
    win: fc.integer({ min: 0, max: 3 }),
    loss: fc.integer({ min: 0, max: 1 }),
    forfeitWinner: fc.integer({ min: 0, max: 3 }),
    forfeitLoser: fc.integer({ min: -1, max: 0 }),
    countsAsPlayed: fc.boolean(),
    forfeitScore: fc.constantFrom<[number, number]>([0, 0], [7, 0]),
  });

  const league = fc.integer({ min: 2, max: 8 }).chain((size) => {
    const entry = fc.integer({ min: 1, max: size });
    const pair = fc.tuple(entry, entry).filter(([a, b]) => a !== b);
    const score = fc
      .tuple(fc.integer({ min: 0, max: 8 }), fc.integer({ min: 0, max: 8 }))
      .filter(([a, b]) => a !== b);
    const match = fc.oneof(
      fc.tuple(pair, score).map(([[a, b], [scoreA, scoreB]]) => ({
        a,
        b,
        result: { kind: 'played' as const, games: [{ a: scoreA, b: scoreB }] },
      })),
      fc.tuple(pair, fc.constantFrom('a' as const, 'b' as const)).map(([[a, b], forfeitedBy]) => ({
        a,
        b,
        result: { kind: 'forfeit' as const, forfeitedBy },
      })),
    );
    return fc.record({
      entries: fc.constant(Array.from({ length: size }, (_, i) => i + 1)),
      matches: fc
        .array(match, { maxLength: 30 })
        .map((list) => list.map((item, i): StandingsMatch => ({ id: i + 1, ...item }))),
      pointDeltas: fc.array(fc.record({ entry, delta: fc.integer({ min: -3, max: 3 }) }), {
        maxLength: 4,
      }),
    });
  });

  const build = (
    generated: Pick<StandingsInput, 'entries' | 'matches' | 'pointDeltas'>,
    chosen: {
      win: number;
      loss: number;
      forfeitWinner: number;
      forfeitLoser: number;
      countsAsPlayed: boolean;
      forfeitScore: [number, number];
    },
  ): StandingsInput => ({
    ...generated,
    points: {
      outcomes: { win: chosen.win, loss: chosen.loss },
      forfeit: {
        winner: chosen.forfeitWinner,
        loser: chosen.forfeitLoser,
        counts_as_played: chosen.countsAsPlayed,
      },
    },
    tiebreak: TIEBREAK,
    forfeitScore: chosen.forfeitScore,
  });

  const sum = (rows: StandingsRow[], read: (row: StandingsRow) => number) =>
    rows.reduce((total, row) => total + read(row), 0);

  it('keeps the totals consistent with the matches and the settings', () => {
    fc.assert(
      fc.property(league, settings, (generated, chosen) => {
        const standings = build(generated, chosen);
        const result = computeStandings(standings);
        if (!result.ok) throw new Error(JSON.stringify(result.error));
        const { rows } = result;

        const playedCount = standings.matches.filter((m) => m.result.kind === 'played').length;
        const forfeitCount = standings.matches.length - playedCount;
        const counted = playedCount + (chosen.countsAsPlayed ? forfeitCount : 0);
        const deltas = standings.pointDeltas.reduce((total, d) => total + d.delta, 0);

        expect(rows).toHaveLength(standings.entries.length);
        expect(sum(rows, (row) => row.diff)).toBe(0);
        expect(sum(rows, (row) => row.scoreFor)).toBe(sum(rows, (row) => row.scoreAgainst));
        expect(sum(rows, (row) => row.played)).toBe(2 * counted);
        expect(sum(rows, (row) => row.wins)).toBe(counted);
        expect(sum(rows, (row) => row.losses)).toBe(counted);
        expect(sum(rows, (row) => row.points)).toBe(
          playedCount * (chosen.win + chosen.loss) +
            forfeitCount * (chosen.forfeitWinner + chosen.forfeitLoser) +
            deltas,
        );
        for (const row of rows) {
          expect(row.diff).toBe(row.scoreFor - row.scoreAgainst);
          expect(row.played).toBe(row.wins + row.losses);
        }
      }),
    );
  });

  it('orders rows by points then difference, and ranks by the number of better rows', () => {
    fc.assert(
      fc.property(league, settings, (generated, chosen) => {
        const result = computeStandings(build(generated, chosen));
        if (!result.ok) throw new Error(JSON.stringify(result.error));
        const { rows } = result;
        const better = (x: StandingsRow, y: StandingsRow) =>
          x.points > y.points || (x.points === y.points && x.diff > y.diff);

        rows.forEach((row, index) => {
          const next = rows[index + 1];
          if (next) expect(better(next, row)).toBe(false);
          expect(row.rank).toBe(1 + rows.filter((other) => better(other, row)).length);
          expect(row.shared).toBe(rows.some((other) => other !== row && other.rank === row.rank));
        });
        const tied = result.unresolvedTies.flat();
        expect([...tied].sort((x, y) => x - y)).toEqual(
          rows
            .filter((row) => row.shared)
            .map((row) => row.entry)
            .sort((x, y) => x - y),
        );
      }),
    );
  });

  it('does not depend on the order the matches are given in', () => {
    fc.assert(
      fc.property(
        league.chain((generated) =>
          fc.record({
            generated: fc.constant(generated),
            shuffled: fc.shuffledSubarray(generated.matches, {
              minLength: generated.matches.length,
            }),
          }),
        ),
        settings,
        ({ generated, shuffled }, chosen) => {
          const direct = computeStandings(build(generated, chosen));
          const reordered = computeStandings(build({ ...generated, matches: shuffled }, chosen));
          expect(reordered).toEqual(direct);
        },
      ),
    );
  });
});
