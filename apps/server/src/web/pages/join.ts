import type { PlayerGap } from '@ligo/core';
import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { JoinState, JoinViewReply } from '../../services/joining.ts';
import { csrfField, pageOf, type Html, type Page } from '../layout.ts';

type JoinData = Extract<JoinViewReply, { ok: true }>;

const GAP_KEYS = {
  game_account: 'web.join.gap.game_account',
  nationality: 'web.join.gap.nationality',
  stats_consent: 'web.join.gap.stats_consent',
  birth_date: 'web.join.gap.birth_date',
} as const satisfies Record<Exclude<PlayerGap, 'too_young'>, MessageKey>;

const REFUSED_KEYS = {
  lineup_locked: 'web.join.refused.lineup_locked',
  roster_full: 'web.join.refused.roster_full',
  in_other_registration: 'web.join.refused.in_other_registration',
} as const satisfies Record<Extract<JoinState, { kind: 'refused' }>['error'], MessageKey>;

/** A calendar date (`YYYY-MM-DD`), written out: "4 janvier 2027". */
function longDate(locale: Locale, date: string): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(Date.parse(`${date}T00:00:00Z`));
}

function stateView(locale: Locale, data: JoinData, form: { action: string; csrf: string }): Html {
  const { state, registration } = data;
  const reload = html`<p class="muted">${t(locale, 'web.join.reload')}</p>`;
  switch (state.kind) {
    case 'joined':
      return html`<p class="card flash">
        ${t(locale, 'web.join.joined', {
          role: t(
            locale,
            state.role === 'player' ? 'web.registration.starter' : 'web.registration.sub',
          ),
        })}
        <a href="/me">${t(locale, 'web.join.myPage')}</a>
      </p>`;
    case 'can_join':
      return html`<form method="post" action="${form.action}">
        ${csrfField(form.csrf)}
        <p class="muted">${t(locale, 'web.join.shared')}</p>
        <button type="submit">
          ${t(locale, 'web.join.submit', { roster: registration.roster.name })}
        </button>
      </form>`;
    case 'refused':
      return html`<p class="card flash error">${t(locale, REFUSED_KEYS[state.error])}</p>`;
    case 'not_eligible': {
      const missing = state.gaps.filter((gap) => gap !== 'too_young');
      return html`<div class="card flash error">
          ${
            missing.length > 0
              ? html`<p>${t(locale, 'web.join.complete')}</p>
                  <ul>
                    ${missing.map((gap) => html`<li>${t(locale, GAP_KEYS[gap])}</li>`)}
                  </ul>
                  <p>
                    <a href="/me" target="_blank" rel="noopener"
                      >${t(locale, 'web.join.openMyPage')}</a
                    >
                  </p>`
              : ''
          }
          ${
            state.gaps.includes('too_young')
              ? html`<p>
                  ${t(locale, 'web.join.tooYoung', {
                    age: state.minAge ?? 0,
                    date: longDate(locale, state.seasonStartsOn),
                  })}
                </p>`
              : ''
          }
        </div>
        ${missing.length > 0 ? reload : ''}`;
    }
    case 'not_member':
      return html`<div class="card flash error">
          <p>${t(locale, 'web.join.notMember')}</p>
          ${
            state.inviteUrl
              ? html`<p>
                  <a href="${state.inviteUrl}" rel="noopener noreferrer"
                    >${t(locale, 'web.join.joinServer')}</a
                  >
                </p>`
              : ''
          }
        </div>
        ${reload}`;
    case 'discord_unavailable':
      return html`<p class="card flash error">${t(locale, 'web.join.discordUnavailable')}</p>`;
  }
}

/** `/join/:id/:token`: the registration, and what the player can do about it. */
export function joinPageView(
  locale: Locale,
  data: JoinData,
  form: { action: string; csrf: string },
): Page {
  const { registration } = data;
  const title = t(locale, 'web.join.title', { roster: registration.roster.name });
  const body = html`<h1>${title}</h1>
    <p>
      ${t(locale, 'web.join.intro', {
        filer: registration.filer,
        roster: registration.roster.name,
        tag: registration.roster.tag,
        club: registration.club,
        competition: registration.competition,
        season: registration.season,
      })}
    </p>
    ${stateView(locale, data, form)}`;
  return pageOf(title, body);
}
