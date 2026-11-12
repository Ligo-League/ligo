import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/index.ts';

/**
 * Opens the SQLite database with the settings every process needs:
 * WAL so the server and the worker can share the file, foreign keys enforced
 * (SQLite leaves them off by default), and a wait instead of an error when the file is locked.
 * Pass ':memory:' for tests. Close with `db.$client.close()`.
 */
export function openDatabase(path: string) {
  const client = new Database(path);
  client.pragma('journal_mode = WAL');
  client.pragma('foreign_keys = ON');
  client.pragma('busy_timeout = 5000');
  return drizzle({ client, schema });
}

export type Db = ReturnType<typeof openDatabase>;

/** The handle a `db.transaction` callback receives; it reads and writes like `Db`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
