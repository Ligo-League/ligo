import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { is } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './client.ts';
import { applyMigrations, MIGRATIONS_FOLDER } from './migrate.ts';
import * as schema from './schema/index.ts';
import { openTestDatabase } from './testing.ts';

// Schema v1, the tables phase 0 was allowed to create (design doc section 15, "Start here
// today"), plus each table a later migration adds: 0002 adds `dispute`, 0003 `match_proposal`,
// 0004 `veto_step`, 0007 `request` and `queue_post`.
const SCHEMA_TABLES = [
  'audit_log',
  'competition',
  'dispute',
  'division',
  'evidence',
  'game',
  'game_account',
  'league_guild',
  'lineup',
  'lineup_member',
  'match',
  'match_proposal',
  'match_slot',
  'org',
  'player',
  'queue_post',
  'request',
  'roster_entry',
  'sanction',
  'season',
  'slot',
  'stage',
  'stage_entry',
  'team',
  'team_staff',
  'veto_step',
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
  it('create exactly the expected tables', () => {
    const db = openTestDatabase();
    expect(tableNames(db)).toEqual(SCHEMA_TABLES);
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
    expect(tableNames(db)).toEqual(SCHEMA_TABLES);
  });
});

describe('the Drizzle schema and the migrations agree', () => {
  it('declares the same tables', () => {
    const declared = drizzleTables.map((table) => getTableConfig(table).name).sort();
    expect(declared).toEqual(SCHEMA_TABLES);
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

/** Applies the migrations up to `tag` only, from a copy of the folder with a shorter journal. */
function migrateUpTo(db: ReturnType<typeof openDatabase>, tag: string): void {
  const folder = mkdtempSync(join(tmpdir(), 'ligo-migrations-'));
  try {
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { tag: string }[];
    };
    const last = journal.entries.findIndex((entry) => entry.tag === tag);
    expect(last).toBeGreaterThanOrEqual(0);
    journal.entries = journal.entries.slice(0, last + 1);
    writeFileSync(journalPath, JSON.stringify(journal));
    migrate(db, { migrationsFolder: folder });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

describe('0006: team roles', () => {
  it('makes each manager the owner and the staff managers, and moves the staff limit', () => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, '0005_auto_exclusion');
    const run = (sql: string) => db.$client.exec(sql);
    run(
      `insert into org (id, name, slug, locale, settings_json) values (1, 'LFR', 'lfr', 'fr', '{}')`,
    );
    run(`insert into competition (id, org_id, title, name, slug, participant_mode, ruleset_json,
           points_json, tiebreak_json, scheduling_json, stat_schema_version, theme_json)
         values (1, 1, 'r6', 'LFR', 'lfr', 'team',
           '{"result_validation":"staff","team_staff_max":2}', '{}', '{}', '{}', 1, '{}')`);
    run(`insert into team (id, org_id, title, name, tag, slug, colors_json, socials_json, can_stream)
         values (1, 1, 'r6', 'Alpha', 'ALP', 'alpha', '[]', '{}', 0)`);
    run(`insert into player (id, org_id, slug, display_name, created_at)
         values (1, 1, 'a', 'A', 0), (2, 1, 'b', 'B', 0), (3, 1, 'c', 'C', 0)`);
    run(`insert into team_staff (team_id, player_id, role, since, until)
         values (1, 1, 'manager', 10, null), (1, 2, 'staff', 10, null), (1, 3, 'manager', 1, 10)`);

    applyMigrations(db);

    expect(
      db.$client.prepare('select player_id, role, until from team_staff order by player_id').all(),
    ).toEqual([
      { player_id: 1, role: 'owner', until: null },
      { player_id: 2, role: 'manager', until: null },
      { player_id: 3, role: 'owner', until: 10 },
    ]);
    const { ruleset_json } = db.$client.prepare('select ruleset_json from competition').get() as {
      ruleset_json: string;
    };
    expect(JSON.parse(ruleset_json)).toEqual({
      result_validation: 'staff',
      team_roles: { managers_max: 2, coaches_max: 1 },
    });
    expect(db.$client.pragma('foreign_key_check')).toEqual([]);
  });
});
