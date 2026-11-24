import { listFailedJobsToAlert, schema, type Db, type JobKind } from '@ligo/db';
import { eq } from 'drizzle-orm';

// Jobs the worker could not finish after three attempts (design doc section 8, "Server jobs"),
// with where to tell staff: the staff queue of the league the job's match belongs to. The
// worker never talks to Discord; the server's clock posts these.

const { leagueGuild, match, replayFile, season, stage } = schema;

export interface JobAlert {
  jobId: number;
  kind: JobKind;
  matchId: number | null;
  /** The league's staff queue, or null when it has none (or the match is gone). */
  queueChannelId: string | null;
  error: string | null;
}

/** The match a job works on: its own `matchId`, or the match of its replay file. */
function matchOf(db: Pick<Db, 'select'>, payload: Record<string, unknown>): number | null {
  if (typeof payload.matchId === 'number') return payload.matchId;
  if (typeof payload.fileId !== 'number') return null;
  const file = db
    .select({ matchId: replayFile.matchId })
    .from(replayFile)
    .where(eq(replayFile.id, payload.fileId))
    .get();
  return file?.matchId ?? null;
}

function queueOf(db: Pick<Db, 'select'>, matchId: number): string | null {
  const found = db
    .select({ channelId: leagueGuild.alertsChannelId })
    .from(match)
    .innerJoin(stage, eq(match.stageId, stage.id))
    .innerJoin(season, eq(stage.seasonId, season.id))
    .innerJoin(leagueGuild, eq(leagueGuild.competitionId, season.competitionId))
    .where(eq(match.id, matchId))
    .get();
  return found?.channelId ?? null;
}

export function pendingJobAlerts(db: Pick<Db, 'select'>): JobAlert[] {
  return listFailedJobsToAlert(db).map((row) => {
    const matchId = matchOf(db, row.payloadJson);
    return {
      jobId: row.id,
      kind: row.kind,
      matchId,
      queueChannelId: matchId === null ? null : queueOf(db, matchId),
      error: row.lastError,
    };
  });
}
