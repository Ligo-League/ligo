import type { Db } from '@ligo/db';
import { t, type Locale } from '../i18n/index.ts';
import { runSchedulingTick } from '../services/scheduling.ts';
import type { DiscordGateway } from './gateway.ts';
import { discordTime, matchFixture, mention } from './match-text.ts';
import type { ErrorLogger } from './router.ts';

// The bot's clock: what happens because time passed, not because someone clicked. Each tick reads
// the database again, so a missed tick only delays the work, and a second one finds it done.

export interface ClockDeps {
  db: Db;
  gateway: DiscordGateway;
  logger: ErrorLogger;
  locale: Locale;
  now(): number;
}

/** One tick: starts the extensions that are due and announces them. Never throws. */
export async function tick(deps: ClockDeps): Promise<void> {
  const { locale } = deps;
  let notices: ReturnType<typeof runSchedulingTick>;
  try {
    notices = runSchedulingTick(deps.db, deps.now());
  } catch (error) {
    deps.logger.error({ err: error }, 'Scheduling tick failed');
    return;
  }
  for (const notice of notices) {
    const content = t(locale, 'schedule.autoSlot', {
      fixture: matchFixture(locale, notice.match),
      when: discordTime(notice.at),
      // The extension ends at midnight: its last day is the one before.
      deadline: discordTime(notice.extensionEnd - 60_000, 'D'),
      mentions: notice.mentionUserIds.map(mention).join(' '),
    });
    for (const channelId of notice.channelIds) {
      try {
        await deps.gateway.postMessage(channelId, {
          content,
          mentionUserIds: notice.mentionUserIds,
        });
      } catch (error) {
        // The time is set and audited; only the notice is lost.
        deps.logger.error({ err: error, matchId: notice.match.id }, 'Could not post a notice');
      }
    }
  }
}

/** Runs `tick` every `intervalMs`, one at a time; returns a function that stops it. */
export function startClock(deps: ClockDeps, intervalMs: number): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void tick(deps).finally(() => {
      running = false;
    });
  }, intervalMs);
  return () => {
    clearInterval(timer);
  };
}
