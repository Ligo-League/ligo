import { claimJob, completeJob, failJob, type Db, type JobKind } from '@ligo/db';

// The worker's loop (design doc section 8, "Server jobs"): one job at a time. A job's handler
// does the work; throwing puts the job back for later (1, 5, then 25 minutes), and after three
// attempts it fails, and the server tells staff (only the server talks to Discord).

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;
export type JobHandlers = Partial<Record<JobKind, JobHandler>>;

export interface RunnerDeps {
  db: Db;
  handlers: JobHandlers;
  logger: {
    info: (details: object, message: string) => void;
    error: (details: object, message: string) => void;
  };
  now: () => number;
}

/** Runs the next job due, if any; true when there was one. Never throws. */
export async function runNextJob(deps: RunnerDeps): Promise<boolean> {
  const claimed = claimJob(deps.db, deps.now());
  if (!claimed) return false;
  const { id, kind } = claimed;
  const handler = deps.handlers[kind];
  try {
    if (!handler) throw new Error(`No handler for ${kind}`);
    await handler(claimed.payloadJson);
    completeJob(deps.db, id, deps.now());
    deps.logger.info({ jobId: id, kind }, 'Job done');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outcome = failJob(deps.db, id, message, deps.now());
    deps.logger.error({ jobId: id, kind, err: message, outcome }, 'A job failed');
  }
  return true;
}

/** Runs jobs until stopped, waiting `idleMs` whenever the queue is empty. */
export function startWorker(deps: RunnerDeps, idleMs = 2_000): () => Promise<void> {
  const state = { running: true };
  let wake: (() => void) | null = null;
  const loop = (async () => {
    while (state.running) {
      try {
        if (await runNextJob(deps)) continue;
      } catch (error) {
        // The database itself failed (locked too long, or not migrated yet): wait and try again.
        deps.logger.error({ err: error }, 'Could not claim a job');
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, idleMs);
      });
    }
  })();
  return async () => {
    state.running = false;
    wake?.();
    await loop;
  };
}
