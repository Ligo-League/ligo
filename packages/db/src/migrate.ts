import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client.ts';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Applies every migration not yet recorded in the database. Safe to run at each start.
 *
 * SQLite cannot change a column in place: a migration rebuilds the table, copying it into a new
 * one and dropping the old. With foreign keys enforced, dropping a table that others point at
 * (`team`, say) fails, and SQLite ignores the `foreign_keys` pragma inside the transaction the
 * migrator opens. So enforcement is off while migrations run, and every reference is checked
 * before it comes back on.
 */
export function applyMigrations(db: Db): void {
  const client = db.$client;
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
}
