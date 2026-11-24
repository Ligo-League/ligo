import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';
import { jsonText, oneOf } from '../columns.ts';
import { operatorSwapsSchema, parsedUnitJsonSchema, teamMapSchema } from '../json.ts';
import {
  GAME_ROUND_KINDS,
  RAW_STATUSES,
  REPLAY_VERIFICATIONS,
  ROUND_EVENT_KINDS,
  SEGMENT_ISSUES,
  SEGMENT_STATUSES,
  SIDES,
} from './enums.ts';
import { game, match } from './matches.ts';
import { player } from './people.ts';

// Replays (design doc section 8; phase 5). A file is one unit (an R6 round) as the browser
// parsed and normalised it; a segment is one game lobby; its rounds' facts come from one
// canonical file each. `game_round` is the official map, rebuilt by every stitch: facts stay
// keyed by (segment, local round), so a new plan only changes which rounds count.

export const replayFile = sqliteTable(
  'replay_file',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    matchId: integer('match_id')
      .notNull()
      .references(() => match.id),
    uploaderPlayerId: integer('uploader_player_id')
      .notNull()
      .references(() => player.id),
    title: text('title').notNull(),
    fileName: text('file_name').notNull(),
    size: integer('size').notNull(),
    // Duplicates are refused: one row per file, whoever sends it again (section 8, retention).
    sha256: text('sha256').notNull().unique(),
    lobbyId: text('lobby_id').notNull(),
    unitNumber: integer('unit_number').notNull(),
    // The team whose player's game recorded the file (M-49: each team its own recording).
    recordedSide: text('recorded_side', { enum: SIDES }),
    parserVersion: text('parser_version').notNull(),
    parsedJson: jsonText(parsedUnitJsonSchema)('parsed_json').notNull(),
    rawStatus: text('raw_status', { enum: RAW_STATUSES }).notNull().default('none'),
    rawKey: text('raw_key'),
    verified: text('verified', { enum: REPLAY_VERIFICATIONS }).notNull().default('unverified'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('replay_file_match_lobby_idx').on(t.matchId, t.lobbyId),
    check('replay_file_recorded_side_check', oneOf(t.recordedSide, SIDES)),
    check('replay_file_raw_status_check', oneOf(t.rawStatus, RAW_STATUSES)),
    check('replay_file_verified_check', oneOf(t.verified, REPLAY_VERIFICATIONS)),
    check('replay_file_raw_key_check', sql`${t.rawStatus} <> 'stored' or ${t.rawKey} is not null`),
  ],
);

export const replaySegment = sqliteTable(
  'replay_segment',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    matchId: integer('match_id')
      .notNull()
      .references(() => match.id),
    // Null while the lobby is in no game (`status` unassigned, `issue` says why).
    gameId: integer('game_id').references(() => game.id),
    lobbyId: text('lobby_id').notNull(),
    startedAt: integer('started_at').notNull(),
    // The match side of each file side, once the players resolved them.
    teamMapJson: jsonText(teamMapSchema)('team_map_json'),
    // The team that called the re-host this lobby began with, as the teams declared (O-14).
    rehostCalledBy: text('rehost_called_by', { enum: SIDES }),
    status: text('status', { enum: SEGMENT_STATUSES }).notNull(),
    issue: text('issue', { enum: SEGMENT_ISSUES }),
  },
  (t) => [
    unique('replay_segment_match_lobby_unique').on(t.matchId, t.lobbyId),
    index('replay_segment_game_idx').on(t.gameId),
    check('replay_segment_status_check', oneOf(t.status, SEGMENT_STATUSES)),
    check('replay_segment_issue_check', oneOf(t.issue, SEGMENT_ISSUES)),
    check('replay_segment_called_by_check', oneOf(t.rehostCalledBy, SIDES)),
    check(
      'replay_segment_assigned_check',
      sql`(${t.status} = 'ok') = (${t.gameId} is not null and ${t.teamMapJson} is not null)`,
    ),
  ],
);

export const segmentRound = sqliteTable(
  'segment_round',
  {
    segmentId: integer('segment_id')
      .notNull()
      .references(() => replaySegment.id),
    localN: integer('local_n').notNull(),
    canonicalFileId: integer('canonical_file_id')
      .notNull()
      .references(() => replayFile.id),
    complete: integer('complete', { mode: 'boolean' }).notNull(),
    // File sides (0 or 1): the segment's team map makes them teams.
    winnerIdx: integer('winner_idx'),
    winCondition: text('win_condition'),
    attackerIdx: integer('attacker_idx').notNull(),
    site: text('site'),
    // From the win condition only, until the parser finds every plant (M-50).
    planted: integer('planted', { mode: 'boolean' }).notNull(),
    // Recordings of this round received, the canonical one included.
    povCount: integer('pov_count').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.segmentId, t.localN] }),
    check('segment_round_winner_check', sql`${t.winnerIdx} in (0, 1)`),
    check('segment_round_attacker_check', sql`${t.attackerIdx} in (0, 1)`),
  ],
);

