import type { Db } from '@ligo/db';
import { t, type Locale } from '../i18n/index.ts';
import { randomInt } from 'node:crypto';
import { recordQueuePost } from '../services/queue-posts.ts';
import { runRequestTick } from '../services/requests.ts';
import { runSchedulingTick } from '../services/scheduling.ts';
import { runVetoTick } from '../services/veto.ts';
import { vetoMessage } from './veto-message.ts';
import type { DiscordGateway } from './gateway.ts';
import { discordTime, matchFixture, mention } from './match-text.ts';
import { postLink, requestQueueMessage } from './request-text.ts';
import type { ErrorLogger } from './router.ts';

// The bot's clock: what happens because time passed, not because someone clicked. Each tick reads
// the database again, so a missed tick only delays the work, and a second one finds it done.

export interface ClockDeps {
  db: Db;
  gateway: DiscordGateway;
  logger: ErrorLogger;
  locale: Locale;
  now(): number;
  /** A whole number from 0 to `below` − 1, for a veto step that ran out; crypto by default. */
  random?: (below: number) => number;
}

/** One tick: deadlines first, then veto steps out of time, then reminders. Never throws. */
export async function tick(deps: ClockDeps): Promise<void> {
  await scheduleTick(deps);
  await vetoTick(deps);
  await requestTick(deps);
}

/**
 * Reminds league staff of team requests about to pass their deadline, pinging the staff role.
 * A request whose post never reached the queue is posted again with its buttons.
 */
async function requestTick(deps: ClockDeps): Promise<void> {
  const { locale } = deps;
  let reminders: ReturnType<typeof runRequestTick>;
  try {
    reminders = runRequestTick(deps.db, deps.now());
  } catch (error) {
    deps.logger.error({ err: error }, 'Request tick failed');
    return;
  }
  for (const reminder of reminders) {
    const { request, queueChannelId, staffRoleId } = reminder;
    try {
      let { post } = reminder;
      if (!post) {
        const posted = await deps.gateway.postMessage(
          queueChannelId,
          requestQueueMessage(locale, request),
        );
        post = { channelId: queueChannelId, messageId: posted.messageId };
        recordQueuePost(deps.db, { entity: 'request', entityId: request.id }, post, deps.now());
      }
      await deps.gateway.postMessage(queueChannelId, {
        content: t(locale, 'request.reminder', {
          role: `<@&${staffRoleId}>`,
          id: request.id,
          team: request.team.name,
          deadline: discordTime(request.deadline ?? request.requestedAt, 'R'),
          link: postLink(reminder.guildId, post),
        }),
        mentionRoleIds: [staffRoleId],
      });
    } catch (error) {
      // The reminder is marked as sent; the request still shows in `/team requests`.
      deps.logger.error({ err: error, requestId: request.id }, 'Could not post a reminder');
    }
  }
}

/** Plays the veto steps whose time ran out and updates their messages. */
async function vetoTick(deps: ClockDeps): Promise<void> {
  let views: ReturnType<typeof runVetoTick>;
  try {
    views = runVetoTick(deps.db, deps.now(), deps.random ?? ((below) => randomInt(below)));
  } catch (error) {
    deps.logger.error({ err: error }, 'Veto tick failed');
    return;
  }
  for (const view of views) {
    if (view.channelId === null || view.messageId === null) continue;
    try {
      await deps.gateway.editMessage(
        view.channelId,
        view.messageId,
        vetoMessage(deps.locale, view),
      );
    } catch (error) {
      // The step is stored; the next click or tick shows it.
      deps.logger.error({ err: error, matchId: view.match.id }, 'Could not update a veto');
    }
  }
}

/** Starts the extensions that are due and announces them. */
async function scheduleTick(deps: ClockDeps): Promise<void> {
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
