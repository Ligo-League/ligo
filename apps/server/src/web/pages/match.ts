import { html } from 'hono/html';
import { t, type Locale } from '../../i18n/index.ts';
import type { MatchPage } from '../../services/site.ts';
import { formatWhen, matchOutcome, pageOf, type Html, type Page } from '../layout.ts';

type Data = Extract<MatchPage, { ok: true }>;

/**
 * `/matches/:id`: the teams, the time or the result, and each game's map and bans. `panel` is
 * what the viewer's own team may do in the match, when they act for a side.
 */
export function matchPageView(locale: Locale, page: Data, panel: Html | string = ''): Page {
  const { match, league } = page;
  const { timeZone } = league.competition;
  const title = t(locale, 'web.match.title', { a: match.a.name, b: match.b.name });
  const when = match.scheduledAt === null ? null : formatWhen(locale, match.scheduledAt, timeZone);
  const body = html`<p class="muted">
      <a href="/c/${league.competition.slug}/${league.season.slug}"
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
    ${page.host ? html`<p>${t(locale, 'web.match.host', { team: page.host })}</p>` : ''} ${panel}
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
              </div>`,
          )
        : html`<p class="muted">${t(locale, 'web.match.noGames')}</p>`
    }`;
  return pageOf(title, body);
}
