import { ADDABLE_TEAM_ROLES, mayFile, type TeamRole } from '@ligo/core';
import { html } from 'hono/html';
import { requestWhat } from '../../discord/request-text.ts';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import { REQUEST_NOTE_MAX_LENGTH, type RequestView } from '../../services/requests.ts';
import type { TeamMember } from '../../services/team-staff.ts';
import { csrfField, formatWhen, pageOf, type Html, type Page } from '../layout.ts';

// `/teams/:slug/manage`: what `/team` does, on the website. The forms shown follow the core
// rule (`mayFile`); the services check it again on every POST.

/** What a form sends back with, read back from the address: anything else shows nothing. */
export const MANAGE_DONE = ['filed', 'applied', 'changed', 'withdrawn'] as const;
export type ManageDone = (typeof MANAGE_DONE)[number];

const ERROR_KEYS = {
  not_official: 'team.error.not_official',
  not_allowed: 'team.error.not_allowed',
  owner_only: 'team.error.owner_only',
  queue_not_set: 'team.error.queue_not_set',
  already_requested: 'team.error.already_requested',
  not_linked: 'team.error.not_linked',
  no_season: 'team.error.no_season',
  team_not_found: 'team.error.team_not_found',
  team_required: 'team.error.team_not_found',
  already_on_team: 'team.error.already_on_team',
  not_on_team: 'team.error.not_on_team',
  owner_cannot_leave: 'team.error.owner_cannot_leave',
  role_full: 'team.error.role_full',
  not_staff: 'team.error.not_staff',
  not_found: 'request.error.not_found',
  not_pending: 'request.error.not_pending',
  not_yours: 'request.error.not_yours',
  reason_required: 'request.error.reason_required',
  member_not_found: 'web.manage.error.member_not_found',
  discord_unreachable: 'web.manage.error.discord_unreachable',
  invalid_role: 'web.manage.error.invalid_role',
} as const satisfies Record<string, MessageKey>;
export type ManageError = keyof typeof ERROR_KEYS;
export const isManageError = (value: string | undefined): value is ManageError =>
  value !== undefined && Object.hasOwn(ERROR_KEYS, value);

export type ManageFlash = { done: ManageDone } | { error: ManageError; max: number | null } | null;

export interface TeamManageData {
  team: { name: string; tag: string; slug: string };
  members: TeamMember[];
  /** The requests waiting for this roster. */
  requests: RequestView[];
  /** League staff change the team directly, without a request. */
  staff: boolean;
  /** The viewer's highest role for the roster, when they hold one. */
  myRole: TeamRole | null;
  csrf: string;
  timeZone: string;
  flash: ManageFlash;
}

const ROLE_KEYS = {
  owner: 'team.role.owner',
  club_manager: 'team.role.club_manager',
  manager: 'team.role.manager',
  coach: 'team.role.coach',
} as const;

function flashView(locale: Locale, flash: ManageFlash): Html | string {
  if (!flash) return '';
  if ('done' in flash) {
    return html`<p class="card flash">${t(locale, `web.manage.done.${flash.done}`)}</p>`;
  }
  return html`<p class="card flash error">
    ${t(locale, ERROR_KEYS[flash.error], { max: flash.max ?? '?' })}
  </p>`;
}

const noteField = (locale: Locale) =>
  html`<label
    >${t(locale, 'web.manage.note')}
    <input type="text" name="note" maxlength="${REQUEST_NOTE_MAX_LENGTH}"
  /></label>`;

const usernameField = (locale: Locale) =>
  html`<label
      >${t(locale, 'web.manage.username')}
      <input type="text" name="username" required maxlength="32" autocomplete="off"
    /></label>
    <p class="muted">${t(locale, 'web.manage.usernameHelp')}</p>`;

