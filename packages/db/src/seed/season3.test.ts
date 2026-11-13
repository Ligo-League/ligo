import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeStandings, isPossibleGameScore } from '@ligo/core';
import { R6_GAME_SCORE } from '@ligo/titles';
import { parse } from 'csv-parse/sync';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { loadStandingsInput } from '../queries/standings.ts';
import { division, stage } from '../schema/index.ts';
import { openTestDatabase } from '../testing.ts';
import { parseMatchesCsv } from './matches-csv.ts';
import { parseTeamsCsv } from './parse-teams-csv.ts';
import { LFR_DIVISION_NAMES, seedLfr } from './seed-lfr.ts';
import { seedMatches } from './seed-matches.ts';

// The acceptance test of phase 1 (design doc section 15): from the real Season 3 fixtures and
// results, Ligo computes the tables score7 shows. The three files are one snapshot, written
// together by `pnpm fixtures:score7`.
const fixtureFile = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../fixtures/${name}`, import.meta.url)), 'utf8');

const teams = parseTeamsCsv(fixtureFile('lfr-s3-teams.csv'), LFR_DIVISION_NAMES);
if (!teams.ok) throw new Error(teams.errors.join('\n'));
const matches = parseMatchesCsv(fixtureFile('lfr-s3-matches.csv'), teams.teams);
if (!matches.ok) throw new Error(matches.errors.join('\n'));

interface Score7Row {
  division: string;
  team: string;
  rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  scoreFor: number;
  scoreAgainst: number;
  diff: number;
  points: number;
}
const score7: Score7Row[] = parse<Record<string, string>>(
  fixtureFile('lfr-s3-standings.score7.csv'),
  { columns: true },
).map((row) => ({
  division: row.division ?? '',
  team: row.team ?? '',
  rank: Number(row.rank),
  played: Number(row.played),
  wins: Number(row.wins),
  draws: Number(row.draws),
  losses: Number(row.losses),
  scoreFor: Number(row.score_for),
  scoreAgainst: Number(row.score_against),
  diff: Number(row.diff),
  points: Number(row.points),
}));

// score7 is set to give 1 point for a draw. Ligo has no draws: a drawn row is left without
// result, so a team in one has that many fewer matches played and points than on score7.
const SCORE7_POINTS_FOR_DRAW = 1;

const db = openTestDatabase();
seedLfr(db, teams.teams, 1000);
const seedSummary = seedMatches(db, matches.matches, 2000);

describe('LFR Season 3 from the committed fixtures', () => {
  it('seeds every fixture without conflict', () => {
    expect(seedSummary.conflicts).toEqual([]);
    expect(seedSummary.created.matches).toBe(matches.matches.length);
    const drawn = matches.matches.filter((match) => match.result.kind === 'draw');
    expect(seedSummary.draws).toHaveLength(drawn.length);
  });

  it('holds only scores a map of R6 can end on', () => {
    const impossible = matches.matches.filter(
      ({ result }) =>
        result.kind === 'played' &&
        !isPossibleGameScore(R6_GAME_SCORE, result.scoreA, result.scoreB),
    );
    expect(impossible).toEqual([]);
  });

  it.each(LFR_DIVISION_NAMES)('reproduces the score7 table of %s', (divisionName) => {
    const stageRow = db
      .select({ id: stage.id })
      .from(stage)
      .innerJoin(division, eq(stage.divisionId, division.id))
      .where(eq(division.name, divisionName))
      .get();
    const data = loadStandingsInput(db, stageRow?.id ?? -1);
    if (!data) throw new Error(`No stage for ${divisionName}`);
    const result = computeStandings(data.input);
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    const computed = result.rows.map((row) => ({
      team: data.teams.find((team) => team.entry === row.entry)?.tag,
      rank: row.rank,
      played: row.played,
      wins: row.wins,
      losses: row.losses,
      scoreFor: row.scoreFor,
      scoreAgainst: row.scoreAgainst,
      diff: row.diff,
      points: row.points,
    }));
    const expected = score7
      .filter((row) => row.division === divisionName)
      .map((row) => ({
        team: row.team,
        rank: row.rank,
        played: row.played - row.draws,
        wins: row.wins,
        losses: row.losses,
        scoreFor: row.scoreFor,
        scoreAgainst: row.scoreAgainst,
        diff: row.diff,
        points: row.points - row.draws * SCORE7_POINTS_FOR_DRAW,
      }));

    expect(expected.length).toBeGreaterThan(0);
    expect(computed).toEqual(expected);
  });
});
