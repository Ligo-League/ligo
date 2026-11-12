import { slugify } from '@ligo/core';
import { parse } from 'csv-parse/sync';
import { teamColorsSchema } from '../json.ts';

export const TEAM_CSV_COLUMNS = ['division', 'name', 'tag', 'city', 'color_1', 'color_2'] as const;
const REQUIRED = ['division', 'name', 'tag'] as const;

export interface TeamRow {
  division: string;
  name: string;
  tag: string;
  slug: string;
  city: string | null;
  colors: string[];
}

export type TeamsCsvResult = { ok: true; teams: TeamRow[] } | { ok: false; errors: string[] };

interface CsvRecord {
  record: Record<string, string | undefined>;
  info: { lines: number };
}

/**
 * Reads the teams file typed by the maintainer (`fixtures/lfr-s3-teams.csv`).
 * Every problem is reported with its line number; nothing is seeded from a file with errors.
 */
export function parseTeamsCsv(text: string, divisionNames: readonly string[]): TeamsCsvResult {
  let records: CsvRecord[];
  try {
    records = parse(text, {
      bom: true,
      columns: true,
      info: true,
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
  const teams: TeamRow[] = [];
  const seenTags = new Map<string, number>();
  const seenSlugs = new Map<string, number>();

  for (const { record, info } of records) {
    const line = info.lines;
    const fail = (problem: string) => errors.push(`line ${line}: ${problem}`);
    const value = (column: (typeof TEAM_CSV_COLUMNS)[number]) => record[column] ?? '';

    const before = errors.length;
    for (const column of REQUIRED) if (value(column) === '') fail(`${column} is missing`);
    if (errors.length > before) continue;

    const division = value('division');
    if (!divisionNames.includes(division)) {
      fail(`unknown division "${division}" (expected ${divisionNames.join(' or ')})`);
    }

    const tag = value('tag');
    const firstTagLine = seenTags.get(tag.toLowerCase());
    if (firstTagLine !== undefined) fail(`tag "${tag}" is already used on line ${firstTagLine}`);
    seenTags.set(tag.toLowerCase(), firstTagLine ?? line);

    const name = value('name');
    const slug = slugify(name);
    if (!slug.ok) {
      fail(`name "${name}" has no letter or digit to build a URL from`);
    } else {
      const firstSlugLine = seenSlugs.get(slug.slug);
      if (firstSlugLine !== undefined) {
        fail(`name "${name}" gives the same URL as the team on line ${firstSlugLine}`);
      }
      seenSlugs.set(slug.slug, firstSlugLine ?? line);
    }

    const colors = teamColorsSchema.safeParse([value('color_1'), value('color_2')].filter(Boolean));
    if (!colors.success) fail('colours must look like #1D4ED8');

    if (errors.length === before && slug.ok && colors.success) {
      teams.push({
        division,
        name,
        tag,
        slug: slug.slug,
        city: value('city') || null,
        colors: colors.data,
      });
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, teams };
}
