import { html } from 'hono/html';
import { t, type Locale } from '../../i18n/index.ts';
import type { DivisionAdminView } from '../../services/admin-divisions.ts';
import type { SettingErrors } from '../../services/settings-form.ts';
import type { GuildTextChannel } from '../../discord/gateway.ts';
import { csrfField, pageOf, type Page } from '../layout.ts';
import { settingErrorKey, settingsSections, type SectionView } from './settings-fields.ts';

// A division in the admin panel (phase 3h; design doc section 7): adding one to a season, or
// changing its name, kind, level, region, category prefix and results channel.

type View = Extract<DivisionAdminView, { ok: true }>;

const SECTION: SectionView = {
  title: 'web.admin.settings.section.general',
  fields: [
    { path: 'name', label: 'web.admin.org.name', input: { type: 'text', maxlength: 40 } },
    {
      path: 'kind',
      label: 'web.admin.division.kind',
      input: {
        type: 'select',
        options: [
          { value: 'league', label: 'web.admin.division.kind.league' },
          { value: 'regional', label: 'web.admin.division.kind.regional' },
        ],
      },
    },
    {
      path: 'level',
      label: 'web.admin.division.level',
      help: 'web.admin.division.levelHelp',
      input: { type: 'number', min: 1, max: 20 },
    },
    {
      path: 'region',
      label: 'web.admin.division.region',
      help: 'web.admin.division.regionHelp',
      input: { type: 'text', maxlength: 40 },
    },
    {
      path: 'category_prefix',
      label: 'web.admin.division.prefix',
      help: 'web.admin.division.prefixHelp',
      input: { type: 'text', maxlength: 10 },
    },
  ],
};

export interface DivisionPageData {
  view: View;
  typed: { values: Record<string, string>; errors: SettingErrors } | null;
  /** The league server's text channels; null when Discord did not answer or none is linked. */
  channels: readonly GuildTextChannel[] | null;
  saved: boolean;
  csrf: string;
}

/** The results channel, among the league server's text channels, by their names. */
function channelField(
  locale: Locale,
  data: DivisionPageData,
  value: string,
  errors: SettingErrors,
) {
  const error = errors.results_channel_id;
  const problem = error
    ? html`<p class="field-error">${t(locale, settingErrorKey(error))}</p>`
    : '';
  if (!data.channels) {
    // Unchanged without Discord: the service only checks a channel that changes.
    return html`<input type="hidden" name="results_channel_id" value="${value}" />
      <p class="muted">${t(locale, 'web.admin.division.channelUnavailable')}</p>
      ${problem}`;
  }
  return html`<label
      >${t(locale, 'web.admin.division.resultsChannel')}
      <select name="results_channel_id">
        <option value="" ${value === '' ? 'selected' : ''}>
          ${t(locale, 'web.admin.division.leagueChannel')}
        </option>
        ${data.channels.map(
          (channel) =>
            html`<option value="${channel.id}" ${channel.id === value ? 'selected' : ''}>
              #${channel.name}${channel.category ? ` (${channel.category})` : ''}
            </option>`,
        )}
      </select></label
    >
    <p class="muted">${t(locale, 'web.admin.division.resultsChannelHelp')}</p>
    ${problem}`;
}

export function divisionPageView(locale: Locale, data: DivisionPageData): Page {
  const { view } = data;
  const seasonPath = `/admin/${view.org.slug}/${view.competition.slug}/seasons/${String(view.season.id)}`;
  const action = view.division
    ? `${seasonPath}/divisions/${String(view.division.id)}`
    : `${seasonPath}/divisions/new`;
  const title = view.division
    ? t(locale, 'web.admin.division.title', { name: view.division.name, season: view.season.name })
    : t(locale, 'web.admin.division.newTitle', { season: view.season.name });
  const values = data.typed?.values ?? view.values;
  const errors = data.typed?.errors ?? {};
  return pageOf(
    title,
    html`<p><a href="${seasonPath}">${view.season.name}</a></p>
      <h1>${title}</h1>
      ${data.saved ? html`<p class="card flash">${t(locale, 'web.admin.comp.done.saved')}</p>` : ''}
      ${
        data.typed
          ? html`<p class="card flash error">${t(locale, 'web.admin.settings.notSaved')}</p>`
          : ''
      }
      <form class="card stack" method="post" action="${action}">
        ${csrfField(data.csrf)} ${settingsSections(locale, [SECTION], values, errors)}
        ${channelField(locale, data, values.results_channel_id ?? '', errors)}
        <button type="submit">
          ${t(locale, view.division ? 'web.admin.org.save' : 'web.admin.division.createButton')}
        </button>
      </form>`,
  );
}
