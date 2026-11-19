import { html } from 'hono/html';
import { moveLine } from '../../discord/move-posts.ts';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { LineupMember, MercatoTeamView, MoveView } from '../../services/roster-moves.ts';
import { csrfField, formatWhen, pageOf, type Html, type Page } from '../layout.ts';

// `/teams/:slug/mercato` (phase 3f-11; design doc section 7): a roster's lineup for the season
// under way, its moves and the form to file one, for league staff and the officials who manage
// its players. Role and captain changes apply at once; a move waits for staff.

export const MERCATO_TEAM_DONE = ['filed', 'withdrawn', 'role', 'exception'] as const;
export type MercatoTeamDone = (typeof MERCATO_TEAM_DONE)[number];

const ERROR_KEYS = {
  empty_move: 'web.rosterMercato.error.empty_move',
  not_in_lineup: 'web.rosterMercato.error.not_in_lineup',
  captain_leaving: 'web.rosterMercato.error.captain_leaving',
  not_on_roster: 'web.rosterMercato.error.not_on_roster',
  already_in_lineup: 'web.rosterMercato.error.already_in_lineup',
  intra_club_closed: 'web.rosterMercato.error.intra_club_closed',
  window_closed: 'web.rosterMercato.error.window_closed',
  limit_reached: 'web.rosterMercato.error.limit_reached',
  too_many_starters: 'web.rosterMercato.error.too_many_starters',
  too_many_subs: 'web.rosterMercato.error.too_many_subs',
  already_pending: 'web.rosterMercato.error.already_pending',
  player_incomplete: 'web.rosterMercato.error.player_incomplete',
  not_on_server: 'web.rosterMercato.error.not_on_server',
  discord_unavailable: 'web.rosterMercato.error.discord_unavailable',
  not_pending: 'web.rosterMercato.error.not_pending',
  captain_not_starter: 'web.rosterMercato.error.captain_not_starter',
  not_started: 'web.rosterMercato.error.not_started',
  not_found: 'web.rosterMercato.error.not_found',
  reason_required: 'web.rosterMercato.error.reason_required',
} as const satisfies Record<string, MessageKey>;
export type MercatoTeamError = keyof typeof ERROR_KEYS;
export const isMercatoTeamError = (value: string | undefined): value is MercatoTeamError =>
  value !== undefined && Object.hasOwn(ERROR_KEYS, value);

/** The text explaining a refused move, for the staff queue too. */
export const mercatoTeamErrorKey = (error: MercatoTeamError): MessageKey => ERROR_KEYS[error];

export type MercatoTeamFlash = { done: MercatoTeamDone } | { error: MercatoTeamError } | null;

type View = Extract<MercatoTeamView, { ok: true }>;

/** Where the mercato stands for the roster now, in a sentence. */
function statusLine(locale: Locale, view: View): string {
  const when = (at: number) => formatWhen(locale, at, view.timeZone);
  const count =
    view.limit === null
      ? t(locale, 'web.rosterMercato.countNoLimit', { count: view.movesCounted })
      : t(locale, 'web.rosterMercato.count', { count: view.movesCounted, limit: view.limit });
  if (!view.lineupLocked) return t(locale, 'web.rosterMercato.free');
  if (view.settings.mode === 'open') return `${t(locale, 'web.rosterMercato.alwaysOpen')} ${count}`;
  if (view.window) {
    const closes = view.window.closedEarlyAt ?? view.window.closesAt;
    return `${t(locale, 'web.rosterMercato.windowOpen', { until: when(closes) })} ${count}`;
  }
  return view.nextWindow
    ? t(locale, 'web.rosterMercato.nextWindow', {
        from: when(view.nextWindow.opensAt),
        to: when(view.nextWindow.closesAt),
      })
    : t(locale, 'web.rosterMercato.noWindow');
}

function lineupRow(locale: Locale, view: View, entry: LineupMember, csrf: string): Html {
  const action = `/teams/${view.team.slug}/mercato/role`;
  const roleForm = (role: 'player' | 'sub') =>
    html`<form class="inline" method="post" action="${action}">
      ${csrfField(csrf)}
      <input type="hidden" name="player" value="${String(entry.playerId)}" />
      <input type="hidden" name="role" value="${role}" />
      <button type="submit">
        ${t(locale, role === 'sub' ? 'web.rosterMercato.toSub' : 'web.rosterMercato.toStarter')}
      </button>
    </form>`;
  return html`<tr>
    <td>
      ${entry.name}${entry.captain ? html` <strong>(${t(locale, 'web.rosterMercato.captain')})</strong>` : ''}
    </td>
    <td>${t(locale, `mercato.role.${entry.role}`)}</td>
    <td>
      ${
        entry.startsAt === null
          ? ''
          : t(locale, 'web.rosterMercato.startsAt', {
              when: formatWhen(locale, entry.startsAt, view.timeZone),
            })
      }
    </td>
    <td>
      ${entry.captain ? '' : roleForm(entry.role === 'player' ? 'sub' : 'player')}
      ${
        entry.role === 'player' && !entry.captain && entry.startsAt === null
          ? html`<form class="inline" method="post" action="${action}">
              ${csrfField(csrf)}
              <input type="hidden" name="captain" value="${String(entry.playerId)}" />
              <button type="submit">${t(locale, 'web.rosterMercato.makeCaptain')}</button>
            </form>`
          : ''
      }
    </td>
  </tr>`;
}

