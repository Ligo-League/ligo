import {
  ROSTER_COLORS_MAX,
  ROSTER_COLORS_MIN,
  type FieldErrors,
  type LineupGap,
  type PlayerGap,
} from '@ligo/core';
import type { R6Rank } from '@ligo/titles';
import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { SaveProfileError } from '../../services/game-profile.ts';
import type {
  RegistrationFieldError,
  RegistrationForm,
  RegistrationStatus,
} from '../../services/registrations.ts';
import { csrfField, pageOf, type Html, type Page } from '../layout.ts';

type FormData = Extract<RegistrationForm, { ok: true }>;
type StatusData = Extract<RegistrationStatus, { ok: true }>;

const LEGAL_STATUSES = ['association', 'association_1901', 'company', 'amateur'] as const;

/** A club and its roster as typed (`/clubs/new`), to fill the form again after a refusal. */
export interface RegisterValues {
  clubName: string;
  clubCity: string;
  clubLegalStatus: string;
  clubSocials: string;
  clubDiscord: string;
  rosterName: string;
  tag: string;
  /** The colours chosen, in order: 2 to 5. */
  colors: string[];
  canStream: boolean;
}

const DEFAULT_COLORS = ['#000000', '#FFFFFF'];

/**
 * One colour picker per place, up to the maximum. The first two are always sent; the others are
 * hidden and disabled (so not sent) until "add a colour" turns them on, through
 * `/static/colors.js`. Without scripts, a team keeps its first two colours.
 */
function colorPickers(locale: Locale, colors: readonly string[]): Html[] {
  return Array.from({ length: ROSTER_COLORS_MAX }, (_, index) => {
    const value = colors[index] ?? DEFAULT_COLORS[index] ?? '#808080';
    const label = t(locale, 'web.register.roster.colorN', { n: index + 1 });
    if (index < ROSTER_COLORS_MIN) {
      return html`<span class="color"
        ><input name="color_${index + 1}" type="color" value="${value}" aria-label="${label}"
      /></span>`;
    }
    const used = index < colors.length;
    return html`<span class="color" data-extra-color ${used ? '' : 'hidden'}
      ><input
        name="color_${index + 1}"
        type="color"
        value="${value}"
        aria-label="${label}"
        ${used ? '' : 'disabled'}
      /><button
        type="button"
        data-remove-color
        aria-label="${t(locale, 'web.register.roster.removeColor', { n: index + 1 })}"
      >
        ×
      </button></span
    >`;
  });
}

type FieldErrorView = (...fields: string[]) => Html | string;

/** A new club's fields: name, city, legal status, links, Discord invitation. */
export function clubFields(
  locale: Locale,
  values: Pick<
    RegisterValues,
    'clubName' | 'clubCity' | 'clubLegalStatus' | 'clubSocials' | 'clubDiscord'
  >,
  fieldError: FieldErrorView,
): Html {
  return html`<label for="club_name">${t(locale, 'web.register.club.name')}</label>
    <input id="club_name" name="club_name" type="text" maxlength="40" value="${values.clubName}" />
    <p class="muted">${t(locale, 'web.register.club.nameHint')}</p>
    ${fieldError('club.name')}
    <label for="club_city">${t(locale, 'web.register.club.city')}</label>
    <input id="club_city" name="club_city" type="text" maxlength="60" value="${values.clubCity}" />
    ${fieldError('club.city')}
    <label for="club_legal_status">${t(locale, 'web.register.club.legalStatus')}</label>
    <select id="club_legal_status" name="club_legal_status">
      <option value="">${t(locale, 'web.register.club.legalStatus.none')}</option>
      ${LEGAL_STATUSES.map(
        (status) =>
          html`<option value="${status}" ${values.clubLegalStatus === status ? 'selected' : ''}>
            ${t(locale, `web.register.legal.${status}`)}
          </option>`,
      )}
    </select>
    ${fieldError('club.legalStatus')}
    <label for="club_socials">${t(locale, 'web.register.club.socials')}</label>
    <textarea id="club_socials" name="club_socials" rows="3">${values.clubSocials}</textarea>
    <p class="muted">${t(locale, 'web.register.club.socialsHint')}</p>
    ${fieldError('club.socials')}
    <label for="club_discord">${t(locale, 'web.register.club.discord')}</label>
    <input id="club_discord" name="club_discord" type="url" value="${values.clubDiscord}" />
    ${fieldError('club.discordUrl')}`;
}

