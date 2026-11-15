import { ROSTER_COLORS_MAX, ROSTER_COLORS_MIN, type FieldErrors, type LineupGap } from '@ligo/core';
import type { R6Rank } from '@ligo/titles';
import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { SaveProfileError } from '../../services/game-profile.ts';
import type {
  RegistrationFieldError,
  RegistrationForm,
  RegistrationStatus,
} from '../../services/registrations.ts';
import { csrfField, pageOf, safeColor, type Html, type Page } from '../layout.ts';

type FormData = Extract<RegistrationForm, { ok: true }>;
type StatusData = Extract<RegistrationStatus, { ok: true }>;

const LEGAL_STATUSES = ['association', 'association_1901', 'company', 'amateur'] as const;

/** What the member typed, to fill the form again after a refusal. The logo cannot be refilled. */
export interface RegisterValues {
  clubKind: 'new' | 'existing';
  clubId: string;
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

export const EMPTY_REGISTER_VALUES: RegisterValues = {
  clubKind: 'new',
  clubId: '',
  clubName: '',
  clubCity: '',
  clubLegalStatus: '',
  clubSocials: '',
  clubDiscord: '',
  rosterName: '',
  tag: '',
  colors: ['#000000', '#FFFFFF'],
  canStream: false,
};

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

const errorKey = (error: RegistrationFieldError): MessageKey => `web.register.error.${error}`;

/** `/c/:competition/register`: the club, the roster, the rulebook accepted. */
export function registerFormView(
  locale: Locale,
  form: FormData,
  state: { values: RegisterValues; errors: FieldErrors<RegistrationFieldError>; csrf: string },
): Page {
  const { values, errors } = state;
  const title = t(locale, 'web.register.title', {
    competition: form.competition.name,
    season: form.season.name,
  });
  const fieldError = (...fields: string[]): Html | string => {
    const found = errors.filter((entry) => fields.includes(entry.field));
    return found.length === 0
      ? ''
      : html`<p class="field-error">
          ${found.map((entry) => t(locale, errorKey(entry.error))).join(' ')}
        </p>`;
  };
  const checked = (on: boolean) => (on ? 'checked' : '');
  const { settings } = form;

  const body = html`<h1>${title}</h1>
    <p>
      ${t(locale, 'web.register.intro', {
        starters: settings.starters,
        subs: settings.subs_max,
      })}
    </p>
    ${
      errors.length > 0
        ? html`<p class="card flash error">${t(locale, 'web.register.fix')}</p>`
        : ''
    }
    <form
      class="card stack"
      method="post"
      action="/c/${form.competition.slug}/register"
      enctype="multipart/form-data"
    >
      ${csrfField(state.csrf)}
      <input type="hidden" name="rules_version" value="${String(form.rules.id)}" />
      <h2>${t(locale, 'web.register.club')}</h2>
      ${
        form.clubs.length > 0
          ? html`<label>
                <input
                  type="radio"
                  name="club_kind"
                  value="existing"
                  ${checked(values.clubKind === 'existing')}
                />
                ${t(locale, 'web.register.club.existing')}
              </label>
              <select name="club_id" aria-label="${t(locale, 'web.register.club.existing')}">
                ${form.clubs.map(
                  (entry) =>
                    html`<option
                      value="${String(entry.id)}"
                      ${values.clubId === String(entry.id) ? 'selected' : ''}
                    >
                      ${entry.name}
                    </option>`,
                )}
              </select>
              ${fieldError('club.clubId')}
              <label>
                <input
                  type="radio"
                  name="club_kind"
                  value="new"
                  ${checked(values.clubKind === 'new')}
                />
                ${t(locale, 'web.register.club.new')}
              </label>`
          : html`<input type="hidden" name="club_kind" value="new" />`
      }
      <label for="club_name">${t(locale, 'web.register.club.name')}</label>
      <input
        id="club_name"
        name="club_name"
        type="text"
        maxlength="40"
        value="${values.clubName}"
      />
      <p class="muted">${t(locale, 'web.register.club.nameHint')}</p>
      ${fieldError('club.name')}
      <label for="club_city">${t(locale, 'web.register.club.city')}</label>
      <input
        id="club_city"
        name="club_city"
        type="text"
        maxlength="60"
        value="${values.clubCity}"
      />
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
      ${fieldError('club.discordUrl')}

      <h2>${t(locale, 'web.register.roster')}</h2>
      <label for="roster_name">${t(locale, 'web.register.roster.name')}</label>
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
      </label>

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

const GAP_KEYS = {
  starters: 'web.registration.gap.starters',
  subs: 'web.registration.gap.subs',
  captain: 'web.registration.gap.captain',
  captain_not_starter: 'web.registration.gap.captainNotStarter',
  not_ready: 'web.registration.gap.not_ready',
} as const satisfies Record<LineupGap['gap'], MessageKey>;

/** `/registrations/:id`: the filer follows the registration and shares the invitation. */
export function registrationView(
  locale: Locale,
  data: StatusData,
  options: {
    inviteUrl: string | null;
    timeZone: string;
    csrf: string;
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
  const body = html`<h1>${title}</h1>
    ${
      options.flash
        ? html`<p class="card flash${options.flash.error ? ' error' : ''}">
            ${t(locale, options.flash.key)}
          </p>`
        : ''
    }
    ${
      waiting
        ? ''
        : html`<p class="card flash error">${t(locale, 'web.registration.withdrawn')}</p>`
    }
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
      <dd>
        ${data.club.name}
        ${data.club.existing ? '' : html`<span class="muted">(${t(locale, 'web.registration.newClub')})</span>`}
      </dd>
      <dt>${t(locale, 'web.registration.roster')}</dt>
      <dd>
        ${data.roster.name} <span class="muted">[${data.roster.tag}]</span>
        <span class="swatches">
          ${data.roster.colors.map((color) => {
            const safe = safeColor(color);
            return safe ? html`<span style="background:${safe}"></span>` : '';
          })}
        </span>
      </dd>
      <dt>${t(locale, 'web.registration.logo')}</dt>
      <dd>
        ${t(locale, data.roster.hasLogo ? 'web.registration.logo.yes' : 'web.registration.logo.no')}
      </dd>
      <dt>${t(locale, 'web.registration.rules')}</dt>
      <dd>${t(locale, 'web.registration.rulesAccepted', { version: data.rulesVersion })}</dd>
    </dl>
    ${open ? inviteSection() : ''}
    <h2>${t(locale, 'web.registration.players')}</h2>
    ${open && data.players.length > 0 ? lineupForm(locale, data, base, options.csrf) : playerList()}
    ${lineupView()} ${waiting ? withdrawForm(locale, base, options.csrf) : ''}`;
  return pageOf(title, body);

  function inviteSection(): Html {
    return html`<h2>${t(locale, 'web.registration.invite')}</h2>
      ${
        data.invite && options.inviteUrl
          ? html`<div class="card">
              <p>${t(locale, 'web.registration.inviteHint')}</p>
              <p>
                <input
                  class="copy"
                  type="text"
                  readonly
                  value="${options.inviteUrl}"
                  aria-label="${t(locale, 'web.registration.invite')}"
                />
              </p>
              <p class="muted">
                ${t(
                  locale,
                  data.invite.active
                    ? 'web.registration.inviteUntil'
                    : 'web.registration.inviteExpired',
                  { date: date(data.invite.expiresAt) },
                )}
              </p>
            </div>`
          : html`<p class="muted">${t(locale, 'web.registration.noInvite')}</p>`
      }
      <form method="post" action="${base}/invite">
        ${csrfField(options.csrf)}
        <button type="submit">${t(locale, 'web.registration.newInvite')}</button>
        <span class="muted">${t(locale, 'web.registration.newInviteHint')}</span>
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

/** The lineup as the filer sets it: each player's role and the captain, or a player removed. */
function lineupForm(locale: Locale, data: StatusData, base: string, csrf: string): Html {
  return html`<form method="post" action="${base}/lineup">
    ${csrfField(csrf)}
    <table class="card lineup">
      <thead>
        <tr>
          <th>${t(locale, 'web.registration.lineup.player')}</th>
          <th>${t(locale, 'web.registration.lineup.role')}</th>
          <th>${t(locale, 'web.registration.captain')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${data.players.map(
          (entry) =>
            html`<tr>
              <td>
                ${entry.name}
                ${
                  entry.ready
                    ? ''
                    : html`<span class="muted">· ${t(locale, 'web.registration.notReady')}</span>`
                }
              </td>
              <td>
                <select
                  name="role_${entry.playerId}"
                  aria-label="${t(locale, 'web.registration.lineup.roleOf', { name: entry.name })}"
                >
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
              <td>
                <button type="submit" formaction="${base}/players/${entry.playerId}/remove">
                  ${t(locale, 'web.registration.lineup.remove')}
                </button>
              </td>
            </tr>`,
        )}
      </tbody>
    </table>
    <p class="muted">${t(locale, 'web.registration.lineup.hint')}</p>
    <button type="submit">${t(locale, 'web.registration.lineup.save')}</button>
  </form>`;
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
