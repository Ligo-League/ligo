import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  formatCsv,
  formatMatchesCsv,
  MATCH_CSV_COLUMNS,
  parseMatchesCsv,
  type MatchRow,
} from './matches-csv.ts';

const TEAMS = [
  { division: 'Ligue 1', tag: 'RCK' },
  { division: 'Ligue 1', tag: 'RPV' },
  { division: 'Ligue 1', tag: 'GREED1' },
  { division: 'Ligue 2', tag: 'SHADE' },
  { division: 'Ligue 2', tag: 'NOVA1' },
];
const HEADER = MATCH_CSV_COLUMNS.join(',');
const parse = (...lines: string[]) => parseMatchesCsv([HEADER, ...lines].join('\n'), TEAMS);

describe('parseMatchesCsv', () => {
  it('reads a fixture with no result, a played match, a forfeit and a draw', () => {
    expect(
      parse(
        'Ligue 1,1,RCK,RPV,,,,',
        'Ligue 1,2,RPV,GREED1,played,7,4,',
        'Ligue 2,1,SHADE,NOVA1,forfeit,,,NOVA1',
        'Ligue 1,3,GREED1,RCK,draw,0,0,',
      ),
    ).toEqual({
      ok: true,
      matches: [
        { division: 'Ligue 1', week: 1, teamA: 'RCK', teamB: 'RPV', result: { kind: 'none' } },
        {
          division: 'Ligue 1',
          week: 2,
          teamA: 'RPV',
          teamB: 'GREED1',
          result: { kind: 'played', scoreA: 7, scoreB: 4 },
        },
        {
          division: 'Ligue 2',
          week: 1,
          teamA: 'SHADE',
          teamB: 'NOVA1',
          result: { kind: 'forfeit', forfeitBy: 'b' },
        },
        {
          division: 'Ligue 1',
          week: 3,
          teamA: 'GREED1',
          teamB: 'RCK',
          result: { kind: 'draw', scoreA: 0, scoreB: 0 },
        },
      ],
    });
  });

  it('accepts a file with only the header, and rows that stop after the teams', () => {
    expect(parse()).toEqual({ ok: true, matches: [] });
    expect(parse('Ligue 1,1,RCK,RPV')).toMatchObject({ ok: true, matches: [{ week: 1 }] });
  });

  it('reports a missing column once, on line 1', () => {
    expect(parseMatchesCsv('division,week,team_a\nLigue 1,1,RCK', TEAMS)).toEqual({
      ok: false,
      errors: ['line 1: column "team_b" is missing'],
    });
  });

  it('reports every bad row with its line number', () => {
    expect(
      parse(
        'Ligue 3,1,RCK,RPV,,,,',
        'Ligue 1,0,RCK,RPV,,,,',
        'Ligue 1,1,RCK,SHADE,,,,',
        'Ligue 1,1,RCK,RCK,,,,',
        'Ligue 1,,RCK,RPV,,,,',
        'Ligue 1,2,RCK,RPV,played,7,7,',
        'Ligue 1,3,RCK,RPV,played,7,,',
        'Ligue 1,4,RCK,RPV,draw,7,4,',
        'Ligue 1,5,RCK,RPV,forfeit,,,GREED1',
        'Ligue 1,6,RCK,RPV,forfeit,7,0,RPV',
        'Ligue 1,7,RCK,RPV,,7,4,',
        'Ligue 1,8,RCK,RPV,played,7,4,RPV',
        'Ligue 1,9,RCK,RPV,won,7,4,',
        'Ligue 1,9,RPV,RCK,,,,',
      ),
    ).toEqual({
      ok: false,
      errors: [
        'line 2: unknown division "Ligue 3"',
        'line 3: week "0" must be a whole number from 1',
        'line 4: team "SHADE" is not in Ligue 1',
        'line 5: team "RCK" cannot play itself',
        'line 6: week is missing',
        'line 7: a played match cannot end 7-7; use "draw" if the source says so',
        'line 8: score_a and score_b must be whole numbers',
        'line 9: a draw cannot end 7-4',
        'line 10: forfeit_by "GREED1" must be RCK or RPV',
        'line 11: a forfeit takes no score',
        'line 12: a match without result takes no score',
        'line 13: forfeit_by is only for a result of "forfeit"',
        'line 14: result "won" must be played, forfeit, draw or empty',
        'line 15: RPV against RCK in week 9 is already on line 14',
      ],
    });
  });
});

describe('formatMatchesCsv', () => {
  const tag = fc.constantFrom('RCK', 'RPV', 'GREED1');
  const score = fc.integer({ min: 0, max: 12 });
  const result = fc.oneof(
    fc.constant({ kind: 'none' as const }),
    fc
      .tuple(score, score)
      .filter(([a, b]) => a !== b)
      .map(([scoreA, scoreB]) => ({ kind: 'played' as const, scoreA, scoreB })),
    fc.constantFrom('a' as const, 'b' as const).map((forfeitBy) => ({
      kind: 'forfeit' as const,
      forfeitBy,
    })),
    score.map((value) => ({ kind: 'draw' as const, scoreA: value, scoreB: value })),
  );
  const rows = fc
    .uniqueArray(
      fc.tuple(fc.integer({ min: 1, max: 30 }), tag, tag).filter(([, a, b]) => a !== b),
      { selector: ([week, a, b]) => [week, ...[a, b].sort()].join(' ') },
    )
    .chain((pairings) =>
      fc.tuple(...pairings.map(() => result)).map((results) =>
        pairings.map(([week, teamA, teamB], i): MatchRow => ({
          division: 'Ligue 1',
          week,
          teamA,
          teamB,
          // `results` has one item per pairing by construction.
          result: results[i] ?? { kind: 'none' },
        })),
      ),
    );

  it('writes what parseMatchesCsv reads back unchanged', () => {
    fc.assert(
      fc.property(rows, (matches) => {
        expect(parseMatchesCsv(formatMatchesCsv(matches), TEAMS)).toEqual({ ok: true, matches });
      }),
    );
  });
});

describe('formatCsv', () => {
  it('quotes only the cells that need it', () => {
    expect(
      formatCsv(
        ['name', 'n'],
        [
          ['Dupont, Durand', 1],
          ['say "hi"', 2],
          ['plain', 3],
        ],
      ),
    ).toBe('name,n\n"Dupont, Durand",1\n"say ""hi""",2\nplain,3\n');
  });
});