function moveForm(locale: Locale, view: View, csrf: string): Html {
  if (!view.canFile) return html``;
  const leaving = view.lineup.filter((entry) => !entry.captain);
  return html`<form class="card stack" method="post" action="/teams/${view.team.slug}/mercato/move">
    ${csrfField(csrf)}
    <h2>${t(locale, 'web.rosterMercato.fileTitle')}</h2>
    <p class="muted">${t(locale, 'web.rosterMercato.fileHint')}</p>
    <label
      >${t(locale, 'web.rosterMercato.out')}
      <select name="out">
        <option value="">${t(locale, 'web.rosterMercato.nobody')}</option>
        ${leaving.map(
          (entry) => html`<option value="${String(entry.playerId)}">${entry.name}</option>`,
        )}
      </select></label
    >
    <label
      >${t(locale, 'web.rosterMercato.in')}
      <select name="in">
        <option value="">${t(locale, 'web.rosterMercato.nobody')}</option>
        ${view.candidates.map(
          (entry) => html`<option value="${String(entry.playerId)}">${entry.name}</option>`,
        )}
      </select></label
    >
    <label
      >${t(locale, 'web.rosterMercato.role')}
      <select name="role">
        <option value="player">${t(locale, 'mercato.role.player')}</option>
        <option value="sub">${t(locale, 'mercato.role.sub')}</option>
      </select></label
    >
    <label
      >${t(locale, 'web.rosterMercato.note')}
      <textarea name="note" maxlength="500" rows="2"></textarea>
    </label>
    <button type="submit">${t(locale, 'web.rosterMercato.file')}</button>
  </form>`;
}

/** League staff only: a move applied at once, at any time, with a reason (O-35). */
function exceptionForm(locale: Locale, view: View, csrf: string): Html {
  if (!view.staff) return html``;
  const leaving = view.lineup.filter((entry) => !entry.captain);
  return html`<form
    class="card stack"
    method="post"
    action="/teams/${view.team.slug}/mercato/exception"
  >
    ${csrfField(csrf)}
    <h2>${t(locale, 'web.rosterMercato.exceptionTitle')}</h2>
    <p class="muted">${t(locale, 'web.rosterMercato.exceptionHint')}</p>
    <label
      >${t(locale, 'web.rosterMercato.out')}
      <select name="out">
        <option value="">${t(locale, 'web.rosterMercato.nobody')}</option>
        ${leaving.map(
          (entry) => html`<option value="${String(entry.playerId)}">${entry.name}</option>`,
        )}
      </select></label
    >
    <label
      >${t(locale, 'web.rosterMercato.in')}
      <select name="in">
        <option value="">${t(locale, 'web.rosterMercato.nobody')}</option>
        ${view.candidates.map(
          (entry) => html`<option value="${String(entry.playerId)}">${entry.name}</option>`,
        )}
      </select></label
    >
    <label
      >${t(locale, 'web.rosterMercato.role')}
      <select name="role">
        <option value="player">${t(locale, 'mercato.role.player')}</option>
        <option value="sub">${t(locale, 'mercato.role.sub')}</option>
      </select></label
    >
    <label
      >${t(locale, 'web.rosterMercato.exceptionReason')}
      <textarea name="reason" maxlength="500" rows="2" required></textarea>
    </label>
    <button type="submit">${t(locale, 'web.rosterMercato.exceptionApply')}</button>
  </form>`;
}

function movesTable(locale: Locale, view: View, csrf: string): Html {
  if (view.moves.length === 0) {
    return html`<p class="muted">${t(locale, 'web.rosterMercato.noMoves')}</p>`;
  }
  const row = (move: MoveView) =>
    html`<tr>
      <td>${formatWhen(locale, move.requestedAt, view.timeZone)}</td>
      <td>${moveLine(locale, move)}</td>
      <td>
        ${t(locale, `web.rosterMercato.status.${move.status}`)}${move.reason === null ? '' : ` — ${move.reason}`}
      </td>
      <td>${move.counted ? '' : t(locale, 'web.rosterMercato.notCounted')}</td>
      <td>
        ${
          move.status === 'pending'
            ? html`<form
                class="inline"
                method="post"
                action="/teams/${view.team.slug}/mercato/moves/${String(move.id)}/withdraw"
              >
                ${csrfField(csrf)}
                <button type="submit">${t(locale, 'web.rosterMercato.withdraw')}</button>
              </form>`
            : ''
        }
      </td>
    </tr>`;
  return html`<div class="table-wrap">
    <table>
      <tbody>
        ${view.moves.map(row)}
      </tbody>
    </table>
  </div>`;
}

export function rosterMercatoPage(
  locale: Locale,
  view: View,
  state: { csrf: string; flash: MercatoTeamFlash },
): Page {
  const title = t(locale, 'web.rosterMercato.title', { team: view.team.name });
  const flash = state.flash
    ? 'error' in state.flash
      ? html`<p class="card flash error">${t(locale, ERROR_KEYS[state.flash.error])}</p>`
      : html`<p class="card flash">${t(locale, `web.rosterMercato.done.${state.flash.done}`)}</p>`
    : '';
  const body = html`<h1>${title}</h1>
    ${flash}
    <p>${view.competition.name}, ${view.season.name}. ${statusLine(locale, view)}</p>
    <h2>${t(locale, 'web.rosterMercato.lineup')}</h2>
    <div class="table-wrap">
      <table>
        <tbody>
          ${view.lineup.map((entry) => lineupRow(locale, view, entry, state.csrf))}
        </tbody>
      </table>
    </div>
    <p class="muted">${t(locale, 'web.rosterMercato.roleHint')}</p>
    ${moveForm(locale, view, state.csrf)} ${exceptionForm(locale, view, state.csrf)}
    <h2>${t(locale, 'web.rosterMercato.moves')}</h2>
    ${movesTable(locale, view, state.csrf)}
    <p><a href="/teams/${view.team.slug}/manage">${t(locale, 'web.rosterMercato.back')}</a></p>`;
  return pageOf(title, body);
}
