import type { FieldErrors } from '@ligo/core';
import type { Title } from '@ligo/titles';
import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { ClubFieldError, RosterFieldError } from '../../services/clubs.ts';
import { csrfField, pageOf, type Html, type Page } from '../layout.ts';
import { clubFields, rosterFields, type RegisterValues } from './register.ts';

// `/clubs/new` and `/clubs/:slug/rosters/new` (M-33): a club and its rosters, in no competition.
// Each roster registers for a league afterwards.

export type ClubValues = Pick<
  RegisterValues,
  | 'clubName'
  | 'clubCity'
  | 'clubLegalStatus'
  | 'clubSocials'
  | 'clubDiscord'
  | 'rosterName'
  | 'tag'
  | 'colors'
  | 'canStream'
> & { orgId: string; title: string };

export const EMPTY_CLUB_VALUES: ClubValues = {
  orgId: '',
  title: '',
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

type CreationError = ClubFieldError | RosterFieldError;

const errorKey = (error: CreationError): MessageKey => `web.register.error.${error}`;

function errorView(locale: Locale, errors: FieldErrors<CreationError>) {
  return (...fields: string[]): Html | string => {
    const found = errors.filter((entry) => fields.includes(entry.field));
    return found.length === 0
      ? ''
      : html`<p class="field-error">
          ${found.map((entry) => t(locale, errorKey(entry.error))).join(' ')}
        </p>`;
  };
}

const TITLE_KEYS = {
  r6: 'title.r6',
  valorant: 'title.valorant',
  rocket_league: 'title.rocket_league',
  lol: 'title.lol',
  cs: 'title.cs',
} as const satisfies Record<Title, MessageKey>;

/** The game a roster plays: a choice only when the group runs more than one. */
function titleField(
  locale: Locale,
  titles: readonly Title[],
  value: string,
  fieldError: (...fields: string[]) => Html | string,
): Html {
  if (titles.length === 1) {
    return html`<input type="hidden" name="title" value="${titles[0] ?? ''}" />`;
  }
  return html`<label for="title">${t(locale, 'web.club.title')}</label>
    <select id="title" name="title">
      ${titles.map(
        (title) =>
          html`<option value="${title}" ${value === title ? 'selected' : ''}>
            ${t(locale, TITLE_KEYS[title])}
          </option>`,
      )}
    </select>
    ${fieldError('title')}`;
}

export function clubNewPage(
  locale: Locale,
  data: {
    groups: { id: number; name: string; titles: Title[] }[];
    values: ClubValues;
    errors: FieldErrors<CreationError>;
    csrf: string;
  },
): Page {
  const { values, errors } = data;
  const fieldError = errorView(locale, errors);
  const group = data.groups.find((entry) => String(entry.id) === values.orgId) ?? data.groups[0];
  const title = t(locale, 'web.club.new.title');
  return pageOf(
    title,
    html`<h1>${title}</h1>
      <p>${t(locale, 'web.club.new.intro')}</p>
      ${
        errors.length > 0
          ? html`<p class="card flash error">${t(locale, 'web.register.fix')}</p>`
          : ''
      }
      <form class="card stack" method="post" action="/clubs/new" enctype="multipart/form-data">
        ${csrfField(data.csrf)}
        ${
          data.groups.length === 1
            ? html`<input type="hidden" name="org" value="${String(group?.id ?? '')}" />`
            : html`<label for="org">${t(locale, 'web.club.group')}</label>
                <select id="org" name="org">
                  ${data.groups.map(
                    (entry) =>
                      html`<option
                        value="${String(entry.id)}"
                        ${entry.id === group?.id ? 'selected' : ''}
                      >
                        ${entry.name}
                      </option>`,
                  )}
                </select>
                ${fieldError('org')}`
        }
        <h2>${t(locale, 'web.register.club')}</h2>
        ${clubFields(locale, values, fieldError)}
        <h2>${t(locale, 'web.club.firstRoster')}</h2>
        ${titleField(locale, group?.titles ?? [], values.title, fieldError)}
        ${rosterFields(locale, values, fieldError)}
        <button type="submit">${t(locale, 'web.club.new.submit')}</button>
      </form>`,
  );
}

export function rosterNewPage(
  locale: Locale,
  data: {
    club: { name: string; slug: string };
    titles: Title[];
    values: ClubValues;
    errors: FieldErrors<CreationError>;
    csrf: string;
  },
): Page {
  const { values, errors } = data;
  const fieldError = errorView(locale, errors);
  const title = t(locale, 'web.club.roster.title', { club: data.club.name });
  return pageOf(
    title,
    html`<h1>${title}</h1>
      ${
        errors.length > 0
          ? html`<p class="card flash error">${t(locale, 'web.register.fix')}</p>`
          : ''
      }
      <form
        class="card stack"
        method="post"
        action="/clubs/${data.club.slug}/rosters"
        enctype="multipart/form-data"
      >
        ${csrfField(data.csrf)} ${titleField(locale, data.titles, values.title, fieldError)}
        ${rosterFields(locale, values, fieldError)}
        <button type="submit">${t(locale, 'web.club.roster.submit')}</button>
      </form>`,
  );
}
