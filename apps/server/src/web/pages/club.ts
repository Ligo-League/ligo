import { html } from 'hono/html';
import { t, type Locale } from '../../i18n/index.ts';
import type { ClubPage } from '../../services/site.ts';
import { pageOf, type Page } from '../layout.ts';
import { identityHead } from './team.ts';

type Data = Extract<ClubPage, { ok: true }>;

/** `/clubs/:slug`: the club and its rosters, with where each plays. */
export function clubPageView(locale: Locale, page: Data): Page {
  const { club } = page;
  const body = html`${identityHead(club.name, club)}
    ${club.city ? html`<p class="muted">${club.city}</p>` : ''}
    <h2>${t(locale, 'web.club.rosters')}</h2>
    <ul class="card">
      ${page.rosters.map(
        (roster) =>
          html`<li>
            <a href="/teams/${roster.slug}">${roster.name}</a>
            <span class="muted">(${roster.tag})</span> ·
            ${
              roster.place
                ? html`<a href="${roster.place.competition.path}/${roster.place.season.slug}"
                    >${t(locale, 'web.team.season', {
                      competition: roster.place.competition.name,
                      season: roster.place.season.name,
                      division: roster.place.division,
                    })}</a
                  >`
                : html`<span class="muted">${t(locale, 'web.club.noSeason')}</span>`
            }
          </li>`,
      )}
    </ul>`;
  return pageOf(club.name, body);
}
