import { t, type Locale } from '../i18n/index.ts';
import type { CloseWindowReply, OpenWindowReply } from '../services/mercato-windows.ts';
import type { CommandContext } from './commands/types.ts';
import { discordTime, notify } from './match-text.ts';

// What the league's `#mercato` channel shows of its windows (design doc section 7): when staff
// open one, with its dates, limit and block, and when they close it early. These posts mention
// nobody, since every team is concerned. Without a `#mercato` channel, nothing is posted: the
// website shows the windows anyway.

type Poster = Pick<CommandContext, 'gateway' | 'locale'>;

/** The window's rules in a sentence or two: the move limit, then the block when there is one. */
function windowRules(
  locale: Locale,
  window: { maxMovesPerTeam: number | null; lockHours: number },
): string {
  const limit =
    window.maxMovesPerTeam === null
      ? t(locale, 'mercato.window.noLimit')
      : t(locale, 'mercato.window.limit', { count: window.maxMovesPerTeam });
  return window.lockHours === 0
    ? limit
    : `${limit} ${t(locale, 'mercato.window.lock', { hours: window.lockHours })}`;
}

export async function announceWindowOpened(
  context: Poster,
  reply: Extract<OpenWindowReply, { ok: true }>,
): Promise<boolean> {
  const { locale } = context;
  return notify(context, reply.mercatoChannelId, {
    content: t(locale, 'mercato.window.opened', {
      competition: reply.competition.name,
      season: reply.season.name,
      from: discordTime(reply.window.opensAt),
      to: discordTime(reply.window.closesAt),
      rules: windowRules(locale, reply.window),
    }),
  });
}

export async function announceWindowClosed(
  context: Poster,
  reply: Extract<CloseWindowReply, { ok: true }>,
): Promise<boolean> {
  const { locale } = context;
  const { window } = reply;
  return notify(context, reply.mercatoChannelId, {
    content: reply.wasOpen
      ? t(locale, 'mercato.window.closed', { to: discordTime(window.closesAt) })
      : t(locale, 'mercato.window.cancelled', {
          from: discordTime(window.opensAt),
          to: discordTime(window.closesAt),
        }),
  });
}