/** A roster's fields: name, tag, colours (2 to 5), logo, whether it may stream. */
export function rosterFields(
  locale: Locale,
  values: Pick<RegisterValues, 'rosterName' | 'tag' | 'colors' | 'canStream'>,
  fieldError: FieldErrorView,
): Html {
  const checked = (on: boolean) => (on ? 'checked' : '');
  return html`<label for="roster_name">${t(locale, 'web.register.roster.name')}</label>
    <input
      id="roster_name"
      name="roster_name"
      type="text"
      maxlength="40"
      required
      value="${values.rosterName}"
    />
    ${fieldError('rosterName')}
    <label for="roster_tag">${t(locale, 'web.register.roster.tag')}</label>
    <input
      id="roster_tag"
      name="roster_tag"
      type="text"
      maxlength="12"
      required
      value="${values.tag}"
    />
    <p class="muted">${t(locale, 'web.register.roster.tagHint')}</p>
    ${fieldError('tag')}
    <label>${t(locale, 'web.register.roster.colors')}</label>
    <p class="colors" data-colors>
      ${colorPickers(locale, values.colors)}
      <button type="button" data-add-color hidden>
        ${t(locale, 'web.register.roster.addColor')}
      </button>
    </p>
    <script src="/static/colors.js" defer></script>
    <p class="muted">${t(locale, 'web.register.roster.colorsHint')}</p>
    ${fieldError('colors')}
    <label for="logo">${t(locale, 'web.register.roster.logo')}</label>
    <input id="logo" name="logo" type="file" accept="image/png" />
    <p class="muted">${t(locale, 'web.register.roster.logoHint')}</p>
    ${fieldError('logo')}
    <label>
      <input type="checkbox" name="can_stream" value="1" ${checked(values.canStream)} />
      ${t(locale, 'web.register.roster.canStream')}
    </label>`;
}

/** `/c/:competition/register`: one of the member's rosters, the rulebook accepted. */
export function registerFormView(
  locale: Locale,
  form: FormData,
  state: { teamId: string; errors: FieldErrors<RegistrationFieldError>; csrf: string },
): Page {
  const { errors } = state;
  const title = t(locale, 'web.register.title', {
    competition: form.competition.name,
    season: form.season.name,
  });
  const fieldError = (...fields: string[]): Html | string => {
    const found = errors.filter((entry) => fields.includes(entry.field));
    return found.length === 0
      ? ''
      : html`<p class="field-error">
          ${found.map((entry) => t(locale, `web.register.error.${entry.error}`)).join(' ')}
        </p>`;
  };
  const { settings } = form;
  const intro = html`<p>
    ${t(locale, 'web.register.intro', { starters: settings.starters, subs: settings.subs_max })}
  </p>`;
  if (form.rosters.length === 0) {
    return pageOf(
      title,
      html`<h1>${title}</h1>
        ${intro}
        <p class="card flash">${t(locale, 'web.register.noRoster')}</p>
        <p><a href="/clubs/new">${t(locale, 'web.me.createClub')}</a></p>`,
    );
  }
  const body = html`<h1>${title}</h1>
    ${intro}
    ${
      errors.length > 0
        ? html`<p class="card flash error">${t(locale, 'web.register.fix')}</p>`
        : ''
    }
    <form class="card stack" method="post" action="/c/${form.competition.slug}/register">
      ${csrfField(state.csrf)}
      <input type="hidden" name="rules_version" value="${String(form.rules.id)}" />
      <label for="team">${t(locale, 'web.register.roster')}</label>
      <select id="team" name="team" required>
        ${form.rosters.map(
          (roster) =>
            html`<option
              value="${String(roster.teamId)}"
              ${state.teamId === String(roster.teamId) ? 'selected' : ''}
            >
              ${t(locale, 'web.register.rosterOption', {
                name: roster.name,
                tag: roster.tag,
                players: roster.players,
              })}
            </option>`,
        )}
      </select>
      <p class="muted">${t(locale, 'web.register.rosterHint')}</p>
      ${fieldError('roster')}
      <h2>${t(locale, 'web.register.rules')}</h2>
      <p>
        <a href="/c/${form.competition.slug}/rules" target="_blank" rel="noopener"
          >${t(locale, 'web.register.rules.read', { version: form.rules.version })}</a
        >
      </p>
      <label>
        <input type="checkbox" name="rules_accepted" value="1" required />
        ${t(locale, 'web.register.rules.accept', { version: form.rules.version })}
      </label>
      ${fieldError('rules')}
      <p class="muted">${t(locale, 'web.register.next')}</p>
      <button type="submit">${t(locale, 'web.register.submit')}</button>
    </form>`;
  return pageOf(title, body);
}

