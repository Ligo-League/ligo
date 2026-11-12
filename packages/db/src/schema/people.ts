import { TITLES } from '@ligo/titles';
import { check, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { jsonText, oneOf } from '../columns.ts';
import { orgSettingsSchema, teamColorsSchema, teamSocialsSchema } from '../json.ts';
import { LEGAL_STATUSES, LOCALES, TEAM_STAFF_ROLES } from './enums.ts';

// Tenancy, people and teams. Discord IDs are TEXT: snowflakes exceed JavaScript's safe integers.

export const org = sqliteTable(
  'org',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    locale: text('locale', { enum: LOCALES }).notNull().default('fr'),
    settingsJson: jsonText(orgSettingsSchema)('settings_json').notNull(),
  },
  (t) => [check('org_locale_check', oneOf(t.locale, LOCALES))],
);

export const player = sqliteTable(
  'player',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orgId: integer('org_id')
      .notNull()
      .references(() => org.id),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    discordUserId: text('discord_user_id').unique(),
    nationality: text('nationality'),
    statsConsentAt: integer('stats_consent_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [unique('player_org_slug_unique').on(t.orgId, t.slug)],
);

export const gameAccount = sqliteTable(
  'game_account',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    playerId: integer('player_id')
      .notNull()
      .references(() => player.id),
    title: text('title', { enum: TITLES }).notNull(),
    // r6: Ubisoft profileID (UUID); valorant: Riot ID; rocket_league: platform:id.
    externalId: text('external_id').notNull(),
    displayName: text('display_name').notNull(),
    rankAtRegistration: text('rank_at_registration'),
    verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    unique('game_account_title_external_unique').on(t.title, t.externalId),
    check('game_account_title_check', oneOf(t.title, TITLES)),
  ],
);

export const team = sqliteTable(
  'team',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orgId: integer('org_id')
      .notNull()
      .references(() => org.id),
    title: text('title', { enum: TITLES }).notNull(),
    name: text('name').notNull(),
    tag: text('tag').notNull(),
    slug: text('slug').notNull(),
    city: text('city'),
    legalStatus: text('legal_status', { enum: LEGAL_STATUSES }),
    colorsJson: jsonText(teamColorsSchema)('colors_json').notNull(),
    logoKey: text('logo_key'),
    socialsJson: jsonText(teamSocialsSchema)('socials_json').notNull(),
    discordUrl: text('discord_url'),
    canStream: integer('can_stream', { mode: 'boolean' }).notNull().default(false),
    discordRoleId: text('discord_role_id'),
  },
  (t) => [
    unique('team_org_title_tag_unique').on(t.orgId, t.title, t.tag),
    unique('team_org_slug_unique').on(t.orgId, t.slug),
    check('team_title_check', oneOf(t.title, TITLES)),
    check('team_legal_status_check', oneOf(t.legalStatus, LEGAL_STATUSES)),
  ],
);

// "1 manager, max 3 staff" is checked by the service that edits team staff, not here.
export const teamStaff = sqliteTable(
  'team_staff',
  {
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id),
    playerId: integer('player_id')
      .notNull()
      .references(() => player.id),
    role: text('role', { enum: TEAM_STAFF_ROLES }).notNull(),
    since: integer('since').notNull(),
    until: integer('until'),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.playerId, t.since] }),
    check('team_staff_role_check', oneOf(t.role, TEAM_STAFF_ROLES)),
  ],
);
