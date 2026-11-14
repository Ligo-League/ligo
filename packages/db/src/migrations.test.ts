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
// 0004 `veto_step`, 0007 `request` and `queue_post`, 0009 `club`, 0010 `club_staff`, 0013
// `rules_version`, 0014 `registration_invite` and `registration_player`.
const SCHEMA_TABLES = [
  'audit_log',
  'club',
  'club_staff',
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
  'registration_invite',
  'registration_player',
  'request',
  'roster_entry',
  'rules_version',
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

    // Up to 0006 only: 0010 later moves owners to their club.
    migrateUpTo(db, '0006_team_roles');

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

describe('0008: the veto coin toss', () => {
  it('keeps the steps already taken, and accepts the coin toss steps', () => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, '0007_requests');
    // A step on its own: the match it belongs to does not matter to the table rebuild.
    db.$client.pragma('foreign_keys = OFF');
    db.$client.exec(`insert into veto_step (match_id, seq, side, action, map, at, timed_out)
                     values (1, 0, 'a', 'ban', 'Bank', 5, 0)`);

    // Up to 0008 only: applyMigrations would refuse the step's missing match.
    migrateUpTo(db, '0008_veto_coin_toss');

    expect(db.$client.prepare('select * from veto_step').all()).toEqual([
      {
        match_id: 1,
        seq: 0,
        side: 'a',
        action: 'ban',
        map: 'Bank',
        start_side: null,
        choice: null,
        game_n: null,
        at: 5,
        by_player_id: null,
        timed_out: 0,
      },
    ]);
    const insert = (seq: number, action: string, choice: string | null) =>
      db.$client
        .prepare(
          `insert into veto_step (match_id, seq, side, action, choice, at) values (1, ?, 'b', ?, ?, 6)`,
        )
        .run(seq, action, choice);
    expect(() => insert(1, 'toss_choice', 'first_ban')).not.toThrow();
    expect(() => insert(2, 'first_ban', 'a')).not.toThrow();
    expect(() => insert(3, 'toss', null)).not.toThrow();
    expect(() => insert(4, 'coin', null)).toThrow(/CHECK/);
  });
});

describe('0009: clubs', () => {
  it('gives every team a club of its own, with foreign keys enforced throughout', () => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, '0008_veto_coin_toss');
    const run = (sql: string) => db.$client.exec(sql);
    run(`insert into org (id, name, slug, settings_json) values (1, 'LFR', 'lfr', '{}')`);
    run(`insert into player (id, org_id, slug, display_name, created_at)
         values (1, 1, 'ana', 'Ana', 0)`);
    run(`insert into team (id, org_id, title, name, tag, slug, city, legal_status, colors_json,
                           logo_key, socials_json, discord_url, can_stream)
         values (7, 1, 'r6', 'Greed Esport', 'GREED1', 'greed-esport', 'Lyon', 'association',
                 '["#800080","#000000"]', 'logos/greed.png', '[]', 'https://discord.gg/x', 1)`);
    // A row pointing at the team: dropping the old table must not break it.
    run(`insert into team_staff (team_id, player_id, role, since) values (7, 1, 'coach', 0)`);

    applyMigrations(db);

    expect(db.$client.prepare('select * from club').all()).toEqual([
      {
        id: 1,
        org_id: 1,
        name: 'Greed Esport',
        slug: 'greed-esport',
        city: 'Lyon',
        legal_status: 'association',
        colors_json: '["#800080","#000000"]',
        logo_key: 'logos/greed.png',
        socials_json: '[]',
        discord_url: 'https://discord.gg/x',
      },
    ]);
    expect(db.$client.prepare('select * from team').all()).toEqual([
      {
        id: 7,
        org_id: 1,
        club_id: 1,
        title: 'r6',
        name: 'Greed Esport',
        tag: 'GREED1',
        slug: 'greed-esport',
        colors_json: null,
        logo_key: null,
        can_stream: 1,
        discord_role_id: null,
      },
    ]);
    expect(db.$client.prepare('select team_id from team_staff').all()).toEqual([{ team_id: 7 }]);
    expect(db.$client.pragma('foreign_key_check')).toEqual([]);
    // Enforcement is back on once migrations are done.
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() =>
      run(`insert into team_staff (team_id, player_id, role, since)
                      values (99, 1, 'owner', 0)`),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe('applyMigrations', () => {
  it('refuses to finish with rows pointing at nothing', () => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, '0008_veto_coin_toss');
    db.$client.pragma('foreign_keys = OFF');
    db.$client.exec(`insert into team_staff (team_id, player_id, role, since)
                     values (99, 99, 'coach', 0)`);
    expect(() => {
      applyMigrations(db);
    }).toThrow('Migrations left 2 rows pointing at nothing');
  });
});

