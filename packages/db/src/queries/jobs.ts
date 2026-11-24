import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { job } from '../schema/index.ts';
import type { JOB_KINDS } from '../schema/enums.ts';

// The worker's queue (design doc section 8, "Server jobs"). The server and the worker share the
// SQLite file; a claim is one UPDATE, so two workers can never take the same job.

export type JobKind = (typeof JOB_KINDS)[number];
export type JobRow = typeof job.$inferSelect;

/** How long a claimed job is the worker's before another may take it again. */
export const JOB_LOCK_MS = 5 * 60_000;
/** Attempts before a job fails for good and staff are told. */
export const JOB_MAX_ATTEMPTS = 3;
const ERROR_MAX = 1_000;

/** The wait before attempt `attempts + 1`: 1, then 5, then 25 minutes. */
export const retryDelayMs = (attempts: number) => 60_000 * 5 ** (attempts - 1);

/**
 * Queues a job and returns its ID. The same work already waiting (same kind and payload, not yet
 * claimed) is not queued twice: its ID is returned instead.
 */
export function enqueueJob(
  db: Pick<Db, 'select' | 'insert'>,
  input: { kind: JobKind; payload: Record<string, unknown>; runAfter?: number },
  now: number,
): number {
  const payload = JSON.stringify(input.payload);
  const waiting = db
    .select({ id: job.id })
    .from(job)
    .where(
      and(eq(job.kind, input.kind), eq(job.status, 'queued'), sql`${job.payloadJson} = ${payload}`),
    )
    .get();
  if (waiting) return waiting.id;
  return db
    .insert(job)
    .values({
      kind: input.kind,
      payloadJson: input.payload,
      runAfter: input.runAfter ?? now,
      createdAt: now,
    })
    .returning({ id: job.id })
    .get().id;
}

/**
 * Takes the oldest job due, or one whose worker stopped before its lock ran out, and locks it.
 * Null when there is none.
 */
export function claimJob(db: Pick<Db, 'update' | 'select'>, now: number): JobRow | null {
  const due = db
    .select({ id: job.id })
    .from(job)
    .where(
      or(
        and(eq(job.status, 'queued'), lte(job.runAfter, now)),
        and(eq(job.status, 'running'), lte(job.lockedUntil, now)),
      ),
    )
    .orderBy(asc(job.runAfter), asc(job.id))
    .limit(1);
  const claimed = db
    .update(job)
    .set({
      status: 'running',
      attempts: sql`${job.attempts} + 1`,
      lockedUntil: now + JOB_LOCK_MS,
    })
    // The condition again, so a job another worker took in between is left alone.
    .where(
      and(
        sql`${job.id} = (${due})`,
        or(
          and(eq(job.status, 'queued'), lte(job.runAfter, now)),
          and(eq(job.status, 'running'), lte(job.lockedUntil, now)),
        ),
      ),
    )
    .returning()
    .get() as JobRow | undefined;
  return claimed ?? null;
}

export function completeJob(db: Pick<Db, 'update'>, id: number, now: number): void {
  db.update(job)
    .set({ status: 'done', finishedAt: now, lockedUntil: null })
    .where(eq(job.id, id))
    .run();
}

/**
 * Records a failure: the job waits and runs again, or after its last attempt fails for good.
 * The error is kept short; callers pass a message, never a secret or a signed URL.
 */
export function failJob(
  db: Pick<Db, 'select' | 'update'>,
  id: number,
  error: string,
  now: number,
): 'retry' | 'failed' {
  const row = db.select({ attempts: job.attempts }).from(job).where(eq(job.id, id)).get();
  const attempts = row?.attempts ?? JOB_MAX_ATTEMPTS;
  const lastError = error.slice(0, ERROR_MAX);
  if (attempts >= JOB_MAX_ATTEMPTS) {
    db.update(job)
      .set({ status: 'failed', finishedAt: now, lockedUntil: null, lastError })
      .where(eq(job.id, id))
      .run();
    return 'failed';
  }
  db.update(job)
    .set({ status: 'queued', runAfter: now + retryDelayMs(attempts), lockedUntil: null, lastError })
    .where(eq(job.id, id))
    .run();
  return 'retry';
}

/** Jobs that failed for good and staff were not told about yet. */
export function listFailedJobsToAlert(db: Pick<Db, 'select'>): JobRow[] {
  return db
    .select()
    .from(job)
    .where(and(eq(job.status, 'failed'), isNull(job.alertedAt)))
    .orderBy(asc(job.id))
    .all();
}

export function markJobAlerted(db: Pick<Db, 'update'>, id: number, now: number): void {
  db.update(job).set({ alertedAt: now }).where(eq(job.id, id)).run();
}