/** What a lineup still lacks, one line each. */
export function lineupGapList(locale: Locale, gaps: readonly LineupGap[]): Html {
  return html`<ul>
    ${gaps.map((gap) => {
      const values: Record<string, number> =
        gap.gap === 'not_ready' ? { count: gap.playerIds.length } : { ...gap, gap: 0 };
      return html`<li>${t(locale, GAP_KEYS[gap.gap], values)}</li>`;
    })}
  </ul>`;
}

const GAP_KEYS = {
  starters: 'web.registration.gap.starters',
  subs: 'web.registration.gap.subs',
  captain: 'web.registration.gap.captain',
  captain_not_starter: 'web.registration.gap.captainNotStarter',
  not_ready: 'web.registration.gap.not_ready',
} as const satisfies Record<LineupGap['gap'], MessageKey>;

const PLAYER_GAP_KEYS = {
  game_account: 'web.join.gap.game_account',
  nationality: 'web.join.gap.nationality',
  stats_consent: 'web.join.gap.stats_consent',
  birth_date: 'web.join.gap.birth_date',
  too_young: 'web.registration.tooYoung',
} as const satisfies Record<PlayerGap, MessageKey>;

/** `/registrations/:id`: the filer follows the registration and picks its lineup. */
export function registrationView(
  locale: Locale,
  data: StatusData,
  options: {
    timeZone: string;
    csrf: string;
    /** The lineup's players not on the league's Discord server; null when Discord cannot say. */
    notOnServer: number[] | null;
    /** The league's public invitation to its Discord server, when it has one. */
    serverInvite: string | null;
    /** What the last action did, from the address it sent back to. */
    flash: { error: boolean; key: MessageKey } | null;
  },
): Page {
  const title = t(locale, 'web.registration.title', { roster: data.roster.name });
  const waiting = data.status === 'pending';
  // While the lineup is open, the filer changes it; otherwise the page only shows it.
  const open = waiting && !data.locked;
  const base = `/registrations/${String(data.id)}`;
  const date = (at: number) =>
    new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: options.timeZone,
    }).format(at);
  const offServer = new Set(options.notOnServer ?? []);
  const body = html`<h1>${title}</h1>
    ${
      options.flash
        ? html`<p class="card flash${options.flash.error ? ' error' : ''}">
            ${t(locale, options.flash.key)}
          </p>`
        : ''
    }
    ${outcome()}
    ${
      waiting && data.locked
        ? html`<p class="card flash error">${t(locale, 'web.registration.locked')}</p>`
        : ''
    }
    <p class="card flash">
      ${t(locale, 'web.registration.filed', {
        competition: data.competition.name,
        season: data.season,
        date: date(data.requestedAt),
      })}
    </p>
    <dl class="card facts">
      <dt>${t(locale, 'web.registration.club')}</dt>
      <dd>${data.club}</dd>
      <dt>${t(locale, 'web.registration.roster')}</dt>
      <dd>
        ${
          data.roster.slug
            ? html`<a href="/teams/${data.roster.slug}">${data.roster.name}</a>`
            : data.roster.name
        }
      </dd>
      <dt>${t(locale, 'web.registration.rules')}</dt>
      <dd>${t(locale, 'web.registration.rulesAccepted', { version: data.rulesVersion })}</dd>
    </dl>
    <h2>${t(locale, 'web.registration.players')}</h2>
    ${open && data.roster.slug ? pickForm() : playerList()} ${serverNote()} ${lineupView()}
    ${waiting ? withdrawForm(locale, base, options.csrf) : ''}`;
  return pageOf(title, body);

  function outcome(): Html | string {
    const { decision } = data;
    if (data.status === 'approved' && decision.team) {
      return html`<p class="card flash">
        ${t(locale, 'web.registration.approved', { division: decision.division ?? '?' })}
        <a href="/teams/${decision.team.slug}">${decision.team.name}</a>
      </p>`;
    }
    if (data.status === 'rejected') {
      return html`<div class="card flash error">
        <p>${t(locale, 'web.registration.rejected')}</p>
        <blockquote>${decision.reason ?? ''}</blockquote>
      </div>`;
    }
    if (data.status === 'withdrawn') {
      return html`<p class="card flash error">${t(locale, 'web.registration.withdrawn')}</p>`;
    }
    return '';
  }

  /** Players not on the league's server cannot be approved (M-30): they are told where it is. */
  function serverNote(): Html | string {
    if (!waiting) return '';
    if (options.notOnServer === null) {
      return html`<p class="muted">${t(locale, 'web.join.discordUnavailable')}</p>`;
    }
    if (options.notOnServer.length === 0) return '';
    return html`<div class="card flash error">
      <p>${t(locale, 'web.registration.notOnServer', { count: options.notOnServer.length })}</p>
      ${
        options.serverInvite
          ? html`<p>
              <a href="${options.serverInvite}" rel="noopener noreferrer"
                >${t(locale, 'web.join.joinServer')}</a
              >
            </p>`
          : ''
      }
    </div>`;
  }

  /** The roster's players, each to pick as a starter or a substitute, and the captain. */
  function pickForm(): Html {
    if (data.candidates.length === 0) {
      return html`<p class="card flash">
        ${t(locale, 'web.registration.noRosterPlayers')}
        <a href="/teams/${data.roster.slug ?? ''}/manage#players"
          >${t(locale, 'web.registration.invitePlayers')}</a
        >
      </p>`;
    }
    return html`<form method="post" action="${base}/lineup">
      ${csrfField(options.csrf)}
      <table class="card lineup">
        <thead>
          <tr>
            <th>${t(locale, 'web.registration.lineup.player')}</th>
            <th>${t(locale, 'web.registration.lineup.role')}</th>
            <th>${t(locale, 'web.registration.captain')}</th>
          </tr>
        </thead>
        <tbody>
          ${data.candidates.map((entry) => {
            const notes = [
              ...entry.gaps.map((gap) => t(locale, PLAYER_GAP_KEYS[gap])),
              ...(entry.unavailable ? [t(locale, 'web.registration.unavailable')] : []),
              ...(offServer.has(entry.playerId) ? [t(locale, 'web.registration.offServer')] : []),
            ];
            return html`<tr>
              <td>
                ${entry.name}
                ${
                  notes.length > 0
                    ? html`<span class="muted"
                        >· ${t(locale, 'web.registration.notReady')} : ${notes.join(', ')}</span
                      >`
                    : ''
                }
              </td>
              <td>
                <select
                  name="role_${entry.playerId}"
                  aria-label="${t(locale, 'web.registration.lineup.roleOf', { name: entry.name })}"
                  ${entry.unavailable && entry.role === null ? 'disabled' : ''}
                >
                  <option value="" ${entry.role === null ? 'selected' : ''}>
                    ${t(locale, 'web.registration.lineup.out')}
                  </option>
                  <option value="player" ${entry.role === 'player' ? 'selected' : ''}>
                    ${t(locale, 'web.registration.starter')}
                  </option>
                  <option value="sub" ${entry.role === 'sub' ? 'selected' : ''}>
                    ${t(locale, 'web.registration.sub')}
                  </option>
                </select>
              </td>
              <td>
                <input
                  type="radio"
                  name="captain"
                  value="${entry.playerId}"
                  ${entry.captain ? 'checked' : ''}
                  aria-label="${t(locale, 'web.registration.lineup.captainOf', { name: entry.name })}"
                />
              </td>
            </tr>`;
          })}
        </tbody>
      </table>
      <p class="muted">${t(locale, 'web.registration.lineup.hint')}</p>
      <button type="submit">${t(locale, 'web.registration.lineup.save')}</button>
    </form>`;
  }

  function playerList(): Html {
    return html`${
      data.players.length > 0
        ? html`<ul class="card">
            ${data.players.map(
              (entry) =>
                html`<li>
                  ${entry.name}
                  <span class="muted">
                    ·
                    ${t(locale, entry.role === 'player' ? 'web.registration.starter' : 'web.registration.sub')}
                    ${entry.captain ? html`· ${t(locale, 'web.registration.captain')}` : ''}
                    ${entry.ready ? '' : html`· ${t(locale, 'web.registration.notReady')}`}
                  </span>
                </li>`,
            )}
          </ul>`
        : html`<p class="muted">${t(locale, 'web.registration.noPlayers')}</p>`
    }`;
  }

  function lineupView(): Html {
    return html`${
      data.lineup.complete
        ? html`<p class="card flash">${t(locale, 'web.registration.complete')}</p>`
        : html`<div class="card flash error">
            <p>${t(locale, 'web.registration.missing')}</p>
            <ul>
              ${data.lineup.gaps.map((gap) => {
                const values: Record<string, number> =
                  gap.gap === 'not_ready' ? { count: gap.playerIds.length } : { ...gap, gap: 0 };
                return html`<li>${t(locale, GAP_KEYS[gap.gap], values)}</li>`;
              })}
            </ul>
          </div>`
    }`;
  }
}

