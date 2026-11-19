import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { MercatoOverview } from '../../services/mercato-windows.ts';
import { csrfField, formatWhen, pageOf, type Html, type Page } from '../layout.ts';

// `/staff/mercato` (phase 3f-10; design doc section 7): the mercato windows of each league the
// viewer is staff of. Every form names its competition; the service checks staff again.

export const MERCATO_DONE = ['opened', 'closed'] as const;
export type MercatoDone = (typeof MERCATO_DONE)[number];

const ERROR_KEYS = {
  no_season: 'web.mercato.error.no_season',
  always_open: 'web.mercato.error.always_open',
  closes_before_opening: 'web.mercato.error.closes_before_opening',
  closes_in_past: 'web.mercato.error.closes_in_past',
  invalid_limit: 'web.mercato.error.invalid_limit',
  invalid_lock: 'web.mercato.error.invalid_lock',
  overlaps: 'web.mercato.error.overlaps',
  window_not_found: 'web.mercato.error.window_not_found',
  already_closed: 'web.mercato.error.already_closed',
  invalid_date: 'schedule.error.invalid_date',
  invalid_time: 'schedule.error.invalid_time',
  nonexistent_time: 'schedule.error.nonexistent_time',
} as const satisfies Record<string, MessageKey>;
export type MercatoError = keyof typeof ERROR_KEYS;
export const isMercatoError = (value: string | undefined): value is MercatoError =>
  value !== undefined && Object.hasOwn(ERROR_KEYS, value);

export type MercatoFlash = { done: MercatoDone } | { error: MercatoError } | null;

export interface LeagueMercato {
  competitionId: number;
  name: string;
  overview: Extract<MercatoOverview, { ok: true }>;
}

function windowsTable(locale: Locale, league: LeagueMercato, csrf: string): Html {
  const { overview } = league;
  if (overview.windows.length === 0) {
    return html`<p class="muted">${t(locale, 'web.mercato.none')}</p>`;
  }
  const when = (at: number) => formatWhen(locale, at, overview.timeZone);
  return html`<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>${t(locale, 'web.mercato.opens')}</th>
          <th>${t(locale, 'web.mercato.closes')}</th>
          <th>${t(locale, 'web.mercato.limit')}</th>
          <th>${t(locale, 'web.mercato.lock')}</th>
          <th>${t(locale, 'web.mercato.state')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${overview.windows.map(
          (row) =>
            html`<tr>
              <td>${when(row.opensAt)}</td>
              <td>
                ${
                  row.closedEarlyAt === null
                    ? when(row.closesAt)
                    : t(locale, 'web.mercato.closedEarly', {
                        planned: when(row.closesAt),
                        at: when(row.closedEarlyAt),
                      })
                }
              </td>
              <td>
                ${
                  row.maxMovesPerTeam === null
                    ? t(locale, 'web.mercato.noLimit')
                    : String(row.maxMovesPerTeam)
                }
              </td>
              <td>${t(locale, 'web.mercato.hours', { hours: row.lockHours })}</td>
              <td>${t(locale, `web.mercato.state.${row.state}`)}</td>
              <td>
                ${
                  row.state === 'closed'
                    ? ''
                    : html`<form
                        class="inline"
                        method="post"
                        action="/staff/mercato/${String(league.competitionId)}/close"
                      >
                        ${csrfField(csrf)}
                        <input type="hidden" name="window" value="${String(row.id)}" />
                        <button type="submit">
                          ${t(
                            locale,
                            row.state === 'open' ? 'web.mercato.close' : 'web.mercato.cancel',
                          )}
                        </button>
                      </form>`
                }
              </td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

function openForm(locale: Locale, league: LeagueMercato, csrf: string): Html {
  const { settings } = league.overview;
  return html`<form
    class="card stack"
    method="post"
    action="/staff/mercato/${String(league.competitionId)}/open"
  >
    ${csrfField(csrf)}
    <h3>${t(locale, 'web.mercato.openTitle')}</h3>
    <p class="muted">${t(locale, 'web.mercato.timeZone', { zone: league.overview.timeZone })}</p>
    <label
      >${t(locale, 'web.mercato.opens')}
      <input type="date" name="opens_date" required />
      <input type="time" name="opens_time" required value="00:00"
    /></label>
    <label
      >${t(locale, 'web.mercato.closes')}
      <input type="date" name="closes_date" required />
      <input type="time" name="closes_time" required value="23:59"
    /></label>
    <label
      >${t(locale, 'web.mercato.limitField')}
      <input
        type="number"
        name="limit"
        min="1"
        max="50"
        value="${settings.max_moves_per_team === null ? '' : String(settings.max_moves_per_team)}"
    /></label>
    <label
      >${t(locale, 'web.mercato.lockField')}
      <input
        type="number"
        name="lock_hours"
        min="0"
        max="720"
        required
        value="${String(settings.lock_hours)}"
    /></label>
    <button type="submit">${t(locale, 'web.mercato.open')}</button>
  </form>`;
}

function leagueSection(locale: Locale, league: LeagueMercato, csrf: string): Html {
  const { overview } = league;
  const heading = html`<h2 id="c${String(league.competitionId)}">${league.name}</h2>`;
  if (!overview.season) {
    return html`${heading}
      <p class="muted">${t(locale, 'web.mercato.noSeason')}</p>`;
  }
  if (overview.settings.mode === 'open') {
    return html`${heading}
      <p>${t(locale, 'web.mercato.alwaysOpen', { season: overview.season.name })}</p>`;
  }
  return html`${heading}
    <p>${t(locale, 'web.mercato.season', { season: overview.season.name })}</p>
    ${windowsTable(locale, league, csrf)} ${openForm(locale, league, csrf)}`;
}

export function staffMercatoPage(
  locale: Locale,
  data: { leagues: LeagueMercato[]; csrf: string; flash: MercatoFlash },
): Page {
  const title = t(locale, 'web.mercato.title');
  const flash = data.flash
    ? 'error' in data.flash
      ? html`<p class="card flash error">${t(locale, ERROR_KEYS[data.flash.error])}</p>`
      : html`<p class="card flash">${t(locale, `web.mercato.done.${data.flash.done}`)}</p>`
    : '';
  const body = html`<h1>${title}</h1>
    ${flash}
    <p>${t(locale, 'web.mercato.intro')}</p>
    ${data.leagues.map((league) => leagueSection(locale, league, data.csrf))}
    <p><a href="/staff">${t(locale, 'web.mercato.back')}</a></p>`;
  return pageOf(title, body);
}
