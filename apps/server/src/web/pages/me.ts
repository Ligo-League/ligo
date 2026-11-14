import { html } from 'hono/html';
import { t, type Locale } from '../../i18n/index.ts';
import type { Profile } from '../../services/me.ts';
import { csrfField, pageOf, type Page } from '../layout.ts';

export interface MeData {
  profile: Profile;
  staffOf: string[];
  countries: { code: string; name: string }[];
  csrf: string;
  /** What the last form did, from the address it sent back to. */
  flash: 'saved' | 'invalid_nationality' | null;
}

const ROLE_KEYS = {
  owner: 'team.role.owner',
  manager: 'team.role.manager',
  coach: 'team.role.coach',
} as const;

/** `/me`: the player's own account: teams, nationality and stats consent. */
export function mePage(locale: Locale, data: MeData): Page {
  const { player, teams } = data.profile;
  const date = (at: number) =>
    new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
      dateStyle: 'long',
      timeZone: 'Europe/Paris',
    }).format(at);
  const flash =
    data.flash === 'saved'
      ? html`<p class="card flash">${t(locale, 'web.me.saved')}</p>`
      : data.flash === 'invalid_nationality'
        ? html`<p class="card flash error">${t(locale, 'web.me.error.invalid_nationality')}</p>`
        : '';
  const body = html`<h1>${t(locale, 'web.me.title')}</h1>
    ${flash}
    <p>${t(locale, 'web.me.discord', { name: player.displayName })}</p>
    ${
      data.staffOf.length > 0
        ? html`<p>${t(locale, 'web.me.staff', { list: data.staffOf.join(', ') })}</p>`
        : ''
    }
    <h2>${t(locale, 'web.me.teams')}</h2>
    ${
      teams.length > 0
        ? html`<ul class="card">
            ${teams.map(
              (team) =>
                html`<li>
                  <a href="/teams/${team.slug}">${team.name}</a>
                  <span class="muted">· ${t(locale, ROLE_KEYS[team.role])}</span>
                </li>`,
            )}
          </ul>`
        : html`<p class="muted">${t(locale, 'web.me.noTeams')}</p>`
    }
    <h2>${t(locale, 'web.me.nationality')}</h2>
    <form class="card" method="post" action="/me/nationality">
      ${csrfField(data.csrf)}
      <label for="nationality">${t(locale, 'web.me.nationality')}</label>
      <select id="nationality" name="nationality">
        <option value="">${t(locale, 'web.me.nationality.none')}</option>
        ${data.countries.map(
          (country) =>
            html`<option
              value="${country.code}"
              ${country.code === player.nationality ? 'selected' : ''}
            >
              ${country.name}
            </option>`,
        )}
      </select>
      <button type="submit">${t(locale, 'web.me.save')}</button>
      <p class="muted">${t(locale, 'web.me.nationality.hint')}</p>
    </form>
    <h2>${t(locale, 'web.me.consent.title')}</h2>
    <form class="card" method="post" action="/me/consent">
      ${csrfField(data.csrf)}
      ${
        player.statsConsentAt === null
          ? html`<p>${t(locale, 'web.me.consent.none')}</p>
              <button type="submit" name="consent" value="give">
                ${t(locale, 'web.me.consent.give')}
              </button>`
          : html`<p>${t(locale, 'web.me.consent.given', { date: date(player.statsConsentAt) })}</p>
              <button type="submit" name="consent" value="withdraw">
                ${t(locale, 'web.me.consent.withdraw')}
              </button>`
      }
    </form>`;
  return pageOf(t(locale, 'web.me.title'), body);
}
