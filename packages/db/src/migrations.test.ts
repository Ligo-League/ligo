import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { applyMigrations } from './migrate.ts';
import * as schema from './schema/index.ts';
import { openTestDatabase } from './testing.ts';

// Schema v1: the tables phase 0 is allowed to create (design doc section 15, "Start here today").
const SCHEMA_V1_TABLES = [
  'audit_log',
  'competition',
  'division',
  'evidence',
  'game',
  'game_account',
  'league_guild',
  'lineup',
  'lineup_member',
  'match',
  'match_slot',
  'org',
  'player',
  'roster_entry',
  'sanction',
  'season',
  'slot',
  'stage',
  'stage_entry',
  'team',
  'team_staff',
];

// The schema module also exports the enum lists; keep only the tables.
const exported: unknown[] = Object.values(schema);
const drizzleTables = exported.filter((value): value is SQLiteTable => is(value, SQLiteTable));

function tableNames(db: ReturnType<typeof openTestDatabase>): string[] {
  const rows = db.$client
    .prepare(
      `select name from sqlite_master
       where type = 'table' and name not like 'sqlite_%' and name <> '__drizzle_migrations'
       order by name`,
    )
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

describe('migrations from an empty database', () => {
  it('create exactly the schema v1 tables', () => {
    const db = openTestDatabase();
    expect(tableNames(db)).toEqual(SCHEMA_V1_TABLES);
  });

  it('leave every table empty', () => {
    const db = openTestDatabase();
    for (const name of tableNames(db)) {
      const row = db.$client.prepare(`select count(*) as n from "${name}"`).get() as { n: number };
      expect(row.n, name).toBe(0);
    }
  });

  it('produce a consistent database with foreign keys enforced', () => {
    const db = openTestDatabase();
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.$client.pragma('foreign_key_check')).toEqual([]);
    expect(db.$client.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('can be applied again without changing anything', () => {
    const db = openTestDatabase();
    applyMigrations(db);
    expect(tableNames(db)).toEqual(SCHEMA_V1_TABLES);
  });
});

describe('the Drizzle schema and the migrations agree', () => {
  it('declares the same tables', () => {
    const declared = drizzleTables.map((table) => getTableConfig(table).name).sort();
    expect(declared).toEqual(SCHEMA_V1_TABLES);
  });

  it.each(drizzleTables.map((table) => [getTableConfig(table).name, table] as const))(
    '%s has the same columns',
    (name, table) => {
      const db = openTestDatabase();
      const migrated = db.$client.prepare(`select name from pragma_table_info(?)`).all(name) as {
        name: string;
      }[];
      const declared = getTableConfig(table).columns.map((column) => column.name);
      expect(migrated.map((column) => column.name).sort()).toEqual(declared.sort());
    },
  );
});
