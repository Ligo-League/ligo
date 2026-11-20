import { TITLES } from '@ligo/titles';
import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type {
  CompetitionAdminView,
  CompetitionValues,
  CreateCompetitionReply,
} from '../../services/admin-competitions.ts';
import type { SettingErrors } from '../../services/settings-form.ts';
import { csrfField, pageOf, type Page } from '../layout.ts';
import { settingsSections, type SectionView } from './settings-fields.ts';

// A competition in the admin panel (phase 3h; design doc section 7): creating it, for the
// organisation's owner, and its general settings, for the owner and the competition's staff.

export const COMPETITION_DONE = ['created', 'saved'] as const;
export type CompetitionDone = (typeof COMPETITION_DONE)[number];

const TITLE_KEYS = {
  r6: 'title.r6',
  valorant: 'title.valorant',
  rocket_league: 'title.rocket_league',
  lol: 'title.lol',
  cs: 'title.cs',
} as const satisfies Record<(typeof TITLES)[number], MessageKey>;

const CREATE_ERRORS = {
  invalid: 'web.admin.org.error.invalid',
  taken: 'web.admin.org.error.taken',
  reserved: 'web.admin.comp.error.reserved',
  length: 'web.admin.org.error.length',
} as const satisfies Record<string, MessageKey>;

type CreateErrors = Extract<CreateCompetitionReply, { errors: unknown }>['errors'];

export function competitionNewView(
  locale: Locale,
  data: {
    org: { name: string; slug: string };
    values: CompetitionValues;
    errors: CreateErrors;
    csrf: string;
  },
): Page {
  const title = t(locale, 'web.admin.comp.newTitle', { org: data.org.name });
  const { values, errors } = data;
  const error = (field: keyof CreateErrors) => {
    const found = errors[field];
    return found ? html`<p class="field-error">${t(locale, CREATE_ERRORS[found])}</p>` : '';
  };
  return pageOf(
    title,
    html`<p><a href="/admin/${data.org.slug}">${data.org.name}</a></p>
      <h1>${title}</h1>
      <p class="muted">${t(locale, 'web.admin.comp.newIntro')}</p>
      <form class="card stack" method="post" action="/admin/${data.org.slug}/new">
        ${csrfField(data.csrf)}
        <label
          >${t(locale, 'web.admin.comp.title')}
          <select name="title">
            ${TITLES.map(
              (entry) =>
                html`<option value="${entry}" ${values.title === entry ? 'selected' : ''}>
                  ${t(locale, TITLE_KEYS[entry])}
                </option>`,
            )}
          </select></label
        >
        ${error('title')}
        <label
          >${t(locale, 'web.admin.org.name')}
          <input name="name" value="${values.name}" maxlength="60" required
        /></label>
        ${error('name')}
        <label
          >${t(locale, 'web.admin.comp.slug')}
          <input name="slug" value="${values.slug}" maxlength="40" pattern="[a-z0-9-]*" required
        /></label>
        <p class="muted">${t(locale, 'web.admin.comp.slugHelp', { org: data.org.slug })}</p>
        ${error('slug')}
        <label
          >${t(locale, 'web.admin.comp.mode')}
          <select name="participant_mode">
            <option value="team" ${values.participantMode === 'team' ? 'selected' : ''}>
              ${t(locale, 'web.admin.comp.mode.team')}
            </option>
            <option value="mixed" ${values.participantMode === 'mixed' ? 'selected' : ''}>
              ${t(locale, 'web.admin.comp.mode.mixed')}
            </option>
          </select></label
        >
        ${error('participantMode')}
        <button type="submit">${t(locale, 'web.admin.comp.createButton')}</button>
      </form>`,
  );
}

const APPROVAL = [
  { value: 'staff', label: 'web.admin.settings.approval.staff' },
  { value: 'auto', label: 'web.admin.settings.approval.auto' },
] as const;
const WEEKDAYS = [
  { value: '', label: 'web.admin.settings.weekday.none' },
  ...([1, 2, 3, 4, 5, 6, 7] as const).map((day) => ({
    value: String(day),
    label:
      `web.admin.settings.weekday.${String(day) as '1' | '2' | '3' | '4' | '5' | '6' | '7'}` as const,
  })),
] as const;

