import { t, type Locale } from '../i18n/index.ts';
import {
  controlMessageData,
  pendingControlMessages,
  recordControlMessage,
  type ControlMessageData,
} from '../services/control-messages.ts';
import type { OutgoingMessage } from './commands/types.ts';
import type { DiscordGateway } from './gateway.ts';
import { discordTime, matchFixture } from './match-text.ts';

// A match channel's control message (design doc section 6, "Match channel lifecycle"): the
// fixture, its week and extension, who would host and choose sides from today's standings, what
// the teams do step by step, and buttons to the match's pages, where every action is taken
// (section 3). Pinned in the channel.

/** The control message of a match. */
export function controlMessage(
  locale: Locale,
  data: ControlMessageData,
  publicUrl: URL,
): OutgoingMessage {
  const { match, period, sides } = data;
  const name = (side: 'a' | 'b' | null) => (side === null ? '' : match[side].name);
  const lines = [
    ...(data.teamRoleIds.length > 0 ? [data.teamRoleIds.map((id) => `<@&${id}>`).join(' ')] : []),
    `**${matchFixture(locale, match)}**`,
    t(locale, 'control.week', {
      start: discordTime(period.start, 'D'),
      end: discordTime(period.end - 1, 'D'),
    }),
    t(locale, 'control.extension', { end: discordTime(period.extensionEnd - 1, 'D') }),
    sides === null
      ? t(locale, 'control.sides.unknown')
      : sides.byCoin
        ? t(locale, 'control.sides.coin')
        : t(locale, 'control.sides.ranked', {
            host: name(sides.host),
            chooser: name(sides.chooser),
          }),
    '',
    t(locale, 'control.steps'),
  ];
  const page = (path: string) => new URL(path, publicUrl).href;
  const id = String(match.id);
  return {
    content: lines.join('\n'),
    links: [
      { label: t(locale, 'control.link.match'), url: page(`/matches/${id}#time`) },
      { label: t(locale, 'control.link.veto'), url: page(`/matches/${id}/veto`) },
      { label: t(locale, 'control.link.result'), url: page(`/matches/${id}#result`) },
      { label: t(locale, 'control.link.stats'), url: page(`/matches/${id}/stats`) },
    ],
    // The two teams are told their channel is open.
    mentionRoleIds: data.teamRoleIds,
  };
}

export interface ControlPostDeps {
  db: Parameters<typeof recordControlMessage>[0] & Parameters<typeof pendingControlMessages>[0];
  gateway: Pick<DiscordGateway, 'postMessage' | 'pinMessage'>;
  locale: Locale;
  publicUrl: URL;
  logger: { warn(details: object, message: string): void };
}

/**
 * Posts and pins the control message in each of the server's match channels that has none
 * there yet. A message that could not be posted is tried again on the next run; one posted but
 * not pinned stays posted, and the refusal is logged.
 */
export async function postControlMessages(deps: ControlPostDeps, guildId: string): Promise<number> {
  let posted = 0;
  for (const pending of pendingControlMessages(deps.db, guildId)) {
    const data = controlMessageData(deps.db, guildId, pending.matchId);
    if (!data) continue;
    let messageId: string;
    try {
      ({ messageId } = await deps.gateway.postMessage(
        pending.channelId,
        controlMessage(deps.locale, data, deps.publicUrl),
      ));
    } catch (error) {
      deps.logger.warn(
        { err: error, matchId: pending.matchId },
        'Could not post a match channel’s control message',
      );
      continue;
    }
    recordControlMessage(deps.db, pending.matchId, pending.channelId, messageId);
    posted += 1;
    try {
      await deps.gateway.pinMessage(pending.channelId, messageId);
    } catch (error) {
      deps.logger.warn(
        { err: error, matchId: pending.matchId },
        'Could not pin a match channel’s control message',
      );
    }
  }
  return posted;
}
