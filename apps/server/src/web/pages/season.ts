import { STANDINGS_ZONE_KINDS } from '@ligo/core';
import { html } from 'hono/html';
import { t, type Locale } from '../../i18n/index.ts';
import type { SeasonPage } from '../../services/site.ts';
import type { StandingsTable } from '../../services/standings.ts';
import { matchList, pageOf, type Html, type Page } from '../layout.ts';

type Data = Extract<SeasonPage, { ok: true }>;

function standingsTable(locale: Locale, table: StandingsTable): Html {
  const column = (key: Parameters<typeof t>[1]) => t(locale, key);
  const zones = STANDINGS_ZONE_KINDS.filter((zone) => table.rows.some((row) => row.zone === zone));
  return html`<h3>${table.division}</h3>
    <div class="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>${column('standings.column.rank')}</th>
            <th class="team">${column('standings.column.team')}</th>
            <th>${column('standings.column.playedShort')}</th>
            <th>${column('standings.column.wins')}</th>
            <th>${column('standings.column.losses')}</th>
            <th>${column('standings.column.for')}</th>
            <th>${column('standings.column.against')}</th>
            <th>${column('standings.column.diff')}</th>
            <th>${column('standings.column.points')}</th>
          </tr>
        </thead>
        <tbody>
          ${table.rows.map(
            (row) =>
              html`<tr
                class="${row.zone ? `zone-${row.zone}` : ''}${row.excluded ? ' excluded' : ''}"
              >
                <td class="rank">
                  ${row.shared ? t(locale, 'web.standings.shared', { rank: row.rank }) : row.rank}
                </td>
                <td class="team">
                  ${row.team.name}
                  ${row.excluded ? html` <span class="muted">(${t(locale, 'web.standings.excluded')})</span>` : ''}
                </td>
                <td>${row.played}</td>
                <td>${row.wins}</td>
                <td>${row.losses}</td>
                <td>${row.scoreFor}</td>
                <td>${row.scoreAgainst}</td>
                <td>${row.diff > 0 ? `+${String(row.diff)}` : row.diff}</td>
                <td><strong>${row.points}</strong></td>
              </tr>`,
          )}
        </tbody>
      </table>
      ${
        zones.length > 0
          ? html`<p class="legend">
              ${t(locale, 'web.standings.legend')}
              ${zones.map(
                (zone) =>
                  html`<span style="--swatch: var(--zone-${zone})"
                    >${t(locale, `standings.zone.${zone}`)}</span
                  >`,
              )}
            </p>`
          : ''
      }
    </div>`;
}

/** `/:org/:competition/:season`: standings per division, latest results, fixtures by week. */
export function seasonPageView(locale: Locale, page: Data): Page {
  const { competition, season } = page;
  const title = t(locale, 'web.season.title', {
    competition: competition.name,
    season: season.name,
  });
  const others = page.seasons.filter((other) => other.slug !== season.slug);
  const body = html`<h1>${title}</h1>
    <p><a href="${competition.path}/rules">${t(locale, 'web.season.rules')}</a></p>
    ${
      others.length > 0
        ? html`<p class="muted">
            ${t(locale, 'web.season.others')}
            ${others.map((other) => html` <a href="${competition.path}/${other.slug}">${other.name}</a>`)}
          </p>`
        : ''
    }
    <h2>${t(locale, 'web.season.standings')}</h2>
    ${
      page.standings.length > 0
        ? page.standings.map((table) => standingsTable(locale, table))
        : html`<p class="muted">${t(locale, 'web.season.noStandings')}</p>`
    }
    <h2>${t(locale, 'web.season.latest')}</h2>
    ${
      page.latest.length > 0
        ? html`<div class="card">${matchList(locale, page.latest, competition.timeZone)}</div>`
        : html`<p class="muted">${t(locale, 'web.season.noResults')}</p>`
    }
    <h2>${t(locale, 'web.season.fixtures')}</h2>
    ${
      page.fixtures.length > 0
        ? page.fixtures.map(
            (group) =>
              html`<h3>${group.division}</h3>
                ${group.weeks.map(
                  (week) =>
                    html`<div class="card">
                      ${week.week === null ? '' : html`<strong>${t(locale, 'web.week', { week: week.week })}</strong>`}
                      ${matchList(locale, week.matches, competition.timeZone)}
                    </div>`,
                )}`,
          )
        : html`<p class="muted">${t(locale, 'web.season.noFixtures')}</p>`
    }`;
  return pageOf(title, body);
}