describe('0010 and 0011: club officials', () => {
  it('makes each team owner the owner of its club; a second owner of a club becomes a manager', () => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, '0009_clubs');
    const run = (sql: string) => db.$client.exec(sql);
    run(`insert into org (id, name, slug, settings_json) values (1, 'LFR', 'lfr', '{}')`);
    for (const id of [1, 2, 3, 4]) {
      run(`insert into player (id, org_id, slug, display_name, created_at)
           values (${String(id)}, 1, 'p${String(id)}', 'P${String(id)}', 0)`);
    }
    run(`insert into club (id, org_id, name, slug, colors_json, socials_json)
         values (1, 1, 'Greed', 'greed', '[]', '[]')`);
    // Greed's two rosters had owners 1 (first) and 2; player 1 also owned the second, earlier.
    run(`insert into team (id, org_id, club_id, title, name, tag, slug)
         values (1, 1, 1, 'r6', 'Greed Esport', 'GREED1', 'greed-esport'),
                (2, 1, 1, 'r6', 'GREED Academy', 'GREED2', 'greed-academy')`);
    run(`insert into team_staff (team_id, player_id, role, since, until) values
           (1, 1, 'owner', 10, null),
           (2, 2, 'owner', 20, null),
           (2, 4, 'owner', 1, 5),
           (2, 3, 'coach', 30, null)`);

    applyMigrations(db);

    expect(
      db.$client
        .prepare('select club_id, player_id, role, since, until from club_staff order by since')
        .all(),
    ).toEqual([
      { club_id: 1, player_id: 4, role: 'owner', since: 1, until: 5 },
      { club_id: 1, player_id: 1, role: 'owner', since: 10, until: null },
      { club_id: 1, player_id: 2, role: 'manager', since: 20, until: null },
    ]);
    expect(db.$client.prepare('select team_id, player_id, role from team_staff').all()).toEqual([
      { team_id: 2, player_id: 3, role: 'coach' },
    ]);
    expect(db.$client.pragma('foreign_key_check')).toEqual([]);
  });
});

describe('0012: a forfeit by both teams', () => {
  it('keeps the games already stored, and accepts a forfeit by both teams', () => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, '0011_club_owners');
    // A game on its own: the match it belongs to does not matter to the table rebuild.
    db.$client.pragma('foreign_keys = OFF');
    db.$client.exec(`insert into game (match_id, n, bans_json, forfeit_side, status)
                     values (1, 1, '[]', 'a', 'final')`);

    migrateUpTo(db, '0012_forfeit_by_both');

    expect(db.$client.prepare('select match_id, n, forfeit_side, status from game').all()).toEqual([
      { match_id: 1, n: 1, forfeit_side: 'a', status: 'final' },
    ]);
    const insert = (matchId: number, side: string) =>
      db.$client
        .prepare(`insert into game (match_id, n, bans_json, forfeit_side) values (?, 1, '[]', ?)`)
        .run(matchId, side);
    expect(() => insert(2, 'both')).not.toThrow();
    expect(() => insert(3, 'neither')).toThrow(/CHECK/);
  });
});

describe('0014: registration', () => {
  it('keeps requests and game accounts, and accepts a registration and a name without an ID', () => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, '0013_rules_version');
    const run = (sql: string) => db.$client.exec(sql);
    // Rows on their own: what they point at does not matter to the table rebuilds.
    db.$client.pragma('foreign_keys = OFF');
    run(`insert into request (competition_id, team_id, kind, payload_json, approval, requested_by,
           requested_at) values (1, 2, 'team_owner', '{"playerId":3}', 'staff', 3, 10)`);
    run(`insert into game_account (player_id, title, external_id, display_name, verified)
         values (3, 'r6', 'a1b2c3d4-0000-4000-8000-00000000000f', 'Nivalem', 1)`);

    migrateUpTo(db, '0014_registration');

    expect(db.$client.prepare('select kind, status, team_id from request').all()).toEqual([
      { kind: 'team_owner', status: 'pending', team_id: 2 },
    ]);
    expect(
      db.$client
        .prepare('select display_name, external_id, rank, verified from game_account')
        .all(),
    ).toEqual([
      {
        display_name: 'Nivalem',
        external_id: 'a1b2c3d4-0000-4000-8000-00000000000f',
        rank: null,
        verified: 1,
      },
    ]);
    expect(() =>
      run(`insert into request (competition_id, kind, payload_json, approval, requested_by,
             requested_at) values (1, 'registration', '{}', 'staff', 4, 20)`),
    ).not.toThrow();
    // A name without its profileID yet; one account per player and title.
    expect(() =>
      run(`insert into game_account (player_id, title, display_name) values (4, 'r6', 'Leik')`),
    ).not.toThrow();
    expect(() =>
      run(`insert into game_account (player_id, title, display_name) values (4, 'r6', 'Other')`),
    ).toThrow(/UNIQUE/);
  });
});
