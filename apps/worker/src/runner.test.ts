import { claimJob, enqueueJob, schema } from '@ligo/db';
import { openTestDatabase } from '@ligo/db/testing';
import { describe, expect, it, vi } from 'vitest';
import { runNextJob, type JobHandlers } from './runner.ts';

// The worker's loop (design doc section 8, "Server jobs"): one job at a time, by its kind's
// handler; a handler that throws leaves the job to be tried again later.

function setup(handlers: JobHandlers) {
  const db = openTestDatabase();
  const logger = { info: vi.fn(), error: vi.fn() };
  const run = () => runNextJob({ db, handlers, logger, now: () => 1_000 });
  return { db, logger, run };
}

describe('runNextJob', () => {
  it('runs the oldest job with its kind’s handler and marks it done', async () => {
    const seen: unknown[] = [];
    const { db, run } = setup({
      verify_replay: (payload) => {
        seen.push(payload);
        return Promise.resolve();
      },
    });
    enqueueJob(db, { kind: 'verify_replay', payload: { fileId: 3 } }, 0);
    expect(await run()).toBe(true);
    expect(seen).toEqual([{ fileId: 3 }]);
    expect(db.select().from(schema.job).get()?.status).toBe('done');
    expect(await run()).toBe(false);
  });

  it('puts a failed job back for later, logging the error but not the payload’s files', async () => {
    const { db, logger, run } = setup({
      verify_replay: () => Promise.reject(new Error('R2 answered 503')),
    });
    enqueueJob(db, { kind: 'verify_replay', payload: { fileId: 3 } }, 0);
    expect(await run()).toBe(true);
    expect(db.select().from(schema.job).get()).toMatchObject({
      status: 'queued',
      lastError: 'R2 answered 503',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 1, kind: 'verify_replay' }),
      'A job failed',
    );
  });

  it('fails a job no handler takes', async () => {
    const { db, run } = setup({});
    enqueueJob(db, { kind: 'render_images', payload: { matchId: 1 } }, 0);
    await run();
    expect(db.select().from(schema.job).get()).toMatchObject({
      lastError: 'No handler for render_images',
    });
    expect(claimJob(db, 1_000)).toBeNull();
  });
});