/** The roster's officials, and the forms to change them, as `/team` offers them. */
export function teamManagePage(locale: Locale, data: TeamManageData): Page {
  const { team, staff, myRole } = data;
  const base = `/teams/${team.slug}/manage`;
  const may = (kind: 'team_owner' | 'team_member_remove') =>
    staff || (myRole !== null && mayFile(kind, myRole, false).ok);
  const addRoles = ADDABLE_TEAM_ROLES.filter(
    (role) => staff || (myRole !== null && mayFile('team_member_add', myRole, false, role).ok),
  );
  const canRemove = may('team_member_remove');
  const intro = staff ? 'web.manage.introStaff' : 'web.manage.intro';

  const members = html`<ul class="card">
    ${data.members.map(
      (member) =>
        html`<li>
          ${member.displayName}
          <span class="muted">· ${t(locale, ROLE_KEYS[member.role])}</span>
          ${
            canRemove && member.role !== 'owner' && member.discordUserId !== null
              ? html`<form method="post" action="${base}/remove" class="inline">
                  ${csrfField(data.csrf)}
                  <input type="hidden" name="member" value="${member.discordUserId}" />
                  <input type="hidden" name="name" value="${member.displayName}" />
                  <button type="submit">${t(locale, 'web.manage.remove')}</button>
                </form>`
              : ''
          }
        </li>`,
    )}
  </ul>`;

  const addForm =
    addRoles.length > 0
      ? html`<h2>${t(locale, 'web.manage.add')}</h2>
          <form class="card" method="post" action="${base}/add">
            ${csrfField(data.csrf)} ${usernameField(locale)}
            <label
              >${t(locale, 'web.manage.role')}
              <select name="role">
                ${addRoles.map(
                  (role) => html`<option value="${role}">${t(locale, ROLE_KEYS[role])}</option>`,
                )}
              </select></label
            >
            ${staff ? '' : noteField(locale)}
            <button type="submit">
              ${t(locale, staff ? 'web.manage.apply' : 'web.manage.ask')}
            </button>
          </form>`
      : '';

  const ownerForm = may('team_owner')
    ? html`<h2>${t(locale, 'web.manage.owner')}</h2>
        <form class="card" method="post" action="${base}/owner">
          ${csrfField(data.csrf)}
          <p class="muted">${t(locale, 'web.manage.ownerHelp')}</p>
          ${usernameField(locale)} ${staff ? '' : noteField(locale)}
          <button type="submit">${t(locale, staff ? 'web.manage.apply' : 'web.manage.ask')}</button>
        </form>`
    : '';

  const leaveForm =
    myRole !== null && mayFile('team_member_remove', myRole, true).ok
      ? html`<form class="card" method="post" action="${base}/leave">
          ${csrfField(data.csrf)}
          <label
            ><input type="checkbox" name="confirm" value="yes" required />
            ${t(locale, 'web.manage.leaveConfirm', { team: team.name })}</label
          >
          <button type="submit">${t(locale, 'web.manage.leave')}</button>
        </form>`
      : '';

  const requests = html`<h2>${t(locale, 'web.manage.requests')}</h2>
    ${
      data.requests.length === 0
        ? html`<p class="muted">${t(locale, 'web.manage.noRequests')}</p>`
        : html`<ul class="card">
            ${data.requests.map(
              (request) =>
                html`<li>
                  ${requestWhat(locale, request, (person) => person.displayName)}
                  <span class="muted"
                    >·
                    ${t(locale, 'web.manage.requestedBy', {
                      name: request.requester.displayName,
                      when: formatWhen(locale, request.requestedAt, data.timeZone),
                    })}</span
                  >
                  ${
                    staff
                      ? ''
                      : html`<form
                          method="post"
                          action="${base}/requests/${request.id}/withdraw"
                          class="inline"
                        >
                          ${csrfField(data.csrf)}
                          <button type="submit">${t(locale, 'web.manage.withdraw')}</button>
                        </form>`
                  }
                </li>`,
            )}
          </ul>`
    }`;

  return pageOf(
    t(locale, 'web.manage.title', { team: team.name }),
    html`<h1>${t(locale, 'web.manage.title', { team: team.name })}</h1>
      <p><a href="/teams/${team.slug}">${team.name} [${team.tag}]</a></p>
      ${flashView(locale, data.flash)}
      <p>${t(locale, intro)}</p>
      <h2>${t(locale, 'web.manage.officials')}</h2>
      ${members} ${addForm} ${ownerForm} ${requests} ${leaveForm}`,
  );
}
