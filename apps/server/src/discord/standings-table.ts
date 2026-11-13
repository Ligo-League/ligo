import { t, type Locale, type MessageKey } from '../i18n/index.ts';
import type { StandingsTable } from '../services/standings.ts';

type Column = { header: MessageKey; align: 'left' | 'right'; cell: (row: Row) => string };
type Row = StandingsTable['rows'][number];

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

// Teams show by tag: a monospace table wider than about 45 characters wraps on phones.
const COLUMNS: Column[] = [
  { header: 'standings.column.rank', align: 'right', cell: (row) => String(row.rank) },
  { header: 'standings.column.team', align: 'left', cell: (row) => row.team.tag },
  { header: 'standings.column.playedShort', align: 'right', cell: (row) => String(row.played) },
  { header: 'standings.column.wins', align: 'right', cell: (row) => String(row.wins) },
  { header: 'standings.column.losses', align: 'right', cell: (row) => String(row.losses) },
  { header: 'standings.column.for', align: 'right', cell: (row) => String(row.scoreFor) },
  { header: 'standings.column.against', align: 'right', cell: (row) => String(row.scoreAgainst) },
  { header: 'standings.column.diff', align: 'right', cell: (row) => signed(row.diff) },
  { header: 'standings.column.points', align: 'right', cell: (row) => String(row.points) },
];

/** A standings table as fixed-width lines, for a Discord code block. */
export function formatStandingsTable(locale: Locale, table: StandingsTable): string {
  const lines = [
    COLUMNS.map((column) => t(locale, column.header)),
    ...table.rows.map((row) => COLUMNS.map((column) => column.cell(row))),
  ];
  const widths = COLUMNS.map((_column, index) =>
    Math.max(...lines.map((cells) => cells[index]?.length ?? 0)),
  );
  return lines
    .map((cells) =>
      cells
        .map((cell, index) => {
          const width = widths[index] ?? 0;
          return COLUMNS[index]?.align === 'left' ? cell.padEnd(width) : cell.padStart(width);
        })
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}
