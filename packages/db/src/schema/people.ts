import { TITLES } from '@ligo/titles';
import { check, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { jsonText, oneOf } from '../columns.ts';
import { orgSettingsSchema, teamColorsSchema, teamSocialsSchema } from '../json.ts';
import { CLUB_STAFF_ROLES, LEGAL_STATUSES, LOCALES, TEAM_STAFF_ROLES } from './enums.ts';

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
    // YYYY-MM-DD, given by the player for leagues with a minimum age (O-33). Private: only the
    // player sees it; staff see only whether they are old enough.
    birthDate: text('birth_date'),
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
    // r6: Ubisoft profileID (UUID); valorant: Riot ID; rocket_league: platform:id. Null while
    // the player has given only their name: a replay pins it later (M-23).
    externalId: text('external_id'),
    // The in-game name, as the player declares it on their profile.
    displayName: text('display_name').notNull(),
    rankAtRegistration: text('rank_at_registration'),
    // The player's rank as they declare it, kept up to date by them (maintainer, 14 November
    // 2026: Ligo looks no rank up elsewhere), and when they last changed it.
    rank: text('rank'),
    rankUpdatedAt: integer('rank_updated_at'),
    verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    unique('game_account_title_external_unique').on(t.title, t.externalId),
    // One account per player and title: the one the player plays league matches with.
    unique('game_account_player_title_unique').on(t.playerId, t.title),
    check('game_account_title_check', oneOf(t.title, TITLES)),
  ],
);

// A club is a team's organisation (Not Scam, W Mates, Greed): what stays when its rosters change
// (design doc section 4, "Clubs and rosters"; maintainer, 14 November 2026). It holds the
// default logo and colours of its rosters.
export const club = sqliteTable(
  'club',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orgId: integer('org_id')
      .notNull()
      .references(() => org.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    city: text('city'),
    legalStatus: text('legal_status', { enum: LEGAL_STATUSES }),
    colorsJson: jsonText(teamColorsSchema)('colors_json').notNull(),
    logoKey: text('logo_key'),
    socialsJson: jsonText(teamSocialsSchema)('socials_json').notNull(),
    discordUrl: text('discord_url'),
  },
  (t) => [
    unique('club_org_slug_unique').on(t.orgId, t.slug),
    check('club_legal_status_check', oneOf(t.legalStatus, LEGAL_STATUSES)),
  ],
);

// A team is a roster of a club: what holds a slot, plays matches and has a standings line, under
// its own name and tag. Its colours and logo, when null, are its club's.
export const team = sqliteTable(
  'team',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orgId: integer('org_id')
      .notNull()
      .references(() => org.id),
    clubId: integer('club_id')
      .notNull()
      .references(() => club.id),
    title: text('title', { enum: TITLES }).notNull(),
    name: text('name').notNull(),
    tag: text('tag').notNull(),
    slug: text('slug').notNull(),
    colorsJson: jsonText(teamColorsSchema)('colors_json'),
    logoKey: text('logo_key'),
    canStream: integer('can_stream', { mode: 'boolean' }).notNull().default(false),
    discordRoleId: text('discord_role_id'),
  },
  (t) => [
    unique('team_org_title_tag_unique').on(t.orgId, t.title, t.tag),
    unique('team_org_slug_unique').on(t.orgId, t.slug),
    check('team_title_check', oneOf(t.title, TITLES)),
  ],
);

// Who acts for a club, and so for every one of its rosters: its owner, answerable to the league,
// and its managers (maintainer, 14 November 2026). "1 owner" and the number of managers the
// group allows are checked by the service that edits officials, not here.
export const clubStaff = sqliteTable(
  'club_staff',
  {
    clubId: integer('club_id')
      .notNull()
      .references(() => club.id),
    playerId: integer('player_id')
      .notNull()
      .references(() => player.id),
    role: text('role', { enum: CLUB_STAFF_ROLES }).notNull(),
    since: integer('since').notNull(),
    until: integer('until'),
  },
  (t) => [
    primaryKey({ columns: [t.clubId, t.playerId, t.since] }),
    check('club_staff_role_check', oneOf(t.role, CLUB_STAFF_ROLES)),
  ],
);

// A roster's own officials: managers and coaches, within the league's limits, checked by the
// service that edits them.
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
