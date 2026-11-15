import { html } from 'hono/html';
import { t, type Locale } from '../../i18n/index.ts';
import type { RegistrationEntry, registrationsOf } from '../../services/registration-players.ts';
import type { rostersOf } from '../../services/rosters.ts';
import type { Profile } from '../../services/me.ts';
import { csrfField, pageOf, type Html, type Page } from '../layout.ts';

export const ME_ERRORS = ['invalid_nationality', 'invalid_birth_date', 'lineup_locked'] as const;
export type MeFlash = 'saved' | 'left' | 'joined' | (typeof ME_ERRORS)[number];

export interface MeData {
  profile: Profile;
  staffOf: string[];
  countries: { code: string; name: string }[];
  csrf: string;
  /** What the last form did, from the address it sent back to. */
  flash: MeFlash | null;
  /** The game account form, filled with what is stored or what was just typed. */
  game: Html;
  /** The competitions whose Discord server the player may manage. */
  adminOf: { name: string; slug: string }[];
  /** The registrations the player filed or joined, answered ones included. */
  registrations: ReturnType<typeof registrationsOf>;
  /** The rosters the player plays for, outside any season (M-33). */
  rosters: ReturnType<typeof rostersOf>;
}

const ROLE_KEYS = {
  owner: 'team.role.owner',
  club_manager: 'team.role.club_manager',
  manager: 'team.role.manager',
  coach: 'team.role.coach',
} as const;

function registrationsView(locale: Locale, data: MeData): Html | string {
  const { filed, joined } = data.registrations;
  if (filed.length === 0 && joined.length === 0) return '';
  const what = (entry: { roster: string; competition: string; season: string }) =>
    t(locale, 'web.me.registration', entry);
  const status = (entry: RegistrationEntry) =>
    html`<span class="muted">· ${t(locale, `web.me.registration.${entry.status}`)}</span>`;
  return html`<h2>${t(locale, 'web.me.registrations')}</h2>
    <ul class="card">
      ${filed.map(
        (entry) =>
          html`<li>
            <a href="/registrations/${entry.requestId}">${what(entry)}</a>
            <span class="muted">· ${t(locale, 'web.me.registration.filed')}</span>
            ${status(entry)}
          </li>`,
      )}
      ${joined.map(
        (entry) =>
          html`<li>
            ${what(entry)}
            <span class="muted"
              >·
              ${t(locale, entry.role === 'player' ? 'web.registration.starter' : 'web.registration.sub')}</span
            >
            ${status(entry)}
          </li>`,
      )}
    </ul>`;
}

/** The rosters the player plays for, each with a way to leave. */
function rostersView(locale: Locale, data: MeData): Html | string {
  if (data.rosters.length === 0) return '';
  return html`<h2>${t(locale, 'web.me.rosters')}</h2>
    <ul class="card">
      ${data.rosters.map(
        (roster) =>
          html`<li>
            <a href="/teams/${roster.slug}">${roster.name}</a>
            <form method="post" action="/teams/${roster.slug}/roster/leave" class="inline">
              ${csrfField(data.csrf)}
              <button type="submit">${t(locale, 'web.me.registration.leave')}</button>
            </form>
          </li>`,
      )}
    </ul>`;
}

/** `/me`: the player's own account: teams, nationality and stats consent. */
export function mePage(locale: Locale, data: MeData): Page {
  const { player, teams } = data.profile;
  const date = (at: number) =>
    new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
      dateStyle: 'long',
      timeZone: 'Europe/Paris',
    }).format(at);
  const flash =
    data.flash === 'saved' || data.flash === 'left' || data.flash === 'joined'
      ? html`<p class="card flash">${t(locale, `web.me.${data.flash}`)}</p>`
      : data.flash
        ? html`<p class="card flash error">${t(locale, `web.me.error.${data.flash}`)}</p>`
        : '';
  const body = html`<h1>${t(locale, 'web.me.title')}</h1>
    ${flash}
    <p>${t(locale, 'web.me.discord', { name: player.displayName })}</p>
    ${
      data.staffOf.length > 0
        ? html`<p>
            ${t(locale, 'web.me.staff', { list: data.staffOf.join(', ') })} ·
            <a href="/staff">${t(locale, 'web.me.staffQueue')}</a>
          </p>`
        : ''
    }
    ${
      data.adminOf.length > 0
        ? html`<p>
            ${t(locale, 'web.me.discordSettings')}
            ${data.adminOf.map(
              (competition, index) =>
                html`${index > 0 ? ', ' : ''}<a href="/c/${competition.slug}/discord"
                    >${competition.name}</a
                  >`,
            )}
          </p>`
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
                  · <a href="/teams/${team.slug}/manage">${t(locale, 'web.me.manage')}</a>
                </li>`,
            )}
          </ul>`
        : html`<p class="muted">${t(locale, 'web.me.noTeams')}</p>`
    }
    <p><a href="/clubs/new">${t(locale, 'web.me.createClub')}</a></p>
    ${rostersView(locale, data)} ${registrationsView(locale, data)}
    <h2>${t(locale, 'web.me.game')}</h2>
    ${data.game}
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
    <h2>${t(locale, 'web.me.birthDate')}</h2>
    <form class="card" method="post" action="/me/birth-date">
      ${csrfField(data.csrf)}
      <label for="birth_date">${t(locale, 'web.me.birthDate')}</label>
      <input
        id="birth_date"
        name="birth_date"
        type="date"
        value="${player.birthDate ?? ''}"
        min="1900-01-01"
      />
      <button type="submit">${t(locale, 'web.me.save')}</button>
      <p class="muted">${t(locale, 'web.me.birthDate.hint')}</p>
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
