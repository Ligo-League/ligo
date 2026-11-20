import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { z } from 'zod';
import type { Db } from './client.ts';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

const journalSchema = z.object({
  entries: z.array(z.object({ tag: z.string(), when: z.number() })),
});

/**
 * The migrations not yet applied, in order. Drizzle applies those newer than the last one it
 * recorded, by their journal time; a database it never touched has none recorded.
 */
function pendingMigrations(db: Db, folder: string): { tag: string }[] {
  const journal = journalSchema.parse(
    JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')),
  );
  const client = db.$client;
  const recorded = client
    .prepare(
      `select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'`,
    )
    .get();
  const last = recorded
    ? (client.prepare('select max(created_at) as last from __drizzle_migrations').get() as {
        last: number | null;
      })
    : { last: null };
  if (last.last === null) return [];
  const since = last.last;
  return journal.entries.filter((entry) => entry.when > since);
}

/** `2026-11-20T09-30-15-250Z`: an instant a file name can hold on every system. */
const fileStamp = (now: number) => new Date(now).toISOString().replace(/[:.]/g, '-');

/** Where copies of a database file go: `backups/` next to it (`data/backups/` by default). */
export const backupFolder = (databasePath: string) => join(dirname(databasePath), 'backups');

export interface MigrationOptions {
  /**
   * Where to copy the database before applying pending migrations (design doc section 13). A
   * new database, with none applied yet, holds nothing to copy. Copies are never removed here.
   */
  backup?: { dir: string; now: number };
}

/**
 * Applies every migration not yet recorded in the database. Safe to run at each start.
 *
 * SQLite cannot change a column in place: a migration rebuilds the table, copying it into a new
 * one and dropping the old. With foreign keys enforced, dropping a table that others point at
 * (`team`, say) fails, and SQLite ignores the `foreign_keys` pragma inside the transaction the
 * migrator opens. So enforcement is off while migrations run, and every reference is checked
 * before it comes back on.
 */
export function applyMigrations(db: Db, options: MigrationOptions = {}): { backup: string | null } {
  const client = db.$client;
  let backup: string | null = null;
  const [first] = options.backup ? pendingMigrations(db, MIGRATIONS_FOLDER) : [];
  if (options.backup && first) {
    mkdirSync(options.backup.dir, { recursive: true });
    backup = join(
      options.backup.dir,
      `ligo-${fileStamp(options.backup.now)}-before-${first.tag}.db`,
    );
    // VACUUM INTO refuses a file that exists: a copy is never overwritten.
    if (existsSync(backup)) throw new Error(`A backup named ${backup} already exists`);
    client.prepare('VACUUM INTO ?').run(backup);
  }
  const enforced = client.pragma('foreign_keys', { simple: true }) === 1;
  client.pragma('foreign_keys = OFF');
  try {
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const broken = client.pragma('foreign_key_check') as unknown[];
    if (broken.length > 0) {
      throw new Error(`Migrations left ${String(broken.length)} rows pointing at nothing`);
    }
  } finally {
    if (enforced) client.pragma('foreign_keys = ON');
  }
  return { backup };
}
