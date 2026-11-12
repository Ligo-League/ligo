import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDatabase } from '../client.ts';
import { applyMigrations } from '../migrate.ts';

// `pnpm db:migrate`: creates the database file if needed and applies pending migrations.
const path = resolve(process.env.DATABASE_PATH ?? './data/ligo.db');
mkdirSync(dirname(path), { recursive: true });

const db = openDatabase(path);
try {
  applyMigrations(db);
  console.log(`Migrations applied to ${path}`);
} finally {
  db.$client.close();
}
