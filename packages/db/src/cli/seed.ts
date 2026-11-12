import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDatabase } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { linkGuild } from '../seed/link-guild.ts';
import { parseMatchesCsv } from '../seed/matches-csv.ts';
import { parseTeamsCsv } from '../seed/parse-teams-csv.ts';
import { hasChanges, LFR_DIVISION_NAMES, seedLfr } from '../seed/seed-lfr.ts';
import { matchSeedHasChanges, seedMatches } from '../seed/seed-matches.ts';

// `pnpm seed`: loads LFR, Season 3, its two divisions, the teams and the fixtures and results of
// the CSV files below. `pnpm fixtures:score7` refreshes the matches file from score7.
// With DISCORD_GUILD_ID and DISCORD_STAFF_ROLE_ID set, it also links that server to LFR.
const TEAMS_FILE = 'fixtures/lfr-s3-teams.csv';
const MATCHES_FILE = 'fixtures/lfr-s3-matches.csv';

const teams = parseTeamsCsv(readFileSync(resolve(TEAMS_FILE), 'utf8'), LFR_DIVISION_NAMES);
const matches = teams.ok
  ? parseMatchesCsv(readFileSync(resolve(MATCHES_FILE), 'utf8'), teams.teams)
  : undefined;
for (const [file, parsed] of [
  [TEAMS_FILE, teams],
  [MATCHES_FILE, matches],
] as const) {
  if (parsed && !parsed.ok) {
    console.error(`${file} has problems; nothing was changed:`);
    for (const error of parsed.errors) console.error(`  ${error}`);
    process.exit(1);
  }
}
// Both files were checked just above; this only narrows the types.
if (!teams.ok || !matches?.ok) process.exit(1);

const SNOWFLAKE = /^\d{17,20}$/;
const guildId = process.env.DISCORD_GUILD_ID ?? '';
const staffRoleId = process.env.DISCORD_STAFF_ROLE_ID ?? '';
if (staffRoleId !== '' && !(SNOWFLAKE.test(guildId) && SNOWFLAKE.test(staffRoleId))) {
  console.error('DISCORD_GUILD_ID and DISCORD_STAFF_ROLE_ID must be IDs of 17 to 20 digits.');
  process.exit(1);
}

const path = resolve(process.env.DATABASE_PATH ?? './data/ligo.db');
mkdirSync(dirname(path), { recursive: true });
const db = openDatabase(path);
try {
  applyMigrations(db);
  const now = Date.now();

  const summary = seedLfr(db, teams.teams, now);
  if (hasChanges(summary)) {
    const { created, updated } = summary;
    console.log(
      `Created ${created.orgs} org, ${created.competitions} competition, ${created.seasons} season, ` +
        `${created.divisions} divisions, ${created.teams} teams, ${created.slots} slots; ` +
        `updated ${updated.competitions} competition settings, ${updated.teams} teams, ` +
        `${updated.slots} slots.`,
    );
  } else {
    console.log(`No changes: ${path} already matches ${TEAMS_FILE}.`);
  }

  const matchSummary = seedMatches(db, matches.matches, now);
  if (matchSeedHasChanges(matchSummary)) {
    const { created, results } = matchSummary;
    console.log(
      `Created ${created.stages} stages, ${created.entries} entries, ${created.matches} matches; ` +
        `recorded ${results.played} played results and ${results.forfeits} forfeits.`,
    );
  } else {
    console.log(`No changes: ${path} already matches ${MATCHES_FILE}.`);
  }
  for (const draw of matchSummary.draws) {
    console.log(`Left without result (a draw in the file; the league has no draws): ${draw}`);
  }
  if (staffRoleId === '') {
    console.log(
      'Discord server not linked: set DISCORD_STAFF_ROLE_ID in .env and run pnpm seed again ' +
        '(docs/setup.md).',
    );
  } else {
    const linked = linkGuild(db, { guildId, staffRoleId }, now);
    console.log(`Discord server ${guildId}: link to LFR ${linked}.`);
  }

  if (matchSummary.conflicts.length > 0) {
    console.error('Stored results that differ from the file were left as stored:');
    for (const conflict of matchSummary.conflicts) console.error(`  ${conflict}`);
    process.exitCode = 1;
  }
} finally {
  db.$client.close();
}
