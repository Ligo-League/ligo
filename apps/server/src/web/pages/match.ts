import { html } from 'hono/html';
import { t, type Locale } from '../../i18n/index.ts';
import { playerPath } from '../../services/paths.ts';
import type { Scoreboard } from '../../services/scoreboard.ts';
import type { MatchPage } from '../../services/site.ts';
import { formatWhen, matchOutcome, pageOf, type Html, type Page } from '../layout.ts';

type Data = Extract<MatchPage, { ok: true }>;
type Column = Scoreboard['columns'][number];

/** A stat as the scoreboard and the player page show it. */
export function figure(
  locale: Locale,
  column: Pick<Column, 'format'>,
  value: number | null | undefined,
): string {
  if (value === null || value === undefined) return '–';
  const number = (options: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', options).format(value);
  switch (column.format) {
    case 'count':
      return number({ maximumFractionDigits: 0 });
    case 'ratio':
      return number({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'percent':
      return number({ style: 'percent', maximumFractionDigits: 0 });
    case 'signed':
      return number({ maximumFractionDigits: 0, signDisplay: 'exceptZero' });
  }
}

/** One game's figures, a table per side (M-39); players without stats consent named only. */
function gameScoreboard(
  locale: Locale,
  columns: readonly Column[],
  sides: Scoreboard['games'][number]['sides'],
): Html {
  return html`${sides.map(
    (entry) =>
      html`<table class="stat-grid scoreboard">
        <caption>
          ${entry.team}
        </caption>
        <thead>
          <tr>
            <th scope="col">${t(locale, 'web.stats.player')}</th>
            ${columns.map((column) => html`<th scope="col">${column.label[locale]}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${
            entry.rows.length === 0
              ? html`<tr>
                  <td colspan="${String(columns.length + 1)}" class="muted">
                    ${t(locale, 'web.match.noStats')}
                  </td>
                </tr>`
              : entry.rows.map(
                  (row) =>
                    html`<tr>
                      <th scope="row"><a href="${playerPath(row.slug)}">${row.name}</a></th>
                      ${
                        row.hidden
                          ? html`<td colspan="${String(columns.length)}" class="muted">
                              ${t(locale, 'web.match.statsHidden')}
                            </td>`
                          : columns.map(
                              (column) =>
                                html`<td>${figure(locale, column, row.values[column.key])}</td>`,
                            )
                      }
                    </tr>`,
                )
          }
        </tbody>
      </table>`,
  )}`;
}

/**
 * `/matches/:id`: the teams, the time or the result, and each game's map and bans. `panels` are
 * what the viewer's own team may do in the match, when they act for a side.
 */
export function matchPageView(
  locale: Locale,
  page: Data,
  panels: readonly (Html | string)[] = [],
  scoreboard: Scoreboard | null = null,
): Page {
  const { match, league } = page;
  const { timeZone } = league.competition;
  const title = t(locale, 'web.match.title', { a: match.a.name, b: match.b.name });
  const boards = new Map(
    (scoreboard?.games ?? []).map((entry) => [
      entry.n,
      gameScoreboard(locale, scoreboard?.columns ?? [], entry.sides),
    ]),
  );
  const when = match.scheduledAt === null ? null : formatWhen(locale, match.scheduledAt, timeZone);
  const body = html`<p class="muted">
      <a href="${league.competition.path}/${league.season.slug}"
        >${t(locale, 'web.match.context', {
          competition: league.competition.name,
          season: league.season.name,
          division: match.division ?? '',
          week: match.week ?? '',
        })}</a
      >
    </p>
    <h1>
      <a href="/teams/${match.a.slug}">${match.a.name}</a> –
      <a href="/teams/${match.b.slug}">${match.b.name}</a>
    </h1>
    <p>${matchOutcome(locale, match, timeZone)}</p>
    ${match.result && when ? html`<p class="muted">${when}</p>` : ''}
    ${page.host ? html`<p>${t(locale, 'web.match.host', { team: page.host })}</p>` : ''} ${panels}
    <h2>${t(locale, 'web.match.games')}</h2>
    ${
      page.games.length > 0
        ? page.games.map(
            (game) =>
              html`<div class="card">
                <strong
                  >${
                    game.map
                      ? t(locale, 'web.match.game', { n: game.n, map: game.map })
                      : t(locale, 'web.match.gameNoMap', { n: game.n })
                  }</strong
                >
                ${game.score ? html` <span class="score">${game.score.a} – ${game.score.b}</span>` : ''}
                ${
                  game.bans.length > 0
                    ? html`<p class="muted">
                        ${t(locale, 'web.match.bans', {
                          list: game.bans
                            .map((ban) =>
                              t(locale, 'web.match.ban', { map: ban.map, team: ban.team }),
                            )
                            .join(', '),
                        })}
                      </p>`
                    : ''
                }
                ${boards.get(game.n) ?? ''}
              </div>`,
          )
        : html`<p class="muted">${t(locale, 'web.match.noGames')}</p>`
    }`;
  return pageOf(title, body);
}
