import { schema, type Tx } from '@ligo/db';
import { and, eq, isNull } from 'drizzle-orm';

const { dispute } = schema;

export type DisputeResolution = (typeof schema.DISPUTE_RESOLUTIONS)[number];

/**
 * Closes the open disputes of a match once staff act on it, in the same transaction as the
 * action, so a dispute always says how it ended and who decided.
 */
export function settleDisputes(
  tx: Tx,
  matchId: number,
  resolution: DisputeResolution,
  staffPlayerId: number,
  now: number,
): void {
  tx.update(dispute)
    .set({ resolution, resolvedBy: staffPlayerId, resolvedAt: now })
    .where(and(eq(dispute.matchId, matchId), isNull(dispute.resolution)))
    .run();
}
