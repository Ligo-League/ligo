import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
// `rules_version`, 0014 `registration_invite` and `registration_player`, 0021 `match_captain`, 0023
// `mercato_window`, 0024 `stat` and `stat_sheet`.
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
  'match_captain',
  'match_proposal',
  'match_slot',
  'mercato_window',
  'org',
  'player',
  'queue_post',
  'registration_invite',
  'registration_player',
  'request',
  'roster_entry',
  'roster_invite',
  'roster_player',
  'rules_version',
  'sanction',
  'season',
  'slot',
  'stage',
  'stage_entry',
  'stat',
  'stat_sheet',
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

describe('0023: the mercato', () => {
  it('keeps requests and what points at them, accepts a move, and gives LFR its windows', () => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, '0022_mbl_group_org');
    const run = (sql: string) => db.$client.exec(sql);
    const LENIENT = '{"result_validation":"opponent"}';
    db.$client.pragma('foreign_keys = OFF');
    run(`insert into org (id, name, slug, settings_json) values (1, 'MBL Group', 'mbl-group', '{}'),
           (2, 'Other', 'other', '{}')`);
    run(`insert into competition (id, org_id, title, name, slug, participant_mode, ruleset_json,
           points_json, tiebreak_json, scheduling_json, stat_schema_version, theme_json)
         values (1, 1, 'r6', 'LFR', 'lfr', 'team', '${LENIENT}', '{}', '{}', '{}', 1, '{}'),
                (2, 2, 'r6', 'LFR', 'lfr', 'team', '${LENIENT}', '{}', '{}', '{}', 1, '{}')`);
    run(`insert into request (id, competition_id, team_id, kind, payload_json, approval,
           requested_by, requested_at) values (7, 1, 2, 'registration', '{}', 'staff', 3, 10)`);
    run(`insert into registration_player (request_id, player_id, role, joined_at)
         values (7, 3, 'player', 10)`);

    migrateUpTo(db, '0023_mercato');

    expect(db.$client.prepare('select id, kind, status from request').all()).toEqual([
      { id: 7, kind: 'registration', status: 'pending' },
    ]);
    expect(db.$client.prepare('select request_id from registration_player').all()).toEqual([
      { request_id: 7 },
    ]);
    expect(() =>
      run(`insert into request (competition_id, kind, payload_json, approval, requested_by,
             requested_at) values (1, 'roster_move', '{}', 'staff', 4, 20)`),
    ).not.toThrow();
    const mercato = (id: number) =>
      db.$client
        .prepare(
          `select json_extract(ruleset_json, '$.mercato') as m from competition where id = ?`,
        )
        .get(id);
    // Only the seed's LFR, in MBL Group; another group's league of the same name is left alone.
    expect(mercato(1)).toEqual({
      m: '{"mode":"windows","max_moves_per_team":3,"lock_hours":24,"intra_club_moves":"counted"}',
    });
    expect(mercato(2)).toEqual({ m: null });
    expect(() =>
      run(`insert into mercato_window (season_id, opens_at, closes_at, lock_hours, created_by,
             created_at) values (1, 20, 10, 24, 3, 1)`),
    ).toThrow(/CHECK/);
    expect(() =>
      run(`insert into mercato_window (season_id, opens_at, closes_at, max_moves_per_team,
             lock_hours, created_by, created_at) values (1, 10, 20, 0, 24, 3, 1)`),
    ).toThrow(/CHECK/);
    expect(() =>
      run(`insert into mercato_window (season_id, opens_at, closes_at, lock_hours, created_by,
             created_at) values (1, 10, 20, 0, 3, 1)`),
    ).not.toThrow();
  });
});

