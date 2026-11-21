import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { LeagueSyncReply } from '../../services/reconciler.ts';
import type { TeamRoleChoices, TeamRoleError } from '../../services/team-roles.ts';
import { syncReplyLines } from '../../discord/sync-text.ts';
import { csrfField, pageOf, type Html, type Page } from '../layout.ts';

// The league server's sync in the admin panel (phase 4; design doc section 6): what a sync
// would change now, and a button to make it; then each team's role, to link an existing one
// instead of Ligo's (M-46).

export const TEAM_ROLE_DONE = ['link', 'unlink'] as const;
export type TeamRoleDone = (typeof TEAM_ROLE_DONE)[number];
export const TEAM_ROLE_ERRORS = [
  'not_linked',
  'not_a_roster',
  'not_in_server',
  'discord_unavailable',
  'unknown_role',
  'reserved_role',
  'role_taken',
  'not_a_link',
] as const satisfies readonly TeamRoleError[];

const ROLE_ERROR_KEYS = {
  not_linked: 'web.admin.sync.roles.error.not_linked',
  not_a_roster: 'web.admin.sync.roles.error.not_a_roster',
  not_in_server: 'web.admin.sync.roles.error.not_in_server',
  discord_unavailable: 'web.admin.sync.roles.error.discord_unavailable',
  unknown_role: 'web.admin.sync.roles.error.unknown_role',
  reserved_role: 'web.admin.sync.roles.error.reserved_role',
  role_taken: 'web.admin.sync.roles.error.role_taken',
  not_a_link: 'web.admin.sync.roles.error.not_a_link',
} as const satisfies Record<TeamRoleError, MessageKey>;

export interface SyncPageData {
  org: { name: string; slug: string };
  competition: { name: string; slug: string };
  /** The dry run made for this page. */
  preview: LeagueSyncReply;
  /** What the last sync from this page did. */
  done: { applied: number; failed: number } | null;
  teamRoles:
    TeamRoleChoices | { ok: false; error: 'not_linked' | 'not_in_server' | 'discord_unavailable' };
  /** What was just done to a team's role, or refused. */
  roleDone: TeamRoleDone | null;
  roleError: TeamRoleError | null;
  csrf: string;
}

function teamRolesSection(locale: Locale, base: string, data: SyncPageData): Html {
  const choices = data.teamRoles;
  const flash = data.roleDone
    ? html`<p class="card flash">${t(locale, `web.admin.sync.roles.done.${data.roleDone}`)}</p>`
    : data.roleError
      ? html`<p class="card flash error">${t(locale, ROLE_ERROR_KEYS[data.roleError])}</p>`
      : '';
  const body = !choices.ok
    ? html`<p class="muted">${t(locale, ROLE_ERROR_KEYS[choices.error])}</p>`
    : choices.rosters.length === 0
      ? html`<p class="muted">${t(locale, 'web.admin.sync.roles.none')}</p>`
      : html`<table>
          <tbody>
            ${choices.rosters.map((roster) => {
              const action = `${base}/discord/team-roles/${String(roster.teamId)}`;
              const current = roster.role
                ? t(
                    locale,
                    roster.role.linked
                      ? 'web.admin.sync.roles.linked'
                      : 'web.admin.sync.roles.made',
                    { role: roster.role.name },
                  )
                : t(locale, 'web.admin.sync.roles.missing');
              return html`<tr>
                <td>${roster.name} (${roster.tag})</td>
                <td>${current}</td>
                <td>
                  ${
                    roster.role?.linked
                      ? html`<form method="post" action="${action}/unlink">
                          ${csrfField(data.csrf)}
                          <button type="submit">${t(locale, 'web.admin.sync.roles.unlink')}</button>
                        </form>`
                      : choices.linkable.length > 0
                        ? html`<form method="post" action="${action}/link">
                            ${csrfField(data.csrf)}
                            <label
                              >${t(locale, 'web.admin.sync.roles.pick')}
                              <select name="role">
                                ${choices.linkable.map(
                                  (role) => html`<option value="${role.id}">${role.name}</option>`,
                                )}
                              </select></label
                            >
                            <button type="submit">${t(locale, 'web.admin.sync.roles.link')}</button>
                          </form>`
                        : ''
                  }
                </td>
              </tr>`;
            })}
          </tbody>
        </table>`;
  return html`<section class="card stack" id="roles">
    <h2>${t(locale, 'web.admin.sync.roles.title')}</h2>
    <p class="muted">${t(locale, 'web.admin.sync.roles.intro')}</p>
    ${flash} ${body}
  </section>`;
}

export function syncPageView(locale: Locale, data: SyncPageData): Page {
  const { org, competition } = data;
  const base = `/admin/${org.slug}/${competition.slug}`;
  const title = t(locale, 'web.admin.sync.title');
  const canSync = data.preview.ok && data.preview.managed && data.preview.operations.length > 0;
  return pageOf(
    title,
    html`<p><a href="${base}">${competition.name}</a></p>
      <h1>${title}</h1>
      <p class="muted">${t(locale, 'web.admin.sync.intro')}</p>
      ${
        data.done
          ? html`<p class="card flash">
              ${t(locale, 'web.admin.sync.done', {
                applied: String(data.done.applied),
                failed: String(data.done.failed),
              })}
            </p>`
          : ''
      }
      <section class="card stack">
        ${syncReplyLines(locale, data.preview, true).map((line) => html`<p>${line}</p>`)}
        ${
          canSync
            ? html`<form method="post" action="${base}/discord/sync">
                ${csrfField(data.csrf)}
                <button type="submit">${t(locale, 'web.admin.sync.button')}</button>
              </form>`
            : ''
        }
      </section>
      ${teamRolesSection(locale, base, data)}`,
  );
}
