import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDatabase } from '../client.ts';
import { applyMigrations, backupFolder } from '../migrate.ts';

// `pnpm db:migrate`: creates the database file if needed and applies pending migrations.
const path = resolve(process.env.DATABASE_PATH ?? './data/ligo.db');
mkdirSync(dirname(path), { recursive: true });

const db = openDatabase(path);
try {
  const { backup } = applyMigrations(db, { backup: { dir: backupFolder(path), now: Date.now() } });
  if (backup) console.log(`Copied the database before migrating: ${backup}`);
  console.log(`Migrations applied to ${path}`);
} finally {
  db.$client.close();
}
