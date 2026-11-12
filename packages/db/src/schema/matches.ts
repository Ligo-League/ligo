import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';
import { jsonText, oneOf } from '../columns.ts';
import { gameBansSchema } from '../json.ts';
import {
  EVIDENCE_KINDS,
  EVIDENCE_VISIBILITIES,
  GAME_STATUSES,
  LINEUP_ROLES,
  MATCH_SLOT_SOURCES,
  MATCH_STATUSES,
  SANCTION_KINDS,
  SANCTION_TARGETS,
  SIDES,
  STATS_SOURCES,
} from './enums.ts';
import { player, team } from './people.ts';
import { season, stage } from './structure.ts';

// Matches and results. Results are never hard-deleted: a match or game gets status 'void'.

export const match = sqliteTable(
  'match',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    stageId: integer('stage_id')
      .notNull()
      .references(() => stage.id),
    week: integer('week'),
    bracketNode: text('bracket_node'),
    bestOf: integer('best_of').notNull(),
    hostSide: text('host_side', { enum: SIDES }),
    sideChooser: text('side_chooser', { enum: SIDES }),
    otSideChooser: text('ot_side_chooser', { enum: SIDES }),
    status: text('status', { enum: MATCH_STATUSES }).notNull().default('scheduled'),
    windowStart: integer('window_start').notNull(),
    windowEnd: integer('window_end').notNull(),
    scheduledAt: integer('scheduled_at'),
    autoScheduled: integer('auto_scheduled', { mode: 'boolean' }).notNull().default(false),
    channelId: text('channel_id'),
    reportedBy: integer('reported_by').references(() => player.id),
    confirmedBy: integer('confirmed_by').references(() => player.id),
    validatedBy: integer('validated_by').references(() => player.id),
    validatedAt: integer('validated_at'),
  },
  (t) => [
    index('match_stage_week_idx').on(t.stageId, t.week),
    index('match_status_idx').on(t.status),
    check('match_host_side_check', oneOf(t.hostSide, SIDES)),
    check('match_side_chooser_check', oneOf(t.sideChooser, SIDES)),
    check('match_ot_side_chooser_check', oneOf(t.otSideChooser, SIDES)),
    check('match_status_check', oneOf(t.status, MATCH_STATUSES)),
  ],
);

// Where each side of a match comes from: a stage entry, a seed, or another match's winner/loser.
export const matchSlot = sqliteTable(
  'match_slot',
  {
    matchId: integer('match_id')
      .notNull()
      .references(() => match.id),
    side: text('side', { enum: SIDES }).notNull(),
    sourceKind: text('source_kind', { enum: MATCH_SLOT_SOURCES }).notNull(),
    // stage_entry.id, a seed number or a match.id, depending on source_kind.
    sourceRef: integer('source_ref').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.side] }),
    check('match_slot_side_check', oneOf(t.side, SIDES)),
    check('match_slot_source_kind_check', oneOf(t.sourceKind, MATCH_SLOT_SOURCES)),
  ],
);

export const lineup = sqliteTable(
  'lineup',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    matchId: integer('match_id')
      .notNull()
      .references(() => match.id),
    side: text('side', { enum: SIDES }).notNull(),
    // NULL in mixed-team leagues, where a lineup belongs to no team.
    teamId: integer('team_id').references(() => team.id),
  },
  (t) => [
    unique('lineup_match_side_unique').on(t.matchId, t.side),
    check('lineup_side_check', oneOf(t.side, SIDES)),
  ],
);

export const lineupMember = sqliteTable(
  'lineup_member',
  {
    lineupId: integer('lineup_id')
      .notNull()
      .references(() => lineup.id),
    playerId: integer('player_id')
      .notNull()
      .references(() => player.id),
    role: text('role', { enum: LINEUP_ROLES }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.lineupId, t.playerId] }),
    check('lineup_member_role_check', oneOf(t.role, LINEUP_ROLES)),
  ],
);

// One map (R6, Valorant) or one game of a series (Rocket League).
export const game = sqliteTable(
  'game',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    matchId: integer('match_id')
      .notNull()
      .references(() => match.id),
    n: integer('n').notNull(),
    map: text('map'),
    bansJson: jsonText(gameBansSchema)('bans_json').notNull(),
    scoreA: integer('score_a').notNull().default(0),
    scoreB: integer('score_b').notNull().default(0),
    overtime: integer('overtime', { mode: 'boolean' }).notNull().default(false),
    forfeitSide: text('forfeit_side', { enum: SIDES }),
    rehostsA: integer('rehosts_a').notNull().default(0),
    rehostsB: integer('rehosts_b').notNull().default(0),
    status: text('status', { enum: GAME_STATUSES }).notNull().default('pending'),
    statsSource: text('stats_source', { enum: STATS_SOURCES }).notNull().default('none'),
  },
  (t) => [
    unique('game_match_n_unique').on(t.matchId, t.n),
    check('game_forfeit_side_check', oneOf(t.forfeitSide, SIDES)),
    check('game_status_check', oneOf(t.status, GAME_STATUSES)),
    check('game_stats_source_check', oneOf(t.statsSource, STATS_SOURCES)),
  ],
);

// Proof attached to a match: a stored object (object_key) or an external link (url).
export const evidence = sqliteTable(
  'evidence',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    matchId: integer('match_id')
      .notNull()
      .references(() => match.id),
    gameId: integer('game_id').references(() => game.id),
    kind: text('kind', { enum: EVIDENCE_KINDS }).notNull(),
    objectKey: text('object_key'),
    url: text('url'),
    uploadedBy: integer('uploaded_by')
      .notNull()
      .references(() => player.id),
    // Defaults to the most private level: MOSS files and staff evidence are never public.
    visibility: text('visibility', { enum: EVIDENCE_VISIBILITIES }).notNull().default('staff'),
    at: integer('at').notNull(),
  },
  (t) => [
    index('evidence_match_idx').on(t.matchId),
    check('evidence_kind_check', oneOf(t.kind, EVIDENCE_KINDS)),
    check('evidence_visibility_check', oneOf(t.visibility, EVIDENCE_VISIBILITIES)),
    check('evidence_location_check', sql`${t.objectKey} is not null or ${t.url} is not null`),
  ],
);

export const sanction = sqliteTable(
  'sanction',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => season.id),
    targetKind: text('target_kind', { enum: SANCTION_TARGETS }).notNull(),
    // slot.id, team.id or player.id, depending on target_kind.
    targetId: integer('target_id').notNull(),
    kind: text('kind', { enum: SANCTION_KINDS }).notNull(),
    pointsDelta: integer('points_delta'),
    matchId: integer('match_id').references(() => match.id),
    startsAt: integer('starts_at').notNull(),
    endsAt: integer('ends_at'),
    reason: text('reason').notNull(),
    decidedBy: integer('decided_by')
      .notNull()
      .references(() => player.id),
  },
  (t) => [
    index('sanction_season_idx').on(t.seasonId),
    check('sanction_target_kind_check', oneOf(t.targetKind, SANCTION_TARGETS)),
    check('sanction_kind_check', oneOf(t.kind, SANCTION_KINDS)),
  ],
);
