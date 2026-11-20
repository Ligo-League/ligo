import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { ScheduleAdminView, ScheduleDivision } from '../../services/schedule.ts';
import { csrfField, formatDay, pageOf, type Html, type Page } from '../layout.ts';

// A season's schedule in the admin panel (phase 4; design doc section 5, M-45): each division's
// draft, with its weeks to mark and the calendar it gives, then publishing.

export const SCHEDULE_DONE = ['draft', 'reshuffle', 'publish'] as const;
export type ScheduleDone = (typeof SCHEDULE_DONE)[number];
export const SCHEDULE_ERRORS = [
  'overrun',
  'published',
  'no_draft',
  'invalid',
  'too_few_teams',
  'too_many_teams',
] as const;
export type ScheduleError = (typeof SCHEDULE_ERRORS)[number];

type View = Extract<ScheduleAdminView, { ok: true }>;

export interface SchedulePageData {
  view: View;
  /** What was just done, or refused, and in which division. */
  done: ScheduleDone | null;
  error: { code: ScheduleError; divisionId: number } | null;
  csrf: string;
}

const ERROR_KEYS = {
  overrun: 'web.admin.schedule.error.overrun',
  published: 'web.admin.schedule.error.published',
  no_draft: 'web.admin.schedule.error.no_draft',
  invalid: 'web.admin.schedule.error.invalid',
  too_few_teams: 'web.admin.schedule.problem.too_few_teams',
  too_many_teams: 'web.admin.schedule.problem.too_many_teams',
} as const satisfies Record<ScheduleError, MessageKey>;

/** A calendar date (`YYYY-MM-DD`) as the other pages show a day. */
const day = (locale: Locale, date: string) =>
  formatDay(locale, Date.parse(`${date}T12:00:00Z`), 'UTC');

function draftForm(locale: Locale, base: string, csrf: string, division: ScheduleDivision): Html {
  return html`<form class="stack" method="post" action="${base}/${String(division.id)}/draft">
    ${csrfField(csrf)}
    <label
      >${t(locale, 'web.admin.schedule.bestOf')}
      <select name="best_of">
        ${([1, 3, 5] as const).map(
          (n) =>
            html`<option value="${String(n)}" ${division.bestOf === n ? 'selected' : ''}>
              ${t(locale, 'web.admin.schedule.bo', { n: String(n) })}
            </option>`,
        )}
      </select></label
    >
    <table>
      <thead>
        <tr>
          <th>${t(locale, 'web.admin.schedule.weeks')}</th>
          <th>${t(locale, 'web.admin.schedule.off')}</th>
          <th>${t(locale, 'web.admin.schedule.extra')}</th>
          <th>${t(locale, 'web.admin.schedule.playWeekHead')}</th>
        </tr>
      </thead>
      <tbody>
        ${division.calendarWeeks.map(
          (week) =>
            html`<tr>
              <td>
                ${t(locale, 'web.admin.schedule.weekOf', { day: day(locale, week.firstDay) })}
              </td>
              <td>
                <input
                  type="checkbox"
                  name="off[]"
                  value="${week.firstDay}"
                  aria-label="${t(locale, 'web.admin.schedule.off')}"
                  ${week.off ? 'checked' : ''}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  name="extra[]"
                  value="${week.firstDay}"
                  aria-label="${t(locale, 'web.admin.schedule.extra')}"
                  ${week.extra ? 'checked' : ''}
                />
              </td>
              <td>${week.playWeek === null ? '—' : `w${String(week.playWeek)}`}</td>
            </tr>`,
        )}
      </tbody>
    </table>
    <button type="submit">
      ${t(
        locale,
        division.status === 'none' ? 'web.admin.schedule.create' : 'web.admin.schedule.save',
      )}
    </button>
  </form>`;
}

