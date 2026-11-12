import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { z } from 'zod';
import { formatCsv, formatMatchesCsv, type MatchRow } from '../seed/matches-csv.ts';
import { parseTeamsCsv } from '../seed/parse-teams-csv.ts';
import {
  score7ComponentsSchema,
  score7MatchListSchema,
  score7RoundMatchesSchema,
  score7StandingSchema,
  STANDINGS_CSV_COLUMNS,
  tagResolver,
  toMatchRow,
  toStandingLines,
} from '../seed/score7.ts';
import { LFR_DIVISION_NAMES } from '../seed/seed-lfr.ts';

// `pnpm fixtures:score7`: copies LFR Season 3's fixtures, results and standings from score7 into
// the two CSV files below, for the seed and for the shadow run that compares Ligo with score7.
// score7 has no documented API: this reads the same public addresses its own pages read, a few
// dozen requests one after the other. Run it by hand; nothing else in the project calls score7.
const API = 'https://api.score7.io/v2';
const TOURNAMENTS = [
  { division: 'Ligue 1', slug: 'lfrligue1' },
  { division: 'Ligue 2', slug: 'lfrligue2officiel' },
];
const TEAMS_FILE = 'fixtures/lfr-s3-teams.csv';
const MATCHES_FILE = 'fixtures/lfr-s3-matches.csv';
const STANDINGS_FILE = 'fixtures/lfr-s3-standings.score7.csv';

async function get<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
  const response = await fetch(`${API}/${path}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`score7 answered ${response.status} for ${path}`);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`score7's answer for ${path} has an unexpected shape`);
  return parsed.data;
}

/** A stage holds one group, a group one leg, a leg its rounds: anything else is not a league. */
async function onlyChild(parentId: number, type: string): Promise<number> {
  const children = await get(
    `calendarComponents/${parentId}/calendarComponents`,
    score7ComponentsSchema,
  );
  const [child, ...others] = children;
  if (!child || others.length > 0 || child.type !== type) {
    throw new Error(`Expected one ${type} under ${parentId}, found ${children.length}`);
  }
  return child.id;
}

const teams = parseTeamsCsv(readFileSync(resolve(TEAMS_FILE), 'utf8'), LFR_DIVISION_NAMES);
if (!teams.ok) {
  console.error(`${TEAMS_FILE} has problems:`);
  for (const error of teams.errors) console.error(`  ${error}`);
  process.exit(1);
}
const resolveTag = tagResolver(teams.teams);

const matches: MatchRow[] = [];
const standingLines: (string | number)[][] = [];
const problems: string[] = [];

try {
  for (const { division, slug } of TOURNAMENTS) {
    const stages = await get(`tournaments/${slug}/stages`, score7ComponentsSchema);
    const [stage, ...otherStages] = stages;
    if (!stage || otherStages.length > 0) {
      throw new Error(`Expected one stage in ${slug}, found ${stages.length}`);
    }
    const groupId = await onlyChild(stage.id, 'ROUNDROBIN_GROUP');
    const legId = await onlyChild(groupId, 'ROUNDROBIN_LEG');
    const rounds = await get(
      `calendarComponents/${legId}/calendarComponents`,
      score7ComponentsSchema,
    );
    const list = await get(`stages/${stage.id}/matches/byList`, score7MatchListSchema);
    const byId = new Map(list.map((match) => [match.id, match]));

    for (const round of [...rounds].sort((x, y) => x.ordinal - y.ordinal)) {
      const week = round.ordinal + 1;
      const { values } = await get(
        `roundRobinRounds/${round.id}/matches`,
        score7RoundMatchesSchema,
      );
      for (const { matchId } of values) {
        const match = byId.get(matchId);
        if (!match) {
          problems.push(`${division}, week ${week}: match ${matchId} is not in the match list`);
          continue;
        }
        const row = toMatchRow(division, week, match, resolveTag);
        if (row.ok) matches.push(row.row);
        else problems.push(row.error);
      }
    }

    const standing = await get(`calendarComponents/${groupId}/standing`, score7StandingSchema);
    const lines = toStandingLines(division, standing, resolveTag);
    if (lines.ok) standingLines.push(...lines.row);
    else problems.push(lines.error);
  }
} catch (error) {
  // Only the message: nothing of the request or the answer is printed.
  console.error(error instanceof Error ? error.message : 'Could not read score7');
  process.exit(1);
}

if (problems.length > 0) {
  console.error('score7 holds data this export cannot read; nothing was written:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

writeFileSync(resolve(MATCHES_FILE), formatMatchesCsv(matches));
writeFileSync(resolve(STANDINGS_FILE), formatCsv(STANDINGS_CSV_COLUMNS, standingLines));

for (const { division } of TOURNAMENTS) {
  const rows = matches.filter((match) => match.division === division);
  const count = (kind: MatchRow['result']['kind']) =>
    rows.filter((match) => match.result.kind === kind).length;
  console.log(
    `${division}: ${rows.length} matches (${count('played')} played, ${count('forfeit')} forfeits, ` +
      `${count('draw')} draws, ${count('none')} without result)`,
  );
}
const draws = matches.filter((match) => match.result.kind === 'draw');
for (const match of draws) {
  console.log(
    `Draw on score7, which Ligo will not count: ${match.division}, week ${match.week}, ` +
      `${match.teamA} v ${match.teamB}`,
  );
}
console.log(`Wrote ${MATCHES_FILE} and ${STANDINGS_FILE}.`);
