import { rulesetSchema } from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import type { TranscriptStore } from '../assets/transcript-store.ts';
import { leagueTarget, syncGuild } from '../services/reconciler.ts';
import { saveTranscripts } from '../services/transcripts.ts';
import type { Locale } from '../i18n/index.ts';
import { postControlMessages } from './control-message.ts';
import type { DiscordGateway } from './gateway.ts';

// The reconciler's own runs (design doc section 6, "Reconciler"): once the bot is connected,
// then every few minutes, for every league that lets Ligo manage its server, so changes made by
// hand in Discord are put right within that time. In between, a quick check reads only the
// database: a league whose wanted state changed (a lineup, an official, a role linked) is synced
// within seconds, whichever page or command made the change. Each run first saves the transcript
// of every match channel whose season closed, so the sync that follows deletes it.

/** Often enough to repair a hand-made change soon, rarely enough to stay far from Discord's limits. */
export const SYNC_INTERVAL_MS = 10 * 60_000;
/** How often the database is read for a league whose wanted state changed. No Discord call. */
export const CHANGE_CHECK_MS = 30_000;

export interface ReconcilerDeps {
  db: Db;
  gateway: DiscordGateway;
  /** The language and site of the match channels' control messages. */
  locale: Locale;
  publicUrl: URL;
  /** Where match channel transcripts are saved before their channel goes. */
  transcripts: TranscriptStore;
  logger: {
    info(details: object, message: string): void;
    warn(details: object, message: string): void;
    error(details: object, message: string): void;
  };
  now(): number;
}

/** The wanted state each league's server was last synced to, by competition. */
export type LastSynced = Map<number, string>;

/**
 * One run over every managed league, one after the other. With `onlyChanged`, a league is
 * synced only when its wanted state differs from the last sync's. Never throws.
 */
export async function syncManagedLeagues(
  deps: ReconcilerDeps,
  last: LastSynced = new Map(),
  onlyChanged = false,
): Promise<void> {
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
      const now = deps.now();
      let target = leagueTarget(deps.db, row.id, now, deps.gateway.botUserId());
      if (target.ok) {
        const transcripts = await saveTranscripts(deps, target.guildId);
        if (transcripts.failures.length > 0)
          deps.logger.warn(
            {
              competitionId: row.id,
              saved: transcripts.saved,
              failed: transcripts.failures.length,
              first: transcripts.failures[0],
            },
            'Some match channel transcripts could not be saved',
          );
        // The saved channels may go now.
        if (transcripts.saved > 0)
          target = leagueTarget(deps.db, row.id, now, deps.gateway.botUserId());
      }
      if (!target.ok) {
        deps.logger.warn(
          { competitionId: row.id, error: target.error },
          'League server sync did not run',
        );
        continue;
      }
      const wanted = JSON.stringify(target.desired);
      if (onlyChanged && last.get(row.id) === wanted) {
        // Nothing to change, but a control message Discord refused before is tried again.
        await postControlMessages(deps, target.guildId);
        continue;
      }
      const reply = await syncGuild(deps.db, deps.gateway, target.guildId, target.desired, {
        dryRun: false,
        now,
        actorPlayerId: null,
      });
      if (!reply.ok) {
        deps.logger.warn(
          { competitionId: row.id, error: reply.error },
          'League server sync did not run',
        );
        continue;
      }
      // Kept even when Discord refused a part: the next full run tries again, not every check.
      last.set(row.id, wanted);
      await postControlMessages(deps, target.guildId);
      if (reply.failures.length > 0) {
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

/**
 * Runs now, then every `intervalMs`, and checks for changes every `checkMs`; a run never starts
 * while another goes on.
 */
export function startReconciler(
  deps: ReconcilerDeps,
  intervalMs = SYNC_INTERVAL_MS,
  checkMs = CHANGE_CHECK_MS,
): () => void {
  const last: LastSynced = new Map();
  let running = false;
  const run = (onlyChanged: boolean) => {
    if (running) return;
    running = true;
    void syncManagedLeagues(deps, last, onlyChanged).finally(() => {
      running = false;
    });
  };
  run(false);
  const full = setInterval(() => {
    run(false);
  }, intervalMs);
  const check = setInterval(() => {
    run(true);
  }, checkMs);
  return () => {
    clearInterval(full);
    clearInterval(check);
  };
}
