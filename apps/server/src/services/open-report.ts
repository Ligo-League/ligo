import type { DisputeReason } from '@ligo/core';
import { latestScoreEvidence, schema, type GuildLeague, type Tx } from '@ligo/db';
import { and, eq, isNull } from 'drizzle-orm';
import { queuePostsOf, type PostRef } from './queue-posts.ts';

// A match's open report and disputes, as Discord shows them: the posts to close once staff act on
// the match, whatever they do (validate, refuse, annul, enter another result, record a forfeit).

const { dispute: disputeTable, player } = schema;

/** The dispute as stored, with its label so the staff queue can show it. */
export interface DisputeDetails {
  reason: string;
  /** Null for "other", which has no label in the settings. */
  label: DisputeReason['label'] | null;
  details: string | null;
}

/** A dispute staff settled, with its posts in the staff queue. */
export interface SettledDispute extends DisputeDetails {
  id: number;
  /** The Discord user who raised it, as its post names them. */
  raisedBy: string | null;
  posts: PostRef[];
}

/** The posts of a match's current report and open disputes, read before staff settle them. */
export interface OpenReportPosts {
  /**
   * The staff queue posts about the current report, to mark as handled wherever staff decided:
   * in Discord or on the website. Posts about older reports were marked already.
   */
  posts: PostRef[];
  /** The report's public post, whose buttons for the other team no longer apply. */
  post: PostRef | null;
  disputes: SettledDispute[];
}

/** Where a report's public post is, when it is known. */
export function publicPostOf(
  report: { postChannelId: string | null; postMessageId: string | null } | undefined,
): PostRef | null {
  return report?.postChannelId && report.postMessageId
    ? { channelId: report.postChannelId, messageId: report.postMessageId }
    : null;
}

/** The queue posts of the match's current report, and of the disputes still open about it. */
export function openReportPosts(tx: Tx, league: GuildLeague, matchId: number): OpenReportPosts {
  const report = latestScoreEvidence(tx, matchId);
  const since = report?.at ?? 0;
  const reasons = league.competition.rulesetJson.dispute_reasons;
  const open = tx
    .select({ dispute: disputeTable, raisedBy: player.discordUserId })
    .from(disputeTable)
    .innerJoin(player, eq(disputeTable.raisedBy, player.id))
    .where(and(eq(disputeTable.matchId, matchId), isNull(disputeTable.resolution)))
    .all();
  return {
    posts: queuePostsOf(tx, { entity: 'match', entityId: matchId }, since),
    post: publicPostOf(report),
    disputes: open.map(({ dispute: row, raisedBy }) => ({
      id: row.id,
      reason: row.reason,
      label: reasons.find((reason) => reason.key === row.reason)?.label ?? null,
      details: row.details,
      raisedBy,
      posts: queuePostsOf(tx, { entity: 'dispute', entityId: row.id }),
    })),
  };
}