describe('0024: stats', () => {
  it('stores a stat once per game, player and metric, and checks a sheet’s entry and confirmation', () => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, '0024_stats');
    const run = (sql: string) => db.$client.exec(sql);
    db.$client.pragma('foreign_keys = OFF');
    run(
      `insert into stat (game_id, player_id, metric, value, source) values (1, 2, 'kills', 9, 'manual')`,
    );
    expect(() =>
      run(
        `insert into stat (game_id, player_id, metric, value, source) values (1, 2, 'kills', 3, 'manual')`,
      ),
    ).toThrow(/UNIQUE|PRIMARY/);
    expect(() =>
      run(
        `insert into stat (game_id, player_id, metric, value, source) values (1, 2, 'deaths', 3, 'typed')`,
      ),
    ).toThrow(/CHECK/);
    run(`insert into stat_sheet (game_id, side, entered_by, entered_at, entered_as)
         values (1, 'a', 2, 10, 'own')`);
    expect(() =>
      run(`insert into stat_sheet (game_id, side, entered_by, entered_at, entered_as)
           values (1, 'b', 2, 10, 'friend')`),
    ).toThrow(/CHECK/);
    expect(() =>
      run(`insert into stat_sheet (game_id, side, entered_by, entered_at, entered_as, confirmed_by)
           values (2, 'b', 2, 10, 'opponent', 3)`),
    ).toThrow(/CHECK/);
  });
});

describe('0025: each season’s own points and tie-breakers', () => {
  it('copies the competition’s into every season without its own, and keeps a season’s own', () => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, '0024_stats');
    const run = (sql: string) => db.$client.exec(sql);
    const POINTS = '{"outcomes":{"win":3,"loss":0}}';
    const TIEBREAK = '{"criteria":["points","diff"],"unresolved_tie":"shared"}';
    db.$client.pragma('foreign_keys = OFF');
    run(
      `insert into org (id, name, slug, settings_json) values (1, 'MBL Group', 'mbl-group', '{}')`,
    );
    run(`insert into competition (id, org_id, title, name, slug, participant_mode, ruleset_json,
           points_json, tiebreak_json, scheduling_json, stat_schema_version, theme_json)
         values (1, 1, 'r6', 'LFR', 'lfr', 'team', '{}', '${POINTS}', '${TIEBREAK}', '{}', 1, '{}')`);
    run(`insert into season (id, competition_id, name, starts_on, ends_on, settings_json, status)
         values (1, 1, 'Saison 3', '2026-10-19', '2026-12-20', '{"forfeit_score":[7,0]}', 'active'),
                (2, 1, 'Saison 2', '2026-06-01', '2026-08-01',
                 '{"forfeit_score":[7,0],"points":{"outcomes":{"win":1,"loss":0}}}', 'closed')`);

    migrateUpTo(db, '0025_season_points');

    const settings = (id: number) =>
      JSON.parse(
        (
          db.$client.prepare('select settings_json as s from season where id = ?').get(id) as {
            s: string;
          }
        ).s,
      ) as Record<string, unknown>;
    expect(settings(1)).toEqual({
      forfeit_score: [7, 0],
      points: { outcomes: { win: 3, loss: 0 } },
      tiebreak: { criteria: ['points', 'diff'], unresolved_tie: 'shared' },
    });
    expect(settings(2)).toEqual({
      forfeit_score: [7, 0],
      points: { outcomes: { win: 1, loss: 0 } },
    });
  });
});

describe('0026: MLB Group and its owner', () => {
  it('fixes the name’s typo and gives the organisation its owner, once', () => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, '0025_season_points');
    db.$client.exec(`insert into org (id, name, slug, settings_json)
      values (1, 'MBL Group', 'mbl-group', '{}'), (2, 'Other', 'other', '{}')`);

    migrateUpTo(db, '0026_mlb_group_owner');

    expect(
      db.$client
        .prepare(
          'select id, name, slug, owner_discord_user_id as owner, invite_url as invite from org',
        )
        .all(),
    ).toEqual([
      { id: 1, name: 'MLB Group', slug: 'mlb-group', owner: '994597181476569170', invite: null },
      { id: 2, name: 'Other', slug: 'other', owner: null, invite: null },
    ]);
  });
});