/** Withdrawing the registration, with a box to tick first. */
function withdrawForm(locale: Locale, base: string, csrf: string): Html {
  return html`<h2>${t(locale, 'web.registration.withdraw')}</h2>
    <form class="card" method="post" action="${base}/withdraw">
      ${csrfField(csrf)}
      <p>${t(locale, 'web.registration.withdrawHint')}</p>
      <label
        ><input type="checkbox" name="confirm" value="1" /> ${t(
          locale,
          'web.registration.withdrawConfirm',
        )}</label
      >
      <button type="submit">${t(locale, 'web.registration.withdraw')}</button>
    </form>`;
}

/** The game profile part of `/me`: the player's R6 account, declared and kept by them. */
export function gameProfileForm(
  locale: Locale,
  state: {
    values: { ubisoftName: string; profileId: string; rank: string };
    ranks: readonly R6Rank[];
    verified: boolean;
    errors: FieldErrors<SaveProfileError>;
    csrf: string;
  },
): Html {
  const { values } = state;
  const fieldError = (field: string): Html | string => {
    const found = state.errors.filter((entry) => entry.field === field);
    return found.length === 0
      ? ''
      : html`<p class="field-error">
          ${found.map((entry) => t(locale, `web.me.game.error.${entry.error}`)).join(' ')}
        </p>`;
  };
  return html`<form class="card stack" method="post" action="/me/game-profile">
    ${csrfField(state.csrf)}
    <label for="ubisoft_name">${t(locale, 'web.me.game.name')}</label>
    <input
      id="ubisoft_name"
      name="ubisoft_name"
      type="text"
      maxlength="20"
      required
      value="${values.ubisoftName}"
    />
    ${fieldError('ubisoftName')}
    <label for="profile_id">${t(locale, 'web.me.game.profileId')}</label>
    <input
      id="profile_id"
      name="profile_id"
      type="text"
      maxlength="36"
      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
      value="${values.profileId}"
      ${state.verified ? 'readonly' : ''}
    />
    <p class="muted">
      ${t(locale, state.verified ? 'web.me.game.verified' : 'web.me.game.profileIdHint')}
    </p>
    ${fieldError('profileId')}
    <label for="rank">${t(locale, 'web.me.game.rank')}</label>
    <select id="rank" name="rank" required>
      <option value="">${t(locale, 'web.me.game.rank.choose')}</option>
      ${state.ranks.map(
        (rank) =>
          html`<option value="${rank}" ${values.rank === rank ? 'selected' : ''}>
            ${t(locale, `rank.r6.${rank}`)}
          </option>`,
      )}
    </select>
    <p class="muted">${t(locale, 'web.me.game.rankHint')}</p>
    ${fieldError('rank')}
    <button type="submit">${t(locale, 'web.me.save')}</button>
  </form>`;
}
