import { ADDABLE_TEAM_ROLES, mayFile, type TeamRole } from '@ligo/core';
import { html } from 'hono/html';
import { requestWhat } from '../../discord/request-text.ts';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import { REQUEST_NOTE_MAX_LENGTH, type RequestView } from '../../services/requests.ts';
import type { RosterMember } from '../../services/rosters.ts';
import type { TeamMember } from '../../services/team-staff.ts';
import { csrfField, formatWhen, pageOf, type Html, type Page } from '../layout.ts';

// `/teams/:slug/manage`: what `/team` does, on the website. The forms shown follow the core
// rule (`mayFile`); the services check it again on every POST.

/** What a form sends back with, read back from the address: anything else shows nothing. */
export const MANAGE_DONE = [
  'created',
  'filed',
  'applied',
  'changed',
  'withdrawn',
  'invite',
  'player_removed',
] as const;
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
  team: { name: string; tag: string; slug: string; clubSlug: string };
  members: TeamMember[];
  /** The season's lineup, starters first, shown closed while the roster plays a season under way. */
  players: { name: string; role: string; captain: boolean }[];
  /** The roster's own players, open all year (M-33, M-35). */
  roster: {
    /** It plays a season under way: that season's lineup is the mercato's. */
    inPlay: boolean;
    members: RosterMember[];
    max: number;
    /** Whether the viewer manages the players: an official who may add officials. */
    canManage: boolean;
    /** The link to share, for those who manage the players; null when none is in force. */
    inviteUrl: string | null;
  };
  /** The requests waiting for this roster. */
  requests: RequestView[];
  /** League staff change the team directly, without a request. */
  staff: boolean;
  /** A roster in no competition yet (M-33): its officials change it at once. */
  free: boolean;
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

const PLAYER_GAP_KEYS = {
  game_account: 'web.join.gap.game_account',
  nationality: 'web.join.gap.nationality',
} as const satisfies Record<string, MessageKey>;

/**
 * The roster's own players, open all year (M-33, M-35): each with what they still have to
 * complete, its invitation link for the officials who manage them, and removal.
 */
function openPlayers(locale: Locale, data: TeamManageData, base: string): Html {
  const { roster } = data;
  const count = t(locale, 'web.manage.playersCount', {
    count: roster.members.length,
    max: roster.max,
  });
  const members =
    roster.members.length === 0
      ? html`<p class="muted">${t(locale, 'web.manage.noPlayers')}</p>`
      : html`<ul class="card">
          ${roster.members.map((member) => {
            const gaps = member.gaps.filter(
              (gap): gap is keyof typeof PLAYER_GAP_KEYS => gap in PLAYER_GAP_KEYS,
            );
            return html`<li>
              ${member.name}
              ${
                gaps.length > 0
                  ? html`<span class="muted"
                      >· ${t(locale, 'web.manage.playerGaps')}
                      ${gaps.map((gap) => t(locale, PLAYER_GAP_KEYS[gap])).join(', ')}</span
                    >`
                  : ''
              }
              ${
                roster.canManage
                  ? html`<form
                      method="post"
                      action="${base}/players/${member.playerId}/remove"
                      class="inline"
                    >
                      ${csrfField(data.csrf)}
                      <button type="submit">${t(locale, 'web.manage.remove')}</button>
                    </form>`
                  : ''
              }
            </li>`;
          })}
        </ul>`;
  const invite = !roster.canManage
    ? ''
    : roster.inviteUrl
      ? html`<div class="card">
          <p>${t(locale, 'web.manage.inviteShare')}</p>
          <p><code>${roster.inviteUrl}</code></p>
          <form method="post" action="${base}/invite">
            ${csrfField(data.csrf)}
            <input type="hidden" name="renew" value="1" />
            <button type="submit">${t(locale, 'web.manage.inviteRenew')}</button>
          </form>
        </div>`
      : html`<form class="card" method="post" action="${base}/invite">
          ${csrfField(data.csrf)}
          <p>${t(locale, 'web.manage.inviteNone')}</p>
          <button type="submit">${t(locale, 'web.manage.inviteCreate')}</button>
        </form>`;
  return html`<h2 id="players">${t(locale, 'web.team.players')}</h2>
    <p class="muted">${count}</p>
    ${members} ${invite}`;
}

