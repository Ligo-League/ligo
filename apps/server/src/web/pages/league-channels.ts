import { html } from 'hono/html';
import type { GuildTextChannel } from '../../discord/gateway.ts';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { LeagueChannelKind, LeagueChannelsReply } from '../../services/league-channels.ts';
import { csrfField, pageOf, type Html, type Page } from '../layout.ts';

// `/:org/:competition/discord/channels` (phase 3f-6): the channels the bot posts in by itself,
// chosen among the league server's text channels, as `/league channel` does in Discord.

/** The refusals the page explains; any other sends back a 403 or shows nothing. */
export const CHANNEL_ERRORS = [
  'cannot_post',
  'channel_not_in_server',
  'channel_required',
  'division_not_found',
  'queue_per_division',
] as const;
export type ChannelError = (typeof CHANNEL_ERRORS)[number];

type Channels = Extract<LeagueChannelsReply, { ok: true }>;

export interface ChannelsPageData {
  competition: { name: string; path: string };
  current: Channels;
  /** The league server's text channels, in Discord's order. */
  channels: GuildTextChannel[];
  csrf: string;
  flash: { saved: true } | { error: ChannelError } | null;
}

/** One row: what the channel is for, the one in use, and a form to change it. */
function row(
  locale: Locale,
  data: ChannelsPageData,
  purpose: string,
  target: { kind: LeagueChannelKind; division: number | null; channelId: string | null },
): Html {
  const known = data.channels.find((channel) => channel.id === target.channelId);
  const inUse =
    target.channelId === null
      ? t(locale, target.division === null ? 'league.channels.unset' : 'league.channels.inherited')
      : known
        ? `#${known.name}`
        : t(locale, 'web.channels.unknown');
  // Without a channel, a division's results go to the league's channel; the league must have one.
  const empty: MessageKey =
    target.division === null ? 'web.channels.choose' : 'league.channels.inherited';
  return html`<tr>
    <td>${purpose}</td>
    <td>${inUse}</td>
    <td>
      <form class="inline" method="post" action="${data.competition.path}/discord/channels">
        ${csrfField(data.csrf)}
        <input type="hidden" name="kind" value="${target.kind}" />
        <input
          type="hidden"
          name="division"
          value="${target.division === null ? '' : String(target.division)}"
        />
        <select name="channel" aria-label="${purpose}">
          <option value="" ${known ? '' : 'selected'}>${t(locale, empty)}</option>
          ${data.channels.map(
            (channel) =>
              html`<option
                value="${channel.id}"
                ${channel.id === target.channelId ? 'selected' : ''}
              >
                #${channel.name}${channel.category === null ? '' : ` (${channel.category})`}
              </option>`,
          )}
        </select>
        <button type="submit">${t(locale, 'web.channels.save')}</button>
      </form>
    </td>
  </tr>`;
}

export function leagueChannelsPage(locale: Locale, data: ChannelsPageData): Page {
  const title = t(locale, 'web.channels.title', { competition: data.competition.name });
  const { current } = data;
  const kind = (key: LeagueChannelKind) => t(locale, `league.channel.kind.${key}`);
  const flash = data.flash
    ? 'error' in data.flash
      ? html`<p class="card flash error">${t(locale, `league.error.${data.flash.error}`)}</p>`
      : html`<p class="card flash">${t(locale, 'web.channels.saved')}</p>`
    : '';
  const body = html`<h1>${title}</h1>
    ${flash}
    <p>${t(locale, 'web.channels.intro')}</p>
    <table>
      <thead>
        <tr>
          <th>${t(locale, 'web.channels.purpose')}</th>
          <th>${t(locale, 'web.channels.current')}</th>
          <th>${t(locale, 'web.channels.change')}</th>
        </tr>
      </thead>
      <tbody>
        ${row(locale, data, kind('staff_queue'), {
          kind: 'staff_queue',
          division: null,
          channelId: current.queueChannelId,
        })}
        ${row(locale, data, kind('schedule'), {
          kind: 'schedule',
          division: null,
          channelId: current.scheduleChannelId,
        })}
        ${row(locale, data, kind('mercato'), {
          kind: 'mercato',
          division: null,
          channelId: current.mercatoChannelId,
        })}
        ${row(locale, data, kind('results'), {
          kind: 'results',
          division: null,
          channelId: current.resultsChannelId,
        })}
        ${current.divisions.map((division) =>
          row(
            locale,
            data,
            t(locale, 'web.channels.divisionResults', {
              kind: kind('results'),
              division: division.name,
            }),
            { kind: 'results', division: division.id, channelId: division.resultsChannelId },
          ),
        )}
      </tbody>
    </table>
    <p class="muted">${t(locale, 'web.channels.hint')}</p>
    <p><a href="${data.competition.path}/discord">${t(locale, 'web.channels.back')}</a></p>`;
  return pageOf(title, body);
}
