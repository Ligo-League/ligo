import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { SeasonAdminView } from '../../services/admin-seasons.ts';
import type { SettingErrors } from '../../services/settings-form.ts';
import { csrfField, pageOf, type Html, type Page } from '../layout.ts';
import { scoringFields } from './admin-rules.ts';
import {
  settingErrorKey,
  settingsSections,
  type FieldView,
  type SectionView,
} from './settings-fields.ts';

// A season in the admin panel (phase 3h; design doc section 7, M-40): creating it, then its
// name, dates, scoring settings, forfeit scores and thresholds, map pool and status.

export const SEASON_DONE = ['created', 'saved', 'status'] as const;
export type SeasonDone = (typeof SEASON_DONE)[number];

type View = Extract<SeasonAdminView, { ok: true }>;
type Typed = { values: Record<string, string>; errors: SettingErrors };

const STATUS_KEYS = {
  registration: 'web.season.status.registration',
  active: 'web.season.status.active',
  cup: 'web.season.status.cup',
  closed: 'web.season.status.closed',
} as const satisfies Record<View['season']['status'], MessageKey>;

const GENERAL: SectionView = {
  title: 'web.admin.settings.section.general',
  fields: [
    { path: 'name', label: 'web.admin.org.name', input: { type: 'text', maxlength: 60 } },
    { path: 'starts_on', label: 'web.admin.season.startsOn', input: { type: 'date' } },
    { path: 'ends_on', label: 'web.admin.season.endsOn', input: { type: 'date' } },
  ],
};

/** The four places of a forfeit score: rounds for and against, each side; `help` after them. */
function forfeitScoreFields(path: string, optional: boolean, help?: MessageKey): FieldView[] {
  const sides = [
    ['winner', '0', 'web.admin.season.winnerFor'],
    ['winner', '1', 'web.admin.season.winnerAgainst'],
    ['loser', '0', 'web.admin.season.loserFor'],
    ['loser', '1', 'web.admin.season.loserAgainst'],
  ] as const;
  return sides.map(([side, place, label], index) => ({
    path: `${path}.${side}.${place}`,
    label,
    ...(help && index === sides.length - 1 ? { help } : {}),
    input: { type: 'number', min: 0, optional },
  }));
}

/** The season's form, in the order of `SEASON_FIELDS`. */
export const SEASON_SECTIONS: readonly SectionView[] = [
  GENERAL,
  {
    title: 'web.admin.rules.section.scoring',
    groups: {
      'settings.points': 'web.admin.settings.error.invalid',
      'settings.tiebreak': 'web.admin.settings.error.invalid',
    },
    fields: scoringFields('settings.'),
  },
  {
    title: 'web.admin.season.section.forfeitScore',
    groups: { 'settings.forfeit_score': 'web.admin.settings.error.invalid' },
    fields: forfeitScoreFields('settings.forfeit_score', false),
  },
  {
    title: 'web.admin.season.section.exclusionScore',
    groups: { 'settings.exclusion_forfeit_score': 'web.admin.settings.error.invalid' },
    fields: forfeitScoreFields(
      'settings.exclusion_forfeit_score',
      true,
      'web.admin.season.exclusionScoreHelp',
    ),
  },
  {
    title: 'web.admin.season.section.forfeits',
    groups: { 'settings.forfeits': 'web.admin.settings.error.invalid' },
    fields: [
      {
        path: 'settings.forfeits.warning_at',
        label: 'web.admin.season.warningAt',
        input: { type: 'number', min: 1, optional: true },
      },
      {
        path: 'settings.forfeits.exclusion_at',
        label: 'web.admin.season.exclusionAt',
        help: 'web.admin.season.thresholdHelp',
        input: { type: 'number', min: 1, optional: true },
      },
    ],
  },
  {
    title: 'web.admin.season.section.maps',
    fields: [
      {
        path: 'settings.map_pool',
        label: 'web.admin.season.mapPool',
        help: 'web.admin.season.mapPoolHelp',
        input: { type: 'textarea', rows: 10 },
      },
    ],
  },
];