/**
 * The lineup of the season under way: it changes only during a mercato window (M-29), which
 * comes with the mercato (3f). The forms are shown closed, with the reason.
 */
function closedPlayers(locale: Locale, data: TeamManageData): Html {
  const closed = t(locale, 'web.manage.mercatoClosed');
  return html`<h2>${t(locale, 'web.manage.seasonLineup')}</h2>
    ${
      data.players.length === 0
        ? html`<p class="muted">${t(locale, 'web.manage.noPlayers')}</p>`
        : html`<ul class="card">
            ${data.players.map(
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
                  <button type="button" class="inline" disabled title="${closed}">
                    ${t(locale, 'web.manage.remove')}
                  </button>
                </li>`,
            )}
          </ul>`
    }
    <form class="card">
      <fieldset disabled>
        <legend>${t(locale, 'web.manage.addPlayer')}</legend>
        <p class="muted">${closed}</p>
        ${usernameField(locale)}
        <button type="button">${t(locale, 'web.manage.ask')}</button>
      </fieldset>
    </form>`;
}

/** The roster's officials, and the forms to change them, as `/team` offers them. */
export function teamManagePage(locale: Locale, data: TeamManageData): Page {
  const { team, staff, myRole, free } = data;
  // Changes apply at once for league staff and for a roster in no competition.
  const direct = staff || free;
  const base = `/teams/${team.slug}/manage`;
  const may = (kind: 'team_owner' | 'team_member_remove') =>
    staff || (myRole !== null && mayFile(kind, myRole, false).ok);
  const addRoles = ADDABLE_TEAM_ROLES.filter(
    (role) => staff || (myRole !== null && mayFile('team_member_add', myRole, false, role).ok),
  );
  const canRemove = may('team_member_remove');
  const intro = free
    ? 'web.manage.introFree'
    : staff
      ? 'web.manage.introStaff'
      : 'web.manage.intro';

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

  const players = html`${openPlayers(locale, data, base)}
  ${data.roster.inPlay ? closedPlayers(locale, data) : ''}`;

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
            ${direct ? '' : noteField(locale)}
            <button type="submit">
              ${t(locale, direct ? 'web.manage.apply' : 'web.manage.ask')}
            </button>
          </form>`
      : '';

  const ownerForm = may('team_owner')
    ? html`<h2>${t(locale, 'web.manage.owner')}</h2>
        <form class="card" method="post" action="${base}/owner">
          ${csrfField(data.csrf)}
          <p class="muted">${t(locale, 'web.manage.ownerHelp')}</p>
          ${usernameField(locale)} ${direct ? '' : noteField(locale)}
          <button type="submit">
            ${t(locale, direct ? 'web.manage.apply' : 'web.manage.ask')}
          </button>
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
      <p>
        <a href="/teams/${team.slug}">${team.name} [${team.tag}]</a>
        ${
          myRole === 'owner' || myRole === 'club_manager'
            ? html` ·
                <a href="/clubs/${team.clubSlug}/rosters/new"
                  >${t(locale, 'web.manage.addRoster')}</a
                >`
            : ''
        }
        ${
          data.roster.inPlay && (data.roster.canManage || data.staff)
            ? html` ·
                <a href="/teams/${team.slug}/mercato">${t(locale, 'web.manage.mercatoLink')}</a>`
            : ''
        }
      </p>
      ${flashView(locale, data.flash)}
      <p>${t(locale, intro)}</p>
      <h2>${t(locale, 'web.manage.officials')}</h2>
      ${members} ${addForm} ${ownerForm} ${players} ${free ? '' : requests} ${leaveForm}`,
  );
}
