import { html } from 'hono/html';
import { t, type Locale } from '../../i18n/index.ts';
import type { LeagueLinks } from '../../services/site.ts';
import { pageOf, type Page } from '../layout.ts';

/** `/`: the group's leagues and their seasons. */
export function homePage(locale: Locale, leagues: readonly LeagueLinks[]): Page {
  const body =
    leagues.length === 0
      ? html`<p class="muted">${t(locale, 'web.home.empty')}</p>`
      : leagues.map(
          ({ competition, seasons }) =>
            html`<section class="card">
              <h2>${competition.name}</h2>
              <ul>
                ${seasons.map(
                  (season) =>
                    html`<li>
                      <a href="/c/${competition.slug}/${season.slug}">${season.name}</a>
                      <span class="muted"
                        >· ${t(locale, `web.season.status.${season.status}`)}</span
                      >
                      ${
                        season.status === 'registration'
                          ? html`·
                              <a href="/c/${competition.slug}/register"
                                >${t(locale, 'web.home.register')}</a
                              >`
                          : ''
                      }
                    </li>`,
                )}
              </ul>
            </section>`,
        );
  return pageOf(
    t(locale, 'web.home.title'),
    html`<h1>${t(locale, 'web.home.title')}</h1>
      ${body}`,
  );
}
