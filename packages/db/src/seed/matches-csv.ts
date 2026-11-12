import { parse } from 'csv-parse/sync';

export const MATCH_CSV_COLUMNS = [
  'division',
  'week',
  'team_a',
  'team_b',
  'result',
  'score_a',
  'score_b',
  'forfeit_by',
] as const;
type Column = (typeof MATCH_CSV_COLUMNS)[number];
const REQUIRED = ['division', 'week', 'team_a', 'team_b'] as const;

/**
 * What the source recorded for a fixture. `draw` exists because score7 has drawn matches; the
 * league engine has no draws, so the seed reports such a row instead of counting it.
 */
export type MatchRowResult =
  | { kind: 'none' }
  | { kind: 'played'; scoreA: number; scoreB: number }
  | { kind: 'forfeit'; forfeitBy: 'a' | 'b' }
  | { kind: 'draw'; scoreA: number; scoreB: number };

export interface MatchRow {
  division: string;
  week: number;
  /** Team tags, as in the teams CSV. */
  teamA: string;
  teamB: string;
  result: MatchRowResult;
}

export type MatchesCsvResult = { ok: true; matches: MatchRow[] } | { ok: false; errors: string[] };

interface CsvRecord {
  record: Record<string, string | undefined>;
  info: { lines: number };
}

const WHOLE_NUMBER = /^\d+$/;

/**
 * Reads the fixtures and results file (`fixtures/lfr-s3-matches.csv`). Every problem is reported
 * with its line number; nothing is seeded from a file with errors.
 */
export function parseMatchesCsv(
  text: string,
  teams: readonly { division: string; tag: string }[],
): MatchesCsvResult {
  let records: CsvRecord[];
  try {
    records = parse(text, {
      bom: true,
      columns: true,
      info: true,
      relax_column_count_less: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : 'Unreadable CSV'] };
  }

  const header = Object.keys(records[0]?.record ?? {});
  const missingColumns = REQUIRED.filter(
    (column) => records.length > 0 && !header.includes(column),
  );
  if (missingColumns.length > 0) {
    return {
      ok: false,
      errors: missingColumns.map((column) => `line 1: column "${column}" is missing`),
    };
  }

  const errors: string[] = [];
  const matches: MatchRow[] = [];
  const seenPairings = new Map<string, number>();

  for (const { record, info } of records) {
    const line = info.lines;
    const before = errors.length;
    const fail = (problem: string) => errors.push(`line ${line}: ${problem}`);
    const value = (column: Column) => record[column] ?? '';

    for (const column of REQUIRED) if (value(column) === '') fail(`${column} is missing`);
    if (errors.length > before) continue;

    const division = value('division');
    const tags = teams.filter((team) => team.division === division).map((team) => team.tag);
    if (tags.length === 0) fail(`unknown division "${division}"`);

    const week = WHOLE_NUMBER.test(value('week')) ? Number(value('week')) : 0;
    if (week < 1) fail(`week "${value('week')}" must be a whole number from 1`);

    const teamA = value('team_a');
    const teamB = value('team_b');
    for (const tag of [teamA, teamB]) {
      if (tags.length > 0 && !tags.includes(tag)) fail(`team "${tag}" is not in ${division}`);
    }
    if (teamA === teamB) fail(`team "${teamA}" cannot play itself`);

    const pairing = [division, week, ...[teamA, teamB].sort()].join('\u0000');
    const firstLine = seenPairings.get(pairing);
    if (firstLine !== undefined) {
      fail(`${teamA} against ${teamB} in week ${week} is already on line ${firstLine}`);
    }
    seenPairings.set(pairing, firstLine ?? line);

    const result = readResult(value, teamA, teamB);
    if (typeof result === 'string') fail(result);
    else if (errors.length === before) matches.push({ division, week, teamA, teamB, result });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, matches };
}

/** Returns the row's result, or the problem as text. */
function readResult(
  value: (column: Column) => string,
  teamA: string,
  teamB: string,
): MatchRowResult | string {
  const kind = value('result');
  const scores = [value('score_a'), value('score_b')];
  const forfeitBy = value('forfeit_by');
  const hasScores = scores.some((cell) => cell !== '');

  if (kind === '' && hasScores) return 'a match without result takes no score';
  if (kind === 'forfeit' && hasScores) return 'a forfeit takes no score';
  if (kind !== 'forfeit' && forfeitBy !== '') return 'forfeit_by is only for a result of "forfeit"';

  switch (kind) {
    case '':
      return { kind: 'none' };
    case 'forfeit':
      if (forfeitBy === teamA) return { kind: 'forfeit', forfeitBy: 'a' };
      if (forfeitBy === teamB) return { kind: 'forfeit', forfeitBy: 'b' };
      return `forfeit_by "${forfeitBy}" must be ${teamA} or ${teamB}`;
    case 'played':
    case 'draw': {
      if (!scores.every((cell) => WHOLE_NUMBER.test(cell))) {
        return 'score_a and score_b must be whole numbers';
      }
      const scoreA = Number(scores[0]);
      const scoreB = Number(scores[1]);
      if (kind === 'played' && scoreA === scoreB) {
        return `a played match cannot end ${scoreA}-${scoreB}; use "draw" if the source says so`;
      }
      if (kind === 'draw' && scoreA !== scoreB) return `a draw cannot end ${scoreA}-${scoreB}`;
      return { kind, scoreA, scoreB };
    }
    default:
      return `result "${kind}" must be played, forfeit, draw or empty`;
  }
}

/** Writes rows in the format `parseMatchesCsv` reads. */
export function formatMatchesCsv(matches: readonly MatchRow[]): string {
  const lines = matches.map(({ division, week, teamA, teamB, result }) => {
    const cells: Record<Column, string | number> = {
      division,
      week,
      team_a: teamA,
      team_b: teamB,
      result: result.kind === 'none' ? '' : result.kind,
      score_a: 'scoreA' in result ? result.scoreA : '',
      score_b: 'scoreB' in result ? result.scoreB : '',
      forfeit_by: result.kind === 'forfeit' ? (result.forfeitBy === 'a' ? teamA : teamB) : '',
    };
    return MATCH_CSV_COLUMNS.map((column) => cells[column]);
  });
  return formatCsv(MATCH_CSV_COLUMNS, lines);
}

/** Minimal CSV writer: quotes a cell only when it holds a comma, a quote or a line break. */
export function formatCsv(
  columns: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): string {
  const cell = (value: string | number) => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns, ...rows].map((row) => row.map(cell).join(',') + '\n').join('');
}
