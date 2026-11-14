import { html } from 'hono/html';
import { t, type Locale } from '../../i18n/index.ts';
import type { TeamPage } from '../../services/site.ts';
import { layout, matchList, safeColor, type Html } from '../layout.ts';

type Page = Extract<TeamPage, { ok: true }>;
const ROLE_KEYS = {
  owner: 'team.role.owner',
  manager: 'team.role.manager',
  coach: 'team.role.coach',
} as const;
const roleKey = (role: string) =>
  role in ROLE_KEYS ? ROLE_KEYS[role as keyof typeof ROLE_KEYS] : null;

/** `/teams/:slug`: the team, its officials, and its matches of the latest season. */
export function teamPageView(locale: Locale, page: Page): Html {
  const { team, season } = page;
  const logoName = team.logoKey?.match(/^logos\/([a-z0-9][a-z0-9_-]{0,63})\.png$/)?.[1];
  const colors = team.colors.flatMap((color) => safeColor(color) ?? []);
  const body = html`<div class="team-head">
      ${logoName ? html`<img src="/logos/${logoName}.png" alt="" />` : ''}
      <div>
        <h1>${team.name} <span class="muted">(${team.tag})</span></h1>
        ${
          colors.length > 0
            ? html`<div class="swatches">
                ${colors.map((color) => html`<span style="background: ${color}"></span>`)}
              </div>`
            : ''
        }
      </div>
    </div>
    ${
      season
        ? html`<p>
            <a href="/c/${season.competition.slug}/${season.season.slug}"
              >${t(locale, 'web.team.season', {
                competition: season.competition.name,
                season: season.season.name,
                division: season.division,
              })}</a
            >
          </p>`
        : html`<p class="muted">${t(locale, 'web.team.noSeason')}</p>`
    }
    <h2>${t(locale, 'web.team.officials')}</h2>
    ${
      page.officials.length > 0
        ? html`<ul class="card">
            ${page.officials.map((official) => {
              const key = roleKey(official.role);
              return html`<li>
                ${official.name}${key ? html` <span class="muted">· ${t(locale, key)}</span>` : ''}
              </li>`;
            })}
          </ul>`
        : html`<p class="muted">${t(locale, 'web.team.noOfficials')}</p>`
    }
    <h2>${t(locale, 'web.team.matches')}</h2>
    ${
      page.matches.length > 0 && season
        ? html`<div class="card">
            ${matchList(locale, page.matches, season.competition.timeZone)}
          </div>`
        : html`<p class="muted">${t(locale, 'web.team.noMatches')}</p>`
    }`;
  return layout(locale, team.name, body);
}
