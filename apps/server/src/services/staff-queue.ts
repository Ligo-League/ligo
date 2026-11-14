import {
  latestScoreEvidence,
  listLeagueMatches,
  schema,
  type Db,
  type League,
  type LeagueMatch,
} from '@ligo/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { reportingSide, type DisputeDetails } from './reports.ts';
import { pendingRequests, type RequestView } from './requests.ts';

// What waits for league staff (design doc section 7, `/staff`): results to validate, disputes and
// team requests. Read only: decisions go through the same services as the bot's buttons.

const { dispute, player } = schema;

export interface QueuedDispute extends DisputeDetails {
  id: number;
  /** Who disputed, by name. */
  raisedBy: string;
  at: number;
}

export interface QueuedReport {
  match: LeagueMatch;
  /**
   * The screenshot the result rests on: `kept` when the server has its own copy, shown on the
   * page; `url` is the bot's post in the staff queue. The buttons name its ID, so a decision
   * applies to this report and not a newer one.
   */
  evidence: { id: number; url: string | null; at: number; kept: boolean } | null;
  /** Who reported, and for which team. */
  reportedBy: string | null;
  reportingTeam: string | null;
  /** The disputes still open about it, oldest first. */
  disputes: QueuedDispute[];
}

export interface StaffQueue {
  /** Reported or confirmed by the opponent: a staff validation is all that is missing. */
  reports: QueuedReport[];
  disputed: QueuedReport[];
  requests: RequestView[];
}

const nameOf = (db: Pick<Db, 'select'>, playerId: number | null) =>
  playerId === null
    ? null
    : (db.select({ name: player.displayName }).from(player).where(eq(player.id, playerId)).get()
        ?.name ?? null);

function queuedReport(
  db: Pick<Db, 'select'>,
  league: Pick<League, 'competition'>,
  found: LeagueMatch,
): QueuedReport {
  const reasons = league.competition.rulesetJson.dispute_reasons;
  const shot = latestScoreEvidence(db, found.id);
  const side = reportingSide(db, found);
  const open = db
    .select({ row: dispute, raisedBy: player.displayName })
    .from(dispute)
    .innerJoin(player, eq(dispute.raisedBy, player.id))
    .where(and(eq(dispute.matchId, found.id), isNull(dispute.resolution)))
    .orderBy(asc(dispute.id))
    .all();
  return {
    match: found,
    evidence: shot
      ? { id: shot.id, url: shot.url, at: shot.at, kept: shot.objectKey !== null }
      : null,
    reportedBy: nameOf(db, found.reportedBy),
    reportingTeam: side === null ? null : found[side].name,
    disputes: open.map(({ row, raisedBy }) => ({
      id: row.id,
      reason: row.reason,
      label: reasons.find((reason) => reason.key === row.reason)?.label ?? null,
      details: row.details,
      raisedBy,
      at: row.at,
    })),
  };
}

/** Everything of the league's current season waiting for its staff, oldest first. */
export function staffQueue(db: Pick<Db, 'select'>, league: League): StaffQueue {
  const matches = league.season ? listLeagueMatches(db, { seasonId: league.season.id }) : [];
  const waiting = (statuses: readonly string[]) =>
    matches
      .filter((found) => statuses.includes(found.status))
      .map((found) => queuedReport(db, league, found))
      .sort((x, y) => (x.evidence?.at ?? 0) - (y.evidence?.at ?? 0));
  return {
    reports: waiting(['reported', 'confirmed']),
    disputed: waiting(['disputed']),
    requests: pendingRequests(db, league),
  };
}
