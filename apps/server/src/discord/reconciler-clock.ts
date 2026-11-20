import { rulesetSchema } from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { syncLeague } from '../services/reconciler.ts';
import type { DiscordGateway } from './gateway.ts';

// The reconciler's own runs (design doc section 6, "Reconciler"): once the bot is connected,
// then every few minutes, for every league that lets Ligo manage its server. Changes made by
// hand in Discord are put right within that time; a sync after a change in Ligo comes from the
// change itself.

/** Often enough to repair a hand-made change soon, rarely enough to stay far from Discord's limits. */
export const SYNC_INTERVAL_MS = 10 * 60_000;

export interface ReconcilerDeps {
  db: Db;
  gateway: DiscordGateway;
  logger: {
    info(details: object, message: string): void;
    warn(details: object, message: string): void;
    error(details: object, message: string): void;
  };
  now(): number;
}

/** One run over every managed league, one after the other. Never throws. */
export async function syncManagedLeagues(deps: ReconcilerDeps): Promise<void> {
  let competitions;
  try {
    competitions = deps.db.select().from(schema.competition).all();
  } catch (error) {
    deps.logger.error({ err: error }, 'League server sync could not read the leagues');
    return;
  }
  for (const row of competitions) {
    try {
      if (!rulesetSchema.parse(row.rulesetJson).discord.manage) continue;
      const reply = await syncLeague(deps.db, deps.gateway, row.id, {
        dryRun: false,
        now: deps.now(),
        actorPlayerId: null,
      });
      if (!reply.ok) {
        deps.logger.warn(
          { competitionId: row.id, error: reply.error },
          'League server sync did not run',
        );
      } else if (reply.failures.length > 0) {
        deps.logger.warn(
          {
            competitionId: row.id,
            applied: reply.applied,
            failed: reply.failures.length,
            first: reply.failures[0]?.message,
          },
          'Discord refused part of a league server sync',
        );
      } else if (reply.applied > 0) {
        deps.logger.info({ competitionId: row.id, applied: reply.applied }, 'League server synced');
      }
    } catch (error) {
      deps.logger.error({ err: error, competitionId: row.id }, 'League server sync failed');
    }
  }
}

/** Runs now, then every `intervalMs`, a run never starting while the last one goes on. */
export function startReconciler(deps: ReconcilerDeps, intervalMs = SYNC_INTERVAL_MS): () => void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void syncManagedLeagues(deps).finally(() => {
      running = false;
    });
  };
  run();
  const timer = setInterval(run, intervalMs);
  return () => {
    clearInterval(timer);
  };
}