const fieldError = (locale: Locale, errors: SettingErrors, path: string) => {
  const error = errors[path];
  return error ? html`<p class="field-error">${t(locale, settingErrorKey(error))}</p>` : '';
};

export function seasonNewView(
  locale: Locale,
  data: {
    org: { name: string; slug: string };
    competition: { name: string; slug: string };
    typed: Typed;
    csrf: string;
  },
): Page {
  const base = `/admin/${data.org.slug}/${data.competition.slug}`;
  const title = t(locale, 'web.admin.season.newTitle', { name: data.competition.name });
  return pageOf(
    title,
    html`<p><a href="${base}">${data.competition.name}</a></p>
      <h1>${title}</h1>
      <p class="muted">${t(locale, 'web.admin.season.newIntro')}</p>
      <form class="card stack" method="post" action="${base}/seasons/new">
        ${csrfField(data.csrf)}
        ${settingsSections(locale, [GENERAL], data.typed.values, data.typed.errors)}
        <button type="submit">${t(locale, 'web.admin.season.createButton')}</button>
      </form>`,
  );
}

export interface SeasonPageData {
  view: View;
  typed: Typed | null;
  done: SeasonDone | null;
  csrf: string;
}

/** Whether the scoring settings may change, and who may change them now (M-40). */
function lockNotice(locale: Locale, view: View): Html {
  if (!view.locked) return html``;
  return html`<p class="card flash">
    ${t(locale, view.owner ? 'web.admin.season.lockedOwner' : 'web.admin.season.lockedStaff')}
  </p>`;
}

export function seasonPageView(locale: Locale, data: SeasonPageData): Page {
  const { view } = data;
  const { org, competition, season } = view;
  const base = `/admin/${org.slug}/${competition.slug}/seasons/${String(season.id)}`;
  const errors = data.typed?.errors ?? {};
  const title = t(locale, 'web.admin.season.title', {
    competition: competition.name,
    season: season.name,
  });
  return pageOf(
    title,
    html`<p>
        <a href="/admin/${org.slug}/${competition.slug}">${competition.name}</a> ·
        <a href="/${org.slug}/${competition.slug}/${season.slug}"
          >${t(locale, 'web.admin.season.public')}</a
        >
      </p>
      <h1>${title}</h1>
      ${
        data.done
          ? html`<p class="card flash">${t(locale, `web.admin.season.done.${data.done}`)}</p>`
          : ''
      }
      ${
        data.typed
          ? html`<p class="card flash error">${t(locale, 'web.admin.settings.notSaved')}</p>`
          : ''
      }
      <section class="card stack">
        <h2>${t(locale, 'web.admin.season.status')}</h2>
        <p>
          ${t(locale, 'web.admin.season.statusNow', { status: t(locale, STATUS_KEYS[season.status]) })}
        </p>
        ${
          view.nextStatuses.length === 0
            ? ''
            : html`<form class="stack" method="post" action="${base}/status">
                ${csrfField(data.csrf)}
                <label
                  >${t(locale, 'web.admin.season.moveTo')}
                  <select name="status">
                    ${view.nextStatuses.map(
                      (status) =>
                        html`<option value="${status}">${t(locale, STATUS_KEYS[status])}</option>`,
                    )}
                  </select></label
                >
                <p class="muted">${t(locale, 'web.admin.season.statusHelp')}</p>
                <button type="submit">${t(locale, 'web.admin.season.moveButton')}</button>
              </form>`
        }
      </section>
      ${lockNotice(locale, view)}
      <form class="card stack" method="post" action="${base}">
        ${csrfField(data.csrf)}
        ${settingsSections(locale, SEASON_SECTIONS, data.typed?.values ?? view.values, errors)}
        ${
          view.locked && view.owner
            ? html`<label
                  >${t(locale, 'web.admin.season.reason')}
                  <input name="reason" value="${data.typed?.values.reason ?? ''}" maxlength="200"
                /></label>
                <p class="muted">${t(locale, 'web.admin.season.reasonHelp')}</p>
                ${fieldError(locale, errors, 'reason')}`
            : ''
        }
        <button type="submit">${t(locale, 'web.admin.org.save')}</button>
      </form>`,
  );
}
