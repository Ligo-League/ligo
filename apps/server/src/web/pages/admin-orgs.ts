import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { OrgAdminView, OrgErrors, OrgInviteProblem } from '../../services/orgs.ts';
import { csrfField, pageOf, type Html, type Page } from '../layout.ts';

// The admin panel's first pages (phase 3h; design doc section 7, M-20): `/admin` lists what the
// viewer administers, `/orgs/new` creates an organisation, `/admin/:org` is its owner's page.

export const ORG_DONE = ['created', 'saved', 'logo'] as const;
export type OrgDone = (typeof ORG_DONE)[number];

const FIELD_ERRORS = {
  length: 'web.admin.org.error.length',
  invalid: 'web.admin.org.error.invalid',
  taken: 'web.admin.org.error.taken',
  reserved: 'web.admin.org.error.reserved',
} as const satisfies Record<string, MessageKey>;

export const ORG_ERRORS = {
  no_server: 'web.admin.org.error.no_server',
  no_account: 'web.admin.org.error.no_account',
  discord_unavailable: 'web.admin.org.error.discord_unavailable',
  invite_invalid: 'web.admin.org.error.invite_invalid',
  invite_expires: 'web.admin.org.error.invite_expires',
  unknown_player: 'web.admin.org.error.unknown_player',
  same_owner: 'web.admin.org.error.same_owner',
  confirm: 'web.admin.org.error.confirm',
  // The same checks as a roster's logo, so the same messages.
  invalid_logo: 'web.register.error.invalid_logo',
  logo_too_big: 'web.register.error.logo_too_big',
  logo_not_transparent: 'web.register.error.logo_not_transparent',
  logo_dimensions: 'web.register.error.logo_dimensions',
  logo_not_stored: 'web.register.error.logo_not_stored',
} as const satisfies Record<string, MessageKey>;
export type OrgPageError = keyof typeof ORG_ERRORS;
export const isOrgPageError = (value: string | undefined): value is OrgPageError =>
  value !== undefined && Object.hasOwn(ORG_ERRORS, value);

export type OrgFlash = { done: OrgDone } | { error: OrgPageError } | null;

function flashOf(locale: Locale, flash: OrgFlash): Html | string {
  if (!flash) return '';
  return 'done' in flash
    ? html`<p class="card flash">${t(locale, `web.admin.org.done.${flash.done}`)}</p>`
    : html`<p class="card flash error">${t(locale, ORG_ERRORS[flash.error])}</p>`;
}

const fieldError = (
  locale: Locale,
  errors: OrgErrors & { inviteUrl?: 'invalid' },
  field: 'name' | 'slug' | 'locale' | 'description' | 'inviteUrl',
): Html | string => {
  const error = errors[field];
  return error ? html`<p class="field-error">${t(locale, FIELD_ERRORS[error])}</p>` : '';
};

export interface AdminHomeData {
  owned: { name: string; slug: string }[];
  staff: { name: string; path: string }[];
}

export function adminHomeView(locale: Locale, data: AdminHomeData): Page {
  const title = t(locale, 'web.admin.title');
  const list = (items: { name: string; href: string }[], empty: MessageKey) =>
    items.length === 0
      ? html`<p class="muted">${t(locale, empty)}</p>`
      : html`<ul>
          ${items.map((item) => html`<li><a href="${item.href}">${item.name}</a></li>`)}
        </ul>`;
  return pageOf(
    title,
    html`<h1>${title}</h1>
      <h2>${t(locale, 'web.admin.owned')}</h2>
      ${list(
        data.owned.map((entry) => ({ name: entry.name, href: `/admin/${entry.slug}` })),
        'web.admin.ownedNone',
      )}
      <p><a href="/orgs/new">${t(locale, 'web.admin.create')}</a></p>
      <h2>${t(locale, 'web.admin.staff')}</h2>
      ${list(
        data.staff.map((entry) => ({ name: entry.name, href: `${entry.path}/discord/channels` })),
        'web.admin.staffNone',
      )}`,
  );
}

export interface OrgNewData {
  values: { name: string; slug: string; locale: string; description: string };
  errors: OrgErrors;
  /** Whether the viewer may manage a Discord server where the bot is; null if Discord did not say. */
  managesAServer: boolean | null;
  botInstallUrl: string | null;
  csrf: string;
}

const localeOptions = (locale: Locale, value: string) =>
  (['fr', 'en'] as const).map(
    (entry) =>
      html`<option value="${entry}" ${value === entry ? 'selected' : ''}>
        ${t(locale, `web.admin.org.locale.${entry}`)}
      </option>`,
  );

