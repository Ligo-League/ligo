import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { jsonText, oneOf } from '../columns.ts';
import { requestPayloadSchema } from '../json.ts';
import { APPROVAL_MODES, QUEUE_POST_ENTITIES, REQUEST_KINDS, REQUEST_STATUSES } from './enums.ts';
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
