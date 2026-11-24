import { describe, expect, it } from 'vitest';
import { job } from '../schema/index.ts';
import { openTestDatabase } from '../testing.ts';
import {
  claimJob,
  completeJob,
  enqueueJob,
  failJob,
  JOB_LOCK_MS,
  listFailedJobsToAlert,
  markJobAlerted,
  retryDelayMs,
} from './jobs.ts';

// The worker's queue (design doc section 8, "Server jobs"): a job is claimed with a lock, so a
// worker that dies leaves it to be claimed again; a failure waits longer each time, and after
// three attempts the job fails and staff are told once.

const MINUTE = 60_000;

describe('the job queue', () => {
  it('hands out the oldest job due, once, and counts the attempt', () => {
    const db = openTestDatabase();
    const first = enqueueJob(db, { kind: 'verify_replay', payload: { fileId: 1 } }, 1_000);
    enqueueJob(db, { kind: 'verify_replay', payload: { fileId: 2 } }, 2_000);
    const claimed = claimJob(db, 5_000);
    expect(claimed).toMatchObject({
      id: first,
      kind: 'verify_replay',
      payloadJson: { fileId: 1 },
      status: 'running',
      attempts: 1,
      lockedUntil: 5_000 + JOB_LOCK_MS,
    });
    expect(claimJob(db, 5_000)?.payloadJson).toEqual({ fileId: 2 });
    expect(claimJob(db, 5_000)).toBeNull();
  });

  it('does not hand out a job before its time', () => {
    const db = openTestDatabase();
    enqueueJob(db, { kind: 'stitch_game', payload: { matchId: 1 }, runAfter: 10_000 }, 1_000);
    expect(claimJob(db, 9_999)).toBeNull();
    expect(claimJob(db, 10_000)).not.toBeNull();
  });

  it('queues one job for the same work while it waits', () => {
    const db = openTestDatabase();
    const a = enqueueJob(db, { kind: 'stitch_game', payload: { matchId: 4 } }, 1_000);
    const b = enqueueJob(db, { kind: 'stitch_game', payload: { matchId: 4 } }, 2_000);
    expect(b).toBe(a);
    // Once it runs, new work needs a new run.
    claimJob(db, 3_000);
    expect(enqueueJob(db, { kind: 'stitch_game', payload: { matchId: 4 } }, 4_000)).not.toBe(a);
  });

  it('claims again a job whose worker stopped before its lock ran out', () => {
    const db = openTestDatabase();
    enqueueJob(db, { kind: 'verify_replay', payload: { fileId: 1 } }, 0);
    claimJob(db, 0);
    expect(claimJob(db, JOB_LOCK_MS - 1)).toBeNull();
    expect(claimJob(db, JOB_LOCK_MS)).toMatchObject({ attempts: 2 });
  });

  it('marks a job done', () => {
    const db = openTestDatabase();
    const id = enqueueJob(db, { kind: 'verify_replay', payload: { fileId: 1 } }, 0);
    claimJob(db, 0);
    completeJob(db, id, 7_000);
    expect(db.select().from(job).get()).toMatchObject({
      status: 'done',
      finishedAt: 7_000,
      lockedUntil: null,
    });
    expect(claimJob(db, 10 * JOB_LOCK_MS)).toBeNull();
  });

  it('retries a failure later each time, then fails it after three attempts', () => {
    const db = openTestDatabase();
    const id = enqueueJob(db, { kind: 'verify_replay', payload: { fileId: 1 } }, 0);
    expect([1, 2, 3].map(retryDelayMs)).toEqual([MINUTE, 5 * MINUTE, 25 * MINUTE]);

    claimJob(db, 0);
    expect(failJob(db, id, 'R2 is down', 0)).toBe('retry');
    expect(db.select().from(job).get()).toMatchObject({
      status: 'queued',
      runAfter: MINUTE,
      lastError: 'R2 is down',
    });
    claimJob(db, MINUTE);
    expect(failJob(db, id, 'R2 is down', MINUTE)).toBe('retry');
    claimJob(db, 6 * MINUTE);
    expect(failJob(db, id, 'still down', 6 * MINUTE)).toBe('failed');
    expect(db.select().from(job).get()).toMatchObject({
      status: 'failed',
      attempts: 3,
      finishedAt: 6 * MINUTE,
      lastError: 'still down',
    });
  });

  it('keeps only the start of a long error', () => {
    const db = openTestDatabase();
    const id = enqueueJob(db, { kind: 'verify_replay', payload: { fileId: 1 } }, 0);
    claimJob(db, 0);
    failJob(db, id, 'x'.repeat(5_000), 0);
    expect(db.select().from(job).get()?.lastError).toHaveLength(1_000);
  });

  it('lists each failed job for staff once', () => {
    const db = openTestDatabase();
    const id = enqueueJob(db, { kind: 'stitch_game', payload: { matchId: 9 } }, 0);
    for (const now of [0, MINUTE, 6 * MINUTE]) {
      claimJob(db, now);
      failJob(db, id, 'broken', now);
    }
    expect(listFailedJobsToAlert(db)).toEqual([
      expect.objectContaining({ id, kind: 'stitch_game', payloadJson: { matchId: 9 } }),
    ]);
    markJobAlerted(db, id, 7 * MINUTE);
    expect(listFailedJobsToAlert(db)).toEqual([]);
  });
});