/** The general form, in the order of `GENERAL_FIELDS`. */
export const GENERAL_SECTIONS: readonly SectionView[] = [
  {
    title: 'web.admin.settings.section.general',
    fields: [
      { path: 'name', label: 'web.admin.org.name', input: { type: 'text', maxlength: 60 } },
      {
        path: 'ruleset.result_validation',
        label: 'web.admin.settings.resultValidation',
        help: 'web.admin.settings.resultValidationHelp',
        input: {
          type: 'select',
          options: [
            { value: 'opponent', label: 'web.admin.settings.validation.opponent' },
            { value: 'staff', label: 'web.admin.settings.validation.staff' },
          ],
        },
      },
    ],
  },
  {
    title: 'web.admin.settings.section.scheduling',
    fields: [
      {
        path: 'scheduling.time_zone',
        label: 'web.admin.settings.timeZone',
        help: 'web.admin.settings.timeZoneHelp',
        input: { type: 'text', maxlength: 60 },
      },
      {
        path: 'scheduling.rounds_per_week',
        label: 'web.admin.settings.roundsPerWeek',
        input: { type: 'number', min: 1 },
      },
      {
        path: 'scheduling.extension_weeks',
        label: 'web.admin.settings.extensionWeeks',
        input: { type: 'number', min: 1, max: 4 },
      },
      {
        path: 'scheduling.auto_slot.weekday',
        label: 'web.admin.settings.autoSlotDay',
        help: 'web.admin.settings.autoSlotHelp',
        input: { type: 'select', options: WEEKDAYS },
      },
      {
        path: 'scheduling.auto_slot.time',
        label: 'web.admin.settings.autoSlotTime',
        input: { type: 'text', maxlength: 5 },
      },
    ],
  },
  {
    title: 'web.admin.settings.section.requests',
    groups: { 'ruleset.requests': 'web.admin.settings.group.requests' },
    fields: [
      {
        path: 'ruleset.requests.approval.team_owner',
        label: 'web.admin.settings.approval.team_owner',
        input: { type: 'select', options: APPROVAL },
      },
      {
        path: 'ruleset.requests.approval.team_member_add',
        label: 'web.admin.settings.approval.team_member_add',
        input: { type: 'select', options: APPROVAL },
      },
      {
        path: 'ruleset.requests.approval.team_member_remove',
        label: 'web.admin.settings.approval.team_member_remove',
        input: { type: 'select', options: APPROVAL },
      },
      {
        path: 'ruleset.requests.approval.roster_move',
        label: 'web.admin.settings.approval.roster_move',
        input: { type: 'select', options: APPROVAL },
      },
      {
        path: 'ruleset.requests.answer_within_hours',
        label: 'web.admin.settings.answerWithin',
        input: { type: 'number', min: 1, max: 720 },
      },
      {
        path: 'ruleset.requests.remind_before_hours',
        label: 'web.admin.settings.remindBefore',
        help: 'web.admin.settings.remindBeforeHelp',
        input: { type: 'number', min: 0, optional: true },
      },
    ],
  },
  {
    title: 'web.admin.settings.section.teamRoles',
    fields: [
      {
        path: 'ruleset.team_roles.managers_max',
        label: 'web.admin.settings.managersMax',
        input: { type: 'number', min: 0 },
      },
      {
        path: 'ruleset.team_roles.coaches_max',
        label: 'web.admin.settings.coachesMax',
        input: { type: 'number', min: 0 },
      },
    ],
  },
];

export interface CompetitionPageData {
  view: Extract<CompetitionAdminView, { ok: true }>;
  /** A refused save: what was typed and what is wrong. */
  typed: { values: Record<string, string>; errors: SettingErrors } | null;
  done: CompetitionDone | null;
  csrf: string;
}

export function competitionPageView(locale: Locale, data: CompetitionPageData): Page {
  const { view } = data;
  const { competition, org } = view;
  const path = `/${org.slug}/${competition.slug}`;
  return pageOf(
    competition.name,
    html`<p>
        <a href="/admin">${t(locale, 'web.admin.title')}</a>
        ${view.owner ? html` · <a href="/admin/${org.slug}">${org.name}</a>` : ''}
      </p>
      <h1>${competition.name}</h1>
      <p class="muted">
        ${t(locale, 'web.admin.comp.fixed', {
          title: t(locale, TITLE_KEYS[competition.title]),
          path,
        })}
      </p>
      ${
        data.done
          ? html`<p class="card flash">${t(locale, `web.admin.comp.done.${data.done}`)}</p>`
          : ''
      }
      ${
        data.typed
          ? html`<p class="card flash error">${t(locale, 'web.admin.settings.notSaved')}</p>`
          : ''
      }
      <ul>
        <li>
          <a href="/admin/${org.slug}/${competition.slug}/rules"
            >${t(locale, 'web.admin.comp.rules')}</a
          >
        </li>
        <li><a href="${path}/discord">${t(locale, 'web.admin.comp.discord')}</a></li>
        <li><a href="${path}/discord/channels">${t(locale, 'web.admin.comp.channels')}</a></li>
        <li>
          <a href="/admin/${org.slug}/${competition.slug}/discord/sync"
            >${t(locale, 'web.admin.sync.link')}</a
          >
        </li>
      </ul>
      <section class="card stack">
        <h2>${t(locale, 'web.admin.comp.seasons')}</h2>
        ${
          view.seasons.length === 0
            ? html`<p class="muted">${t(locale, 'web.admin.comp.noSeason')}</p>`
            : html`<ul>
                ${view.seasons.map(
                  (season) =>
                    html`<li>
                      <a href="/admin/${org.slug}/${competition.slug}/seasons/${String(season.id)}"
                        >${season.name}</a
                      >
                      · ${t(locale, `web.season.status.${season.status}`)} ·
                      ${t(locale, 'web.admin.comp.seasonDates', {
                        from: season.startsOn,
                        to: season.endsOn,
                      })}
                    </li>`,
                )}
              </ul>`
        }
        <p>
          <a href="/admin/${org.slug}/${competition.slug}/seasons/new"
            >${t(locale, 'web.admin.comp.newSeason')}</a
          >
        </p>
      </section>
      <form class="card stack" method="post" action="/admin/${org.slug}/${competition.slug}">
        ${csrfField(data.csrf)}
        ${settingsSections(
          locale,
          GENERAL_SECTIONS,
          data.typed?.values ?? view.values,
          data.typed?.errors ?? {},
        )}
        <button type="submit">${t(locale, 'web.admin.org.save')}</button>
      </form>`,
  );
}
