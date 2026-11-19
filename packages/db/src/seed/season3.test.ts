import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeStandings, isPossibleGameScore } from '@ligo/core';
import { R6_GAME_SCORE } from '@ligo/titles';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { loadStandingsInput } from '../queries/standings.ts';
import { division, slot, stage, team } from '../schema/index.ts';
import { openTestDatabase } from '../testing.ts';
import { parseMatchesCsv } from './matches-csv.ts';
import { parseTeamsCsv } from './parse-teams-csv.ts';
import { LFR_DIVISION_NAMES, seedLfr } from './seed-lfr.ts';
import { seedMatches } from './seed-matches.ts';

// LFR Season 3 as Ligo records it. `fixtures/lfr-s3-matches.csv` is the only source of truth for
// the season's matches (maintainer, 19 November 2026): score7 is no longer kept up to date, so
// its snapshot (`*.score7.csv`) is history and no test compares with it any more. Phase 1's
// acceptance, Ligo's tables equal to score7's from week 5, passed on that snapshot.
const fixtureFile = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../fixtures/${name}`, import.meta.url)), 'utf8');

const teams = parseTeamsCsv(fixtureFile('lfr-s3-teams.csv'), LFR_DIVISION_NAMES);
if (!teams.ok) throw new Error(teams.errors.join('\n'));
const record = parseMatchesCsv(fixtureFile('lfr-s3-matches.csv'), teams.teams);
if (!record.ok) throw new Error(record.errors.join('\n'));

const db = openTestDatabase();
seedLfr(db, teams.teams, 1000);
const summary = seedMatches(db, record.matches, 2000);

describe('LFR Season 3 as Ligo records it', () => {
  it('seeds every fixture without conflict, and holds no draw', () => {
    expect(summary.conflicts).toEqual([]);
    expect(summary.created.matches).toBe(record.matches.length);
    expect(summary.draws).toEqual([]);
  });

  it('holds only scores a map of R6 can end on', () => {
    const impossible = record.matches.filter(
      ({ result }) =>
        result.kind === 'played' &&
        !isPossibleGameScore(R6_GAME_SCORE, result.scoreA, result.scoreB),
    );
    expect(impossible).toEqual([]);
  });

  it('records a forfeit by both teams where neither showed up (O-28)', () => {
    const both = record.matches.find(
      (row) => row.teamA === 'NIGHTWOLVES' && row.teamB === 'OUTSOUKI',
    );
    expect(both?.result).toEqual({ kind: 'forfeit', forfeitBy: 'both' });
  });

  it('holds the excluded teams (maintainer, 19 November 2026)', () => {
    const reasons = Object.fromEntries(
      teams.teams.flatMap((entry) => (entry.excluded ? [[entry.tag, entry.excluded]] : [])),
    );
    expect(reasons).toEqual({
      NIGHTWOLVES: 'Exclue au 3e forfait',
      OUTSOUKI: 'Exclue au 3e forfait',
      RPV: 'A quitté la LFR',
    });
    const excluded = db
      .select({ tag: team.tag })
      .from(slot)
      .innerJoin(team, eq(slot.teamId, team.id))
      .where(eq(slot.status, 'excluded'))
      .all()
      .map((row) => row.tag)
      .sort();
    expect(excluded).toEqual(['NIGHTWOLVES', 'OUTSOUKI', 'RPV']);
  });

  it.each(LFR_DIVISION_NAMES)('computes the table of %s, every team in it once', (name) => {
    const stageRow = db
      .select({ id: stage.id })
      .from(stage)
      .innerJoin(division, eq(stage.divisionId, division.id))
      .where(eq(division.name, name))
      .get();
    const data = loadStandingsInput(db, stageRow?.id ?? -1);
    if (!data) throw new Error(`No stage for ${name}`);
    const result = computeStandings(data.input);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const tags = result.rows.map(
      (row) => data.teams.find((entry) => entry.entry === row.entry)?.tag,
    );
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags.sort()).toEqual(
      teams.teams
        .filter((entry) => entry.division === name)
        .map((entry) => entry.tag)
        .sort(),
    );
  });
});
