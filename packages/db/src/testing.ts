import { openDatabase, type Db } from './client.ts';
import { applyMigrations } from './migrate.ts';

/** A fresh in-memory database with every migration applied, for tests. */
export function openTestDatabase(): Db {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  return db;
}
