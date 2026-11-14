import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { jsonText, oneOf } from '../columns.ts';
import { requestPayloadSchema } from '../json.ts';
import {
  APPROVAL_MODES,
  QUEUE_POST_ENTITIES,
  REGISTRATION_ROLES,
  REQUEST_KINDS,
  REQUEST_STATUSES,
} from './enums.ts';
import { player, team } from './people.ts';
import { competition, season } from './structure.ts';

// A team asks, the league answers (design doc section 5, "Team requests"; maintainer,
// 13 November 2026). Every request is kept, whatever became of it: the team's history and the
// staff's queue are both read from here.
export const request = sqliteTable(
  'request',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    competitionId: integer('competition_id')
      .notNull()
      .references(() => competition.id),
    seasonId: integer('season_id').references(() => season.id),
    teamId: integer('team_id').references(() => team.id),
    kind: text('kind', { enum: REQUEST_KINDS }).notNull(),
    payloadJson: jsonText(requestPayloadSchema)('payload_json').notNull(),
    // Fixed when filed, from the league's settings then: a later change of setting does not
    // change who answers a request already waiting.
    approval: text('approval', { enum: APPROVAL_MODES }).notNull(),
    status: text('status', { enum: REQUEST_STATUSES }).notNull().default('pending'),
    // The team's own words for staff, optional.
    note: text('note'),
    requestedBy: integer('requested_by')
      .notNull()
      .references(() => player.id),
    requestedAt: integer('requested_at').notNull(),
    // Null for a request applied at once, which nobody decides.
    decidedBy: integer('decided_by').references(() => player.id),
    decidedAt: integer('decided_at'),
    // Why staff refused; required then, so the team knows what to fix.
    reason: text('reason'),
    // When staff were reminded of it; at most once.
    remindedAt: integer('reminded_at'),
  },
  (t) => [
    index('request_status_idx').on(t.status),
    index('request_team_idx').on(t.teamId),
    check('request_kind_check', oneOf(t.kind, REQUEST_KINDS)),
    check('request_approval_check', oneOf(t.approval, APPROVAL_MODES)),
    check('request_status_check', oneOf(t.status, REQUEST_STATUSES)),
    // A request leaves `pending` once, with the time it did.
    check('request_decided_check', sql`(${t.status} = 'pending') = (${t.decidedAt} is null)`),
    check('request_reason_check', sql`${t.status} <> 'rejected' or ${t.reason} is not null`),
  ],
);

// The bot's posts in a staff queue channel, by the thing they are about, so that whoever handles
// it, in Discord or on the website, can mark the post as handled (maintainer, 13 November 2026).
export const queuePost = sqliteTable(
  'queue_post',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    entity: text('entity', { enum: QUEUE_POST_ENTITIES }).notNull(),
    entityId: integer('entity_id').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    postedAt: integer('posted_at').notNull(),
  },
  (t) => [
    index('queue_post_entity_idx').on(t.entity, t.entityId),
    check('queue_post_entity_check', oneOf(t.entity, QUEUE_POST_ENTITIES)),
  ],
);

// The players of a registration, each joined from the invitation with their own account
// (maintainer, 14 November 2026). The filer sets each one's place and the captain.
export const registrationPlayer = sqliteTable(
  'registration_player',
  {
    requestId: integer('request_id')
      .notNull()
      .references(() => request.id),
    playerId: integer('player_id')
      .notNull()
      .references(() => player.id),
    role: text('role', { enum: REGISTRATION_ROLES }).notNull(),
    captain: integer('captain', { mode: 'boolean' }).notNull().default(false),
    joinedAt: integer('joined_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.requestId, t.playerId] }),
    check('registration_player_role_check', oneOf(t.role, REGISTRATION_ROLES)),
  ],
);

// A registration's invitation link. The link's secret is computed from `nonce` with the server's
// secret, never stored: the filer can see the link again, and the database alone does not hold
// it. A new link revokes the one before.
export const registrationInvite = sqliteTable(
  'registration_invite',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    requestId: integer('request_id')
      .notNull()
      .references(() => request.id),
    nonce: text('nonce').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
  },
  (t) => [index('registration_invite_request_idx').on(t.requestId)],
);
