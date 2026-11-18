import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { DiscordSettingsView } from '../../services/league-discord.ts';
import { csrfField, pageOf, type Page } from '../layout.ts';

type Settings = Extract<DiscordSettingsView, { ok: true }>;

/** `/:org/:competition/discord`: the league's server, its staff role and its invitation link. */
export function discordSettingsPage(
  locale: Locale,
  data: Settings,
  state: {
    csrf: string;
    installUrl: string | null;
    /** What was typed, after a refusal; the stored values otherwise. */
    values: { staffRoleId: string; inviteUrl: string };
    flash: { error: boolean; key: MessageKey } | null;
  },
): Page {
  const title = t(locale, 'web.discord.title', { competition: data.competition.name });
  const action = `${data.competition.path}/discord`;
  const moving = data.chosen.id !== data.current.guildId;
  const body = html`<h1>${title}</h1>
    ${
      state.flash
        ? html`<p class="card flash${state.flash.error ? ' error' : ''}">
            ${t(locale, state.flash.key)}
          </p>`
        : ''
    }
    <p>${t(locale, 'web.discord.intro')}</p>
    <p>
      <a href="${data.competition.path}/discord/channels"
        >${t(locale, 'web.discord.channelsLink')}</a
      >
    </p>
    <form class="card stack" method="get" action="${action}">
      <label for="server">${t(locale, 'web.discord.server')}</label>
      <select id="server" name="server">
        ${data.servers.map(
          (server) =>
            html`<option value="${server.id}" ${server.id === data.chosen.id ? 'selected' : ''}>
              ${server.name}
              ${server.id === data.current.guildId ? `(${t(locale, 'web.discord.current')})` : ''}
            </option>`,
        )}
      </select>
      <button type="submit">${t(locale, 'web.discord.choose')}</button>
      ${
        state.installUrl
          ? html`<p class="muted">
              ${t(locale, 'web.discord.missingServer')}
              <a href="${state.installUrl}" rel="noopener noreferrer"
                >${t(locale, 'web.discord.addBot')}</a
              >
            </p>`
          : ''
      }
    </form>
    <form class="card stack" method="post" action="${action}">
      ${csrfField(state.csrf)}
      <input type="hidden" name="guild_id" value="${data.chosen.id}" />
      <p>${t(locale, 'web.discord.server')} : <strong>${data.chosen.name}</strong></p>
      ${moving ? html`<p class="flash error">${t(locale, 'web.discord.moving')}</p>` : ''}
      <label for="staff_role">${t(locale, 'web.discord.staffRole')}</label>
      <select id="staff_role" name="staff_role" required>
        ${data.chosen.roles.map(
          (role) =>
            html`<option
              value="${role.id}"
              ${role.id === state.values.staffRoleId ? 'selected' : ''}
            >
              ${role.name}
            </option>`,
        )}
      </select>
      <label for="invite_url">${t(locale, 'web.discord.invite')}</label>
      <input
        id="invite_url"
        name="invite_url"
        type="url"
        required
        placeholder="https://discord.gg/…"
        value="${state.values.inviteUrl}"
      />
      <p class="muted">${t(locale, 'web.discord.inviteHint')}</p>
      <button type="submit">${t(locale, 'web.discord.save')}</button>
    </form>`;
  return pageOf(title, body);
}
