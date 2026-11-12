import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDatabase } from '../client.ts';
import { applyMigrations } from '../migrate.ts';
import { parseTeamsCsv } from '../seed/parse-teams-csv.ts';
import { hasChanges, LFR_DIVISION_NAMES, seedLfr } from '../seed/seed-lfr.ts';

// `pnpm seed`: loads LFR, Season 3, its two divisions and the teams of the CSV below.
const TEAMS_FILE = 'fixtures/lfr-s3-teams.csv';

const parsed = parseTeamsCsv(readFileSync(resolve(TEAMS_FILE), 'utf8'), LFR_DIVISION_NAMES);
if (!parsed.ok) {
  console.error(`${TEAMS_FILE} has problems; nothing was changed:`);
  for (const error of parsed.errors) console.error(`  ${error}`);
  process.exit(1);
}

const path = resolve(process.env.DATABASE_PATH ?? './data/ligo.db');
mkdirSync(dirname(path), { recursive: true });
const db = openDatabase(path);
try {
  applyMigrations(db);
  const summary = seedLfr(db, parsed.teams, Date.now());
  if (hasChanges(summary)) {
    const { created, updated } = summary;
    console.log(
      `Created ${created.orgs} org, ${created.competitions} competition, ${created.seasons} season, ` +
        `${created.divisions} divisions, ${created.teams} teams, ${created.slots} slots; ` +
        `updated ${updated.teams} teams, ${updated.slots} slots.`,
    );
  } else {
    console.log(`No changes: ${path} already matches ${TEAMS_FILE}.`);
  }
} finally {
  db.$client.close();
}