function preview(locale: Locale, base: string, csrf: string, division: ScheduleDivision): Html {
  const drawn = division.preview;
  if (!drawn) return html``;
  return html`<h3>${t(locale, 'web.admin.schedule.preview')}</h3>
    <ol class="stack">
      ${drawn.weeks.map(
        (week) =>
          html`<li>
            <strong
              >${t(locale, 'web.admin.schedule.week', {
                week: String(week.week),
                day: day(locale, week.firstDay),
              })}</strong
            >
            <ul>
              ${week.matches.map((entry) => html`<li>${entry.a.name} – ${entry.b.name}</li>`)}
              ${week.rests.map(
                (team) =>
                  html`<li class="muted">
                    ${t(locale, 'web.admin.schedule.rest', { team: team.name })}
                  </li>`,
              )}
            </ul>
          </li>`,
      )}
    </ol>
    <p>${t(locale, 'web.admin.schedule.lastDay', { day: day(locale, drawn.lastDay) })}</p>
    <form class="stack" method="post" action="${base}/${String(division.id)}/reshuffle">
      ${csrfField(csrf)}
      <p class="muted">${t(locale, 'web.admin.schedule.reshuffleHelp')}</p>
      <button type="submit">${t(locale, 'web.admin.schedule.reshuffle')}</button>
    </form>
    <form class="stack" method="post" action="${base}/${String(division.id)}/publish">
      ${csrfField(csrf)}
      ${
        drawn.overrun
          ? html`<p class="card flash error">${t(locale, 'web.admin.schedule.overrun')}</p>
              <label
                ><input type="checkbox" name="accept_overrun" value="yes" />
                ${t(locale, 'web.admin.schedule.acceptOverrun')}</label
              >`
          : ''
      }
      <p class="muted">${t(locale, 'web.admin.schedule.publishHelp')}</p>
      <button type="submit">${t(locale, 'web.admin.schedule.publish')}</button>
    </form>`;
}

function divisionCard(
  locale: Locale,
  base: string,
  data: SchedulePageData,
  division: ScheduleDivision,
) {
  const error = data.error?.divisionId === division.id ? data.error.code : null;
  const status =
    division.status === 'published' && division.published
      ? t(locale, 'web.admin.schedule.status.published', {
          matches: String(division.published.matches),
          weeks: String(division.published.weeks),
        })
      : t(locale, `web.admin.schedule.status.${division.status === 'draft' ? 'draft' : 'none'}`);
  return html`<section class="card stack" id="division-${String(division.id)}">
    <h2>${division.name}</h2>
    <p>
      ${status} ${t(locale, 'web.admin.schedule.teams', { count: String(division.teams.length) })}
    </p>
    ${error ? html`<p class="card flash error">${t(locale, ERROR_KEYS[error])}</p>` : ''}
    ${
      division.status !== 'published' && division.problem
        ? html`<p class="muted">${t(locale, ERROR_KEYS[division.problem])}</p>`
        : ''
    }
    ${
      division.status !== 'published' && !division.problem
        ? html`${draftForm(locale, base, data.csrf, division)}
          ${preview(locale, base, data.csrf, division)}`
        : ''
    }
  </section>`;
}

export function schedulePageView(locale: Locale, data: SchedulePageData): Page {
  const { org, competition, season, divisions } = data.view;
  const seasonPage = `/admin/${org.slug}/${competition.slug}/seasons/${String(season.id)}`;
  const base = `${seasonPage}/schedule`;
  const title = t(locale, 'web.admin.schedule.title', { season: season.name });
  return pageOf(
    title,
    html`<p>
        <a href="/admin/${org.slug}/${competition.slug}">${competition.name}</a> ·
        <a href="${seasonPage}">${season.name}</a>
      </p>
      <h1>${title}</h1>
      <p class="muted">
        ${t(locale, 'web.admin.schedule.intro', {
          start: day(locale, season.startsOn),
          end: day(locale, season.endsOn),
        })}
      </p>
      ${
        data.done
          ? html`<p class="card flash">${t(locale, `web.admin.schedule.done.${data.done}`)}</p>`
          : ''
      }
      ${
        divisions.length === 0
          ? html`<p class="muted">${t(locale, 'web.admin.season.noDivision')}</p>`
          : divisions.map((division) => divisionCard(locale, base, data, division))
      }`,
  );
}