export function orgNewView(locale: Locale, data: OrgNewData): Page {
  const title = t(locale, 'web.admin.org.newTitle');
  const { values, errors } = data;
  const blocked =
    data.managesAServer === false
      ? html`<p class="card flash error">
          ${t(locale, 'web.admin.org.error.no_server')}
          ${
            data.botInstallUrl
              ? html` <a href="${data.botInstallUrl}">${t(locale, 'web.admin.org.install')}</a>`
              : ''
          }
        </p>`
      : data.managesAServer === null
        ? html`<p class="card flash error">${t(locale, ORG_ERRORS.discord_unavailable)}</p>`
        : '';
  const form = errors.form
    ? html`<p class="card flash error">${t(locale, ORG_ERRORS[errors.form])}</p>`
    : '';
  return pageOf(
    title,
    html`<p><a href="/admin">${t(locale, 'web.admin.title')}</a></p>
      <h1>${title}</h1>
      <p class="muted">${t(locale, 'web.admin.org.newIntro')}</p>
      ${blocked} ${form}
      <form class="card stack" method="post" action="/orgs/new">
        ${csrfField(data.csrf)}
        <label
          >${t(locale, 'web.admin.org.name')}
          <input name="name" value="${values.name}" maxlength="60" required
        /></label>
        ${fieldError(locale, errors, 'name')}
        <label
          >${t(locale, 'web.admin.org.slug')}
          <input name="slug" value="${values.slug}" maxlength="40" pattern="[a-z0-9-]*"
        /></label>
        <p class="muted">${t(locale, 'web.admin.org.slugHelp')}</p>
        ${fieldError(locale, errors, 'slug')}
        <label
          >${t(locale, 'web.admin.org.locale')}
          <select name="locale">
            ${localeOptions(locale, values.locale)}
          </select></label
        >
        ${fieldError(locale, errors, 'locale')}
        <label
          >${t(locale, 'web.admin.org.description')}
          <textarea name="description" maxlength="500" rows="3">${values.description}</textarea>
        </label>
        ${fieldError(locale, errors, 'description')}
        <button type="submit">${t(locale, 'web.admin.org.createButton')}</button>
      </form>`,
  );
}

export interface OrgPageData {
  view: Extract<OrgAdminView, { ok: true }>;
  /** A refused change: what was typed, and why. */
  typed: {
    values: { name: string; locale: string; description: string; inviteUrl: string };
    errors: OrgErrors & { inviteUrl?: 'invalid' };
  } | null;
  flash: OrgFlash;
  csrf: string;
}

export function orgPageView(locale: Locale, data: OrgPageData): Page {
  const { view } = data;
  const { org } = view;
  const base = `/admin/${org.slug}`;
  const values = data.typed?.values ?? {
    name: org.name,
    locale: org.locale,
    description: org.description ?? '',
    inviteUrl: org.inviteUrl ?? '',
  };
  const errors = data.typed?.errors ?? {};
  return pageOf(
    org.name,
    html`<p><a href="/admin">${t(locale, 'web.admin.title')}</a></p>
      <h1>${org.name}</h1>
      <p class="muted">
        ${t(locale, 'web.admin.org.owner', {
          name: view.owner.name ?? view.owner.discordUserId,
        })}
      </p>
      ${flashOf(locale, data.flash)}
      <h2>${t(locale, 'web.admin.org.competitions')}</h2>
      ${
        view.competitions.length === 0
          ? html`<p class="muted">${t(locale, 'web.admin.org.noCompetitions')}</p>`
          : html`<ul>
              ${view.competitions.map(
                (entry) =>
                  html`<li>
                    <a href="/${org.slug}/${entry.slug}">${entry.name}</a> ·
                    <a href="/${org.slug}/${entry.slug}/discord"
                      >${t(locale, 'web.admin.org.discord')}</a
                    >
                  </li>`,
              )}
            </ul>`
      }
      <h2>${t(locale, 'web.admin.org.settings')}</h2>
      <form class="card stack" method="post" action="${base}">
        ${csrfField(data.csrf)}
        <label
          >${t(locale, 'web.admin.org.name')}
          <input name="name" value="${values.name}" maxlength="60" required
        /></label>
        ${fieldError(locale, errors, 'name')}
        <p class="muted">${t(locale, 'web.admin.org.slugFixed', { slug: org.slug })}</p>
        <label
          >${t(locale, 'web.admin.org.locale')}
          <select name="locale">
            ${localeOptions(locale, values.locale)}
          </select></label
        >
        <label
          >${t(locale, 'web.admin.org.description')}
          <textarea name="description" maxlength="500" rows="3">${values.description}</textarea>
        </label>
        ${fieldError(locale, errors, 'description')}
        <label
          >${t(locale, 'web.admin.org.invite')}
          <input name="invite_url" value="${values.inviteUrl}" placeholder="https://discord.gg/…"
        /></label>
        <p class="muted">${t(locale, 'web.admin.org.inviteHelp')}</p>
        ${fieldError(locale, errors, 'inviteUrl')}
        <button type="submit">${t(locale, 'web.admin.org.save')}</button>
      </form>
      <h2>${t(locale, 'web.admin.org.logo')}</h2>
      ${
        org.logoKey
          ? html`<p><img src="/${org.logoKey}" alt="" width="64" height="64" /></p>`
          : html`<p class="muted">${t(locale, 'web.admin.org.noLogo')}</p>`
      }
      <form class="card stack" method="post" action="${base}/logo" enctype="multipart/form-data">
        ${csrfField(data.csrf)}
        <input type="file" name="logo" accept="image/png" required />
        <button type="submit">${t(locale, 'web.admin.org.logoSave')}</button>
      </form>
      <h2>${t(locale, 'web.admin.org.handover')}</h2>
      <form class="card stack" method="post" action="${base}/owner">
        ${csrfField(data.csrf)}
        <p class="muted">${t(locale, 'web.admin.org.handoverHelp')}</p>
        <label
          >${t(locale, 'web.admin.org.newOwner')}
          <input name="owner" inputmode="numeric" pattern="[0-9]{17,20}" required
        /></label>
        <label
          ><input type="checkbox" name="confirm" value="1" required />
          ${t(locale, 'web.admin.org.handoverConfirm', { name: org.name })}</label
        >
        <button type="submit">${t(locale, 'web.admin.org.handoverButton')}</button>
      </form>`,
  );
}

/** Which message an invitation problem shows. */
export const inviteError = (problem: OrgInviteProblem): OrgPageError =>
  problem === 'expires'
    ? 'invite_expires'
    : problem === 'invalid'
      ? 'invite_invalid'
      : 'discord_unavailable';