// Level 2 (design doc section 9): each player's round, from the canonical file. `idx` is the
// player's place in that file's unit, which events name. Plants and defuses wait for M-50.
export const roundPlayer = sqliteTable(
  'round_player',
  {
    segmentId: integer('segment_id')
      .notNull()
      .references(() => replaySegment.id),
    localN: integer('local_n').notNull(),
    idx: integer('idx').notNull(),
    // The game account in the file (null when a build hides it), and its Ligo player if known.
    account: text('account'),
    playerId: integer('player_id').references(() => player.id),
    name: text('name').notNull(),
    sideIdx: integer('side_idx').notNull(),
    operator: text('operator'),
    operatorSwapsJson: jsonText(operatorSwapsSchema)('operator_swaps_json'),
    kills: integer('kills').notNull(),
    died: integer('died', { mode: 'boolean' }).notNull(),
    assists: integer('assists').notNull(),
    headshots: integer('headshots').notNull(),
    openingKill: integer('opening_kill', { mode: 'boolean' }).notNull(),
    openingDeath: integer('opening_death', { mode: 'boolean' }).notNull(),
    tradeKills: integer('trade_kills').notNull(),
    traded: integer('traded', { mode: 'boolean' }).notNull(),
    survived: integer('survived', { mode: 'boolean' }).notNull(),
    left: integer('left', { mode: 'boolean' }).notNull(),
    kost: integer('kost', { mode: 'boolean' }).notNull(),
    // Opponents alive when the player became the side's last; 0 without a clutch.
    clutchVs: integer('clutch_vs').notNull(),
    clutchWon: integer('clutch_won', { mode: 'boolean' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.segmentId, t.localN, t.idx] }),
    index('round_player_player_idx').on(t.playerId),
    check('round_player_side_check', sql`${t.sideIdx} in (0, 1)`),
  ],
);

/** Kills, deaths and departures in feed order; players are `round_player.idx`. */
export const killEvent = sqliteTable(
  'kill_event',
  {
    segmentId: integer('segment_id')
      .notNull()
      .references(() => replaySegment.id),
    localN: integer('local_n').notNull(),
    seq: integer('seq').notNull(),
    kind: text('kind', { enum: ROUND_EVENT_KINDS }).notNull(),
    elapsedS: real('elapsed_s'),
    actorIdx: integer('actor_idx'),
    targetIdx: integer('target_idx'),
    headshot: integer('headshot', { mode: 'boolean' }).notNull().default(false),
    teamKill: integer('team_kill', { mode: 'boolean' }).notNull().default(false),
    trade: integer('trade', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.segmentId, t.localN, t.seq] }),
    check('kill_event_kind_check', oneOf(t.kind, ROUND_EVENT_KINDS)),
  ],
);

/** The official map, round by round: what the last stitch, or staff, decided. */
export const gameRound = sqliteTable(
  'game_round',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    gameId: integer('game_id')
      .notNull()
      .references(() => game.id),
    // 1, 2, … for rounds that count; null for void ones.
    n: integer('n'),
    kind: text('kind', { enum: GAME_ROUND_KINDS }).notNull(),
    segmentId: integer('segment_id').references(() => replaySegment.id),
    localN: integer('local_n'),
    winnerSide: text('winner_side', { enum: SIDES }),
    // `interrupted`, `after_end`, or staff's own words.
    reason: text('reason'),
    decidedBy: integer('decided_by').references(() => player.id),
  },
  (t) => [
    index('game_round_game_idx').on(t.gameId),
    unique('game_round_game_n_unique').on(t.gameId, t.n),
    check('game_round_kind_check', oneOf(t.kind, GAME_ROUND_KINDS)),
    check('game_round_winner_check', oneOf(t.winnerSide, SIDES)),
    check(
      'game_round_shape_check',
      sql`case ${t.kind}
        when 'replay' then ${t.segmentId} is not null and ${t.localN} is not null and ${t.n} is not null
        when 'awarded' then ${t.segmentId} is null and ${t.winnerSide} is not null and ${t.n} is not null
        else ${t.n} is null end`,
    ),
  ],
);
