import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { jsonText, oneOf } from '../columns.ts';
import { auditSnapshotSchema, jobPayloadSchema } from '../json.ts';
import { AUDIT_ACTOR_KINDS, JOB_KINDS, JOB_STATUSES } from './enums.ts';
import { player } from './people.ts';

// Every staff mutation writes a row here in the same transaction as the change.
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorPlayerId: integer('actor_player_id').references(() => player.id),
    actorKind: text('actor_kind', { enum: AUDIT_ACTOR_KINDS }).notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    // TEXT so that rows keyed by a Discord ID (league_guild) can be audited too.
    entityId: text('entity_id').notNull(),
    beforeJson: jsonText(auditSnapshotSchema)('before_json'),
    afterJson: jsonText(auditSnapshotSchema)('after_json'),
    at: integer('at').notNull(),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entity, t.entityId),
    index('audit_log_at_idx').on(t.at),
    check('audit_log_actor_kind_check', oneOf(t.actorKind, AUDIT_ACTOR_KINDS)),
  ],
);

// The worker's queue (design doc section 8, "Server jobs"; phase 5). A job is claimed by setting
// it running with a lock; a failure goes back to the queue with a later `run_after` until its
// attempts run out, then fails and alerts staff.
export const job = sqliteTable(
  'job',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind', { enum: JOB_KINDS }).notNull(),
    payloadJson: jsonText(jobPayloadSchema)('payload_json').notNull(),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    runAfter: integer('run_after').notNull(),
    lockedUntil: integer('locked_until'),
    lastError: text('last_error'),
    createdAt: integer('created_at').notNull(),
    finishedAt: integer('finished_at'),
    // When the server told staff the job failed (only the server posts in Discord).
    alertedAt: integer('alerted_at'),
  },
  (t) => [
    index('job_queue_idx').on(t.status, t.runAfter),
    check('job_kind_check', oneOf(t.kind, JOB_KINDS)),
    check('job_status_check', oneOf(t.status, JOB_STATUSES)),
  ],
);