describe('0027: each side of a forfeit has its own rounds', () => {
  it('turns a single pair into mirrored sides, and leaves sides already split alone', () => {
    const db = openDatabase(':memory:');
    migrateUpTo(db, '0026_mlb_group_owner');
    db.$client.pragma('foreign_keys = OFF');
    db.$client
      .exec(`insert into season (id, competition_id, name, starts_on, ends_on, settings_json, status)
      values (1, 1, 'Saison 3', '2026-10-19', '2026-12-20',
              '{"forfeit_score":[7,0],"exclusion_forfeit_score":null,"map_pool":[]}', 'active'),
             (2, 1, 'Saison 2', '2026-06-01', '2026-08-01',
              '{"forfeit_score":[7,0],"exclusion_forfeit_score":[0,0]}', 'closed'),
             (3, 1, 'Saison 4', '2027-01-04', '2027-03-14',
              '{"forfeit_score":{"winner":[7,3],"loser":[0,7]},"exclusion_forfeit_score":null}',
              'registration')`);

    migrateUpTo(db, '0027_forfeit_score_sides');

    const settings = (id: number) =>
      JSON.parse(
        (
          db.$client.prepare('select settings_json as s from season where id = ?').get(id) as {
            s: string;
          }
        ).s,
      ) as Record<string, unknown>;
    expect(settings(1)).toEqual({
      forfeit_score: { winner: [7, 0], loser: [0, 7] },
      exclusion_forfeit_score: null,
      map_pool: [],
    });
    expect(settings(2)).toEqual({
      forfeit_score: { winner: [7, 0], loser: [0, 7] },
      exclusion_forfeit_score: { winner: [0, 0], loser: [0, 0] },
    });
    expect(settings(3)).toEqual({
      forfeit_score: { winner: [7, 3], loser: [0, 7] },
      exclusion_forfeit_score: null,
    });
  });
});

describe('the copy taken before migrations (design doc section 13)', () => {
  const NOW = Date.UTC(2026, 10, 20, 9, 30, 15, 250);
  /** A database file in its own folder, stopped at `tag`, with one organisation in it. */
  function oldDatabase(tag: string) {
    const folder = mkdtempSync(join(tmpdir(), 'ligo-backup-'));
    const db = openDatabase(join(folder, 'ligo.db'));
    migrateUpTo(db, tag);
    db.$client.exec(
      `insert into org (id, name, slug, settings_json) values (1, 'MLB', 'mlb', '{}')`,
    );
    return { db, folder, backups: join(folder, 'backups') };
  }

  it('copies the database as it was, then migrates it', () => {
    const { db, folder, backups } = oldDatabase('0027_forfeit_score_sides');
    try {
      const { backup } = applyMigrations(db, { backup: { dir: backups, now: NOW } });
      expect(backup).toBe(
        join(backups, 'ligo-2026-11-20T09-30-15-250Z-before-0028_player_slug_global.db'),
      );
      const copy = openDatabase(backup ?? '');
      // The organisation, at 0027: the index 0028 adds is not there yet.
      expect(copy.$client.prepare('select slug from org').all()).toEqual([{ slug: 'mlb' }]);
      const indexes = (client: typeof copy.$client) =>
        client.prepare(`select name from sqlite_master where name = 'player_slug_unique'`).all();
      expect(indexes(copy.$client)).toEqual([]);
      copy.$client.close();
      expect(indexes(db.$client)).toEqual([{ name: 'player_slug_unique' }]);
    } finally {
      db.$client.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('takes no copy when nothing is pending, and never removes one', () => {
    const { db, folder, backups } = oldDatabase('0027_forfeit_score_sides');
    try {
      applyMigrations(db, { backup: { dir: backups, now: NOW } });
      expect(applyMigrations(db, { backup: { dir: backups, now: NOW + 1 } })).toEqual({
        backup: null,
      });
      expect(readdirSync(backups)).toHaveLength(1);
    } finally {
      db.$client.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('takes no copy of a new database, which holds nothing yet', () => {
    const folder = mkdtempSync(join(tmpdir(), 'ligo-backup-'));
    const db = openDatabase(join(folder, 'ligo.db'));
    try {
      expect(applyMigrations(db, { backup: { dir: join(folder, 'backups'), now: NOW } })).toEqual({
        backup: null,
      });
      expect(existsSync(join(folder, 'backups'))).toBe(false);
    } finally {
      db.$client.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
