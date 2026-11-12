import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { jsonText, oneOf } from '../columns.ts';
import { auditSnapshotSchema } from '../json.ts';
import { AUDIT_ACTOR_KINDS } from './enums.ts';
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
