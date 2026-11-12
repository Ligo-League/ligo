import { openDatabase, type Db } from './client.ts';
import { applyMigrations } from './migrate.ts';

/** A fresh in-memory database with every migration applied, for tests. */
export function openTestDatabase(): Db {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  return db;
}

// The seed functions build realistic data for the tests of packages that depend on this one.
export { linkGuild } from './seed/link-guild.ts';
export type { MatchRow } from './seed/matches-csv.ts';
export type { TeamRow } from './seed/parse-teams-csv.ts';
export { seedLfr } from './seed/seed-lfr.ts';
export { seedMatches } from './seed/seed-matches.ts';
