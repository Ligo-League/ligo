import { html } from 'hono/html';
import { t, type Locale } from '../../i18n/index.ts';
import type { TeamPage } from '../../services/site.ts';
import { matchList, safeColor, pageOf, type Html, type Page } from '../layout.ts';

type Data = Extract<TeamPage, { ok: true }>;
const ROLE_KEYS = {
  owner: 'team.role.owner',
  club_manager: 'team.role.club_manager',
  manager: 'team.role.manager',
  coach: 'team.role.coach',
} as const;
const roleKey = (role: string) =>
  role in ROLE_KEYS ? ROLE_KEYS[role as keyof typeof ROLE_KEYS] : null;

/** A team or club heading: its logo, its name and its colours. */
export function identityHead(
  title: Html | string,
  look: { logoKey: string | null; colors: readonly string[] },
): Html {
  const logoName = look.logoKey?.match(/^logos\/([a-z0-9][a-z0-9_-]{0,63})\.png$/)?.[1];
  const colors = look.colors.flatMap((color) => safeColor(color) ?? []);
  return html`<div class="team-head">
    ${logoName ? html`<img src="/logos/${logoName}.png" alt="" />` : ''}
    <div>
      <h1>${title}</h1>
      ${
        colors.length > 0
          ? html`<div class="swatches">
              ${colors.map((color) => html`<span style="background: ${color}"></span>`)}
            </div>`
          : ''
      }
    </div>
  </div>`;
}

/** `/teams/:slug`: the team, its club, its officials, and its matches of the latest season. */
export function teamPageView(locale: Locale, page: Data): Page {
  const { team, season } = page;
  const title = html`${team.name} <span class="muted">(${team.tag})</span>`;
  const body = html`${identityHead(title, team)}
    <p>
      ${t(locale, 'web.team.club')} <a href="/clubs/${page.club.slug}">${page.club.name}</a>
      ${
        page.siblings.length > 0
          ? html` · ${t(locale, 'web.team.siblings')}
            ${page.siblings.map(
              (sibling, index) =>
                html`${index > 0 ? ', ' : ''}<a href="/teams/${sibling.slug}">${sibling.name}</a>`,
            )}`
          : ''
      }
    </p>
    ${
      season
        ? html`<p>
            <a href="${season.competition.path}/${season.season.slug}"
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
    ${
      page.players.length > 0
        ? html`<h2>${t(locale, 'web.team.players')}</h2>
            <ul class="card">
              ${page.players.map(
                (entry) =>
                  html`<li>
                    ${entry.name}
                    <span class="muted"
                      >·
                      ${t(
                        locale,
                        entry.role === 'sub' ? 'web.registration.sub' : 'web.registration.starter',
                      )}${entry.captain ? html` · ${t(locale, 'web.registration.captain')}` : ''}</span
                    >
                  </li>`,
              )}
            </ul>`
        : ''
    }
    <h2>${t(locale, 'web.team.matches')}</h2>
    ${
      page.matches.length > 0 && season
        ? html`<div class="card">
            ${matchList(locale, page.matches, season.competition.timeZone)}
          </div>`
        : html`<p class="muted">${t(locale, 'web.team.noMatches')}</p>`
    }`;
  return pageOf(team.name, body);
}
