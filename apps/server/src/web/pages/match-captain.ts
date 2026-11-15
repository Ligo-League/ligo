import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { LineupPlayer } from '../../services/match-captain.ts';
import { csrfField, type Html } from '../layout.ts';

// The match page's captain panel (O-30b), for a side's officials and its usual captain: name a
// starter or substitute of the lineup captain for this match, or nobody. The service checks
// everything again on every POST.

export const CAPTAIN_DONE = ['named', 'cleared'] as const;
export type CaptainDone = (typeof CAPTAIN_DONE)[number];

const ERROR_KEYS = {
  not_linked: 'web.captain.error.not_allowed',
  match_not_found: 'web.captain.error.not_allowed',
  not_allowed: 'web.captain.error.not_allowed',
  match_closed: 'web.captain.error.match_closed',
  not_in_lineup: 'web.captain.error.not_in_lineup',
  usual_captain: 'web.captain.error.usual_captain',
} as const satisfies Record<string, MessageKey>;
export type CaptainError = keyof typeof ERROR_KEYS;
export const isCaptainError = (value: string | undefined): value is CaptainError =>
  value !== undefined && Object.hasOwn(ERROR_KEYS, value);

export type CaptainFlash = { done: CaptainDone } | { error: CaptainError } | null;

type Named = { playerId: number; name: string } | null;

export interface CaptainPanelData {
  matchId: number;
  /** The sides the viewer may name a captain for, each with its lineup and captains. */
  sides: {
    side: 'a' | 'b';
    team: string;
    usual: Named;
    standIn: Named;
    lineup: LineupPlayer[];
  }[];
  csrf: string;
  flash: CaptainFlash;
}

export function captainPanel(locale: Locale, data: CaptainPanelData): Html {
  const flash = !data.flash
    ? ''
    : 'done' in data.flash
      ? html`<p class="card flash">${t(locale, `web.captain.done.${data.flash.done}`)}</p>`
      : html`<p class="card flash error">${t(locale, ERROR_KEYS[data.flash.error])}</p>`;
  return html`<section id="captain">
    <h2>${t(locale, 'web.captain.title')}</h2>
    <p class="muted">${t(locale, 'web.captain.intro')}</p>
    ${flash}
    ${data.sides.map(
      (entry) =>
        html`<form class="card" method="post" action="/matches/${String(data.matchId)}/captain">
          ${csrfField(data.csrf)}
          <input type="hidden" name="side" value="${entry.side}" />
          <p><strong>${entry.team}</strong></p>
          <p>
            ${
              entry.usual
                ? t(locale, 'web.captain.usual', { name: entry.usual.name })
                : t(locale, 'web.captain.noUsual')
            }
          </p>
          ${
            entry.standIn
              ? html`<p>${t(locale, 'web.captain.standIn', { name: entry.standIn.name })}</p>`
              : ''
          }
          <label
            >${t(locale, 'web.captain.pick')}
            <select name="player">
              <option value="">${t(locale, 'web.captain.none')}</option>
              ${entry.lineup
                .filter((player) => !player.captain)
                .map(
                  (player) =>
                    html`<option
                      value="${String(player.playerId)}"
                      ${player.playerId === entry.standIn?.playerId ? 'selected' : ''}
                    >
                      ${player.name} (${t(locale, `web.captain.role.${player.role}`)})
                    </option>`,
                )}
            </select></label
          >
          <button type="submit">${t(locale, 'web.captain.save')}</button>
        </form>`,
    )}
  </section>`;
}
