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
import { gameBansSchema, matchVetoSchema } from '../json.ts';
import {
  DISPUTE_RESOLUTIONS,
  PROPOSAL_STATUSES,
  EVIDENCE_KINDS,
  EVIDENCE_VISIBILITIES,
  GAME_STATUSES,
  LINEUP_ROLES,
  MATCH_SLOT_SOURCES,
  MATCH_STATUSES,
  SANCTION_KINDS,
  SANCTION_TARGETS,
  SIDES,
  START_SIDES,
  STATS_SOURCES,
  VETO_ACTIONS,
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
    // The veto, once started: its frozen settings, and the bot message that shows it.
    vetoJson: jsonText(matchVetoSchema)('veto_json'),
    vetoStartedAt: integer('veto_started_at'),
    vetoChannelId: text('veto_channel_id'),
    vetoMessageId: text('veto_message_id'),
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

// A team disputing a reported result, and how staff settled it. The reason and details are
// shown to staff only: a reason can accuse a player.
export const dispute = sqliteTable(
  'dispute',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    matchId: integer('match_id')
      .notNull()
      .references(() => match.id),
    // The report disputed: its score screenshot.
    evidenceId: integer('evidence_id')
      .notNull()
      .references(() => evidence.id),
    // A key of the competition's `dispute_reasons`, or "other"; kept if the label changes.
    reason: text('reason').notNull(),
    details: text('details'),
    raisedBy: integer('raised_by')
      .notNull()
      .references(() => player.id),
    at: integer('at').notNull(),
    resolution: text('resolution', { enum: DISPUTE_RESOLUTIONS }),
    resolvedBy: integer('resolved_by').references(() => player.id),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [
    index('dispute_match_idx').on(t.matchId),
    // A null resolution passes: SQLite's CHECK fails only on false.
    check('dispute_resolution_check', oneOf(t.resolution, DISPUTE_RESOLUTIONS)),
    // Settled entirely or not at all.
    check(
      'dispute_resolved_check',
      sql`(${t.resolution} is null) = (${t.resolvedBy} is null) and (${t.resolution} is null) = (${t.resolvedAt} is null)`,
    ),
  ],
);

// A time one team proposes for a match; the other team accepts or declines it.
export const matchProposal = sqliteTable(
  'match_proposal',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    matchId: integer('match_id')
      .notNull()
      .references(() => match.id),
    // The side of the match that proposes.
    side: text('side', { enum: SIDES }).notNull(),
    proposedBy: integer('proposed_by')
      .notNull()
      .references(() => player.id),
    // The proposed start of the match, Unix ms.
    at: integer('at').notNull(),
    createdAt: integer('created_at').notNull(),
    status: text('status', { enum: PROPOSAL_STATUSES }).notNull().default('pending'),
    answeredBy: integer('answered_by').references(() => player.id),
    answeredAt: integer('answered_at'),
  },
  (t) => [
    index('match_proposal_match_idx').on(t.matchId),
    check('match_proposal_side_check', oneOf(t.side, SIDES)),
    check('match_proposal_status_check', oneOf(t.status, PROPOSAL_STATUSES)),
  ],
);

// One step of a map veto, in order. The steps are the veto's whole state (packages/core veto.ts);
// the primary key makes a second click on the same step fail instead of playing twice.
export const vetoStep = sqliteTable(
  'veto_step',
  {
    matchId: integer('match_id')
      .notNull()
      .references(() => match.id),
    seq: integer('seq').notNull(),
    // The match side that chose, or won a toss; null for the decider, which nobody picks.
    side: text('side', { enum: SIDES }),
    action: text('action', { enum: VETO_ACTIONS }).notNull(),
    map: text('map'),
    startSide: text('start_side', { enum: START_SIDES }),
    // A coin toss decision: `side_selection` or `first_ban`, or the match side sent to ban first.
    choice: text('choice'),
    gameN: integer('game_n'),
    at: integer('at').notNull(),
    // Null when the clock chose for a team that ran out of time, and for the decider.
    byPlayerId: integer('by_player_id').references(() => player.id),
    timedOut: integer('timed_out', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.seq] }),
    check('veto_step_side_check', oneOf(t.side, SIDES)),
    check('veto_step_action_check', oneOf(t.action, VETO_ACTIONS)),
    check('veto_step_start_side_check', oneOf(t.startSide, START_SIDES)),
  ],
);
