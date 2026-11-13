import {
  pointsSchema,
  rulesetSchema,
  schedulingSchema,
  seasonSettingsSchema,
  stageConfigSchema,
  tiebreakSchema,
} from '@ligo/core';
import { TITLES } from '@ligo/titles';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { isIsoDate, jsonText, oneOf } from '../columns.ts';
import { themeSchema } from '../json.ts';
import {
  DIVISION_KINDS,
  PARTICIPANT_MODES,
  ROSTER_ROLES,
  SEASON_STATUSES,
  SLOT_STATUSES,
  STAGE_KINDS,
  STAGE_STATUSES,
} from './enums.ts';
import { org, player, team } from './people.ts';

// Competition structure: org → competition → season → division → stage.

export const competition = sqliteTable(
  'competition',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orgId: integer('org_id')
      .notNull()
      .references(() => org.id),
    title: text('title', { enum: TITLES }).notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    participantMode: text('participant_mode', { enum: PARTICIPANT_MODES }).notNull(),
    rulesetJson: jsonText(rulesetSchema)('ruleset_json').notNull(),
    pointsJson: jsonText(pointsSchema)('points_json').notNull(),
    tiebreakJson: jsonText(tiebreakSchema)('tiebreak_json').notNull(),
    schedulingJson: jsonText(schedulingSchema)('scheduling_json').notNull(),
    statSchemaVersion: integer('stat_schema_version').notNull(),
    themeJson: jsonText(themeSchema)('theme_json').notNull(),
  },
  (t) => [
    unique('competition_org_slug_unique').on(t.orgId, t.slug),
    check('competition_title_check', oneOf(t.title, TITLES)),
    check('competition_participant_mode_check', oneOf(t.participantMode, PARTICIPANT_MODES)),
  ],
);

// One Discord server maps to one competition. Channel IDs stay NULL until the channels exist.
export const leagueGuild = sqliteTable('league_guild', {
  guildId: text('guild_id').primaryKey(),
  orgId: integer('org_id')
    .notNull()
    .references(() => org.id),
  competitionId: integer('competition_id')
    .notNull()
    .references(() => competition.id),
  staffRoleId: text('staff_role_id').notNull(),
  alertsChannelId: text('alerts_channel_id'),
  resultsChannelId: text('results_channel_id'),
  mercatoChannelId: text('mercato_channel_id'),
});

export const season = sqliteTable(
  'season',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    competitionId: integer('competition_id')
      .notNull()
      .references(() => competition.id),
    name: text('name').notNull(),
    // Calendar dates (YYYY-MM-DD), not instants: a season starts "on 19 October".
    startsOn: text('starts_on').notNull(),
    endsOn: text('ends_on').notNull(),
    settingsJson: jsonText(seasonSettingsSchema)('settings_json').notNull(),
    status: text('status', { enum: SEASON_STATUSES }).notNull(),
  },
  (t) => [
    unique('season_competition_name_unique').on(t.competitionId, t.name),
    check('season_starts_on_check', isIsoDate(t.startsOn)),
    check('season_ends_on_check', isIsoDate(t.endsOn)),
    check('season_status_check', oneOf(t.status, SEASON_STATUSES)),
  ],
);

export const division = sqliteTable(
  'division',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => season.id),
    name: text('name').notNull(),
    kind: text('kind', { enum: DIVISION_KINDS }).notNull(),
    level: integer('level').notNull(),
    region: text('region'),
    categoryPrefix: text('category_prefix').notNull(),
    // Where this division's results are announced; null falls back to the league's channel.
    resultsChannelId: text('results_channel_id'),
  },
  (t) => [
    unique('division_season_name_unique').on(t.seasonId, t.name),
    check('division_kind_check', oneOf(t.kind, DIVISION_KINDS)),
  ],
);

// The rulebook's SLOT: a team's place in a division.
export const slot = sqliteTable(
  'slot',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    divisionId: integer('division_id')
      .notNull()
      .references(() => division.id),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id),
    status: text('status', { enum: SLOT_STATUSES }).notNull().default('active'),
    forfeits: integer('forfeits').notNull().default(0),
    excludedAt: integer('excluded_at'),
  },
  (t) => [
    unique('slot_division_team_unique').on(t.divisionId, t.teamId),
    check('slot_status_check', oneOf(t.status, SLOT_STATUSES)),
  ],
);

export const rosterEntry = sqliteTable(
  'roster_entry',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => season.id),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id),
    playerId: integer('player_id')
      .notNull()
      .references(() => player.id),
    role: text('role', { enum: ROSTER_ROLES }).notNull(),
    validFrom: integer('valid_from').notNull(),
    validTo: integer('valid_to'),
  },
  (t) => [
    index('roster_entry_season_team_idx').on(t.seasonId, t.teamId),
    index('roster_entry_player_idx').on(t.playerId),
    check('roster_entry_role_check', oneOf(t.role, ROSTER_ROLES)),
  ],
);

export const stage = sqliteTable(
  'stage',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => season.id),
    divisionId: integer('division_id').references(() => division.id),
    ord: integer('ord').notNull(),
    kind: text('kind', { enum: STAGE_KINDS }).notNull(),
    configJson: jsonText(stageConfigSchema)('config_json').notNull(),
    status: text('status', { enum: STAGE_STATUSES }).notNull().default('draft'),
  },
  (t) => [
    index('stage_season_idx').on(t.seasonId),
    check('stage_kind_check', oneOf(t.kind, STAGE_KINDS)),
    check('stage_status_check', oneOf(t.status, STAGE_STATUSES)),
  ],
);

// A participant of a stage: a slot in team leagues, a player in mixed leagues.
// It has its own id (unlike the design doc) because match_slot.source_ref points at it.
export const stageEntry = sqliteTable(
  'stage_entry',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    stageId: integer('stage_id')
      .notNull()
      .references(() => stage.id),
    slotId: integer('slot_id').references(() => slot.id),
    playerId: integer('player_id').references(() => player.id),
    seed: integer('seed').notNull(),
  },
  (t) => [
    unique('stage_entry_stage_slot_unique').on(t.stageId, t.slotId),
    unique('stage_entry_stage_player_unique').on(t.stageId, t.playerId),
    check('stage_entry_participant_check', sql`(${t.slotId} is null) <> (${t.playerId} is null)`),
  ],
);
