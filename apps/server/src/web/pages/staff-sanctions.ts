import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import {
  TEAM_SANCTION_KINDS,
  type SeasonSanction,
  type TeamSanctionState,
} from '../../services/sanctions.ts';
import { csrfField, formatWhen, pageOf, type Html, type Page } from '../layout.ts';

// `/staff/sanctions` (phase 3f-4): the season's discipline in each league the viewer is staff of.
// Every form names its competition, and the services check staff and the team again.

export const SANCTIONS_DONE = ['added', 'excluded', 'reinstated', 'auto_off', 'auto_on'] as const;
export type SanctionsDone = (typeof SANCTIONS_DONE)[number];

const ERROR_KEYS = {
  no_season: 'sanction.error.no_season',
  team_not_found: 'sanction.error.team_not_found',
  reason_required: 'sanction.error.reason_required',
  points_required: 'sanction.error.points_required',
  points_not_allowed: 'sanction.error.points_not_allowed',
  already_excluded: 'exclusion.error.already_excluded',
  not_excluded: 'exclusion.error.not_excluded',
  already_set: 'exclusion.error.already_set',
} as const satisfies Record<string, MessageKey>;
export type SanctionsError = keyof typeof ERROR_KEYS;
export const isSanctionsError = (value: string | undefined): value is SanctionsError =>
  value !== undefined && Object.hasOwn(ERROR_KEYS, value);

export type SanctionsFlash = { done: SanctionsDone } | { error: SanctionsError } | null;

export interface LeagueSanctions {
  competitionId: number;
  name: string;
  timeZone: string;
  teams: TeamSanctionState[];
  sanctions: SeasonSanction[];
}

const KIND_KEYS: Record<string, MessageKey> = {
  warning: 'sanction.kind.warning',
  points: 'sanction.kind.points',
  exclusion: 'web.sanctions.kind.exclusion',
};

function teamSelect(locale: Locale, teams: readonly TeamSanctionState[]): Html {
  return html`<label
    >${t(locale, 'web.sanctions.team')}
    <select name="team" required>
      ${teams.map(
        (team) => html`<option value="${String(team.teamId)}">${team.name} [${team.tag}]</option>`,
      )}
    </select></label
  >`;
}

const reasonField = (locale: Locale) =>
  html`<label
    >${t(locale, 'web.sanctions.reason')}
    <textarea name="reason" maxlength="500" rows="2" required></textarea>
  </label>`;

function teamsTable(locale: Locale, teams: readonly TeamSanctionState[]): Html {
  return html`<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>${t(locale, 'web.sanctions.team')}</th>
          <th>${t(locale, 'web.sanctions.division')}</th>
          <th>${t(locale, 'web.sanctions.status')}</th>
          <th>${t(locale, 'web.sanctions.forfeits')}</th>
          <th>${t(locale, 'web.sanctions.auto')}</th>
        </tr>
      </thead>
      <tbody>
        ${teams.map(
          (team) =>
            html`<tr>
              <td>${team.name}</td>
              <td>${team.division}</td>
              <td>${t(locale, `web.sanctions.slot.${team.status}`)}</td>
              <td>${String(team.forfeits)}</td>
              <td>
                ${
                  team.autoExclusionOffReason === null
                    ? t(locale, 'web.sanctions.autoOn')
                    : t(locale, 'web.sanctions.autoOff', { reason: team.autoExclusionOffReason })
                }
              </td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

function sanctionsTable(locale: Locale, league: LeagueSanctions): Html {
  if (league.sanctions.length === 0) {
    return html`<p class="muted">${t(locale, 'web.sanctions.none')}</p>`;
  }
  return html`<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>${t(locale, 'web.sanctions.when')}</th>
          <th>${t(locale, 'web.sanctions.team')}</th>
          <th>${t(locale, 'web.sanctions.kind')}</th>
          <th>${t(locale, 'web.sanctions.reason')}</th>
        </tr>
      </thead>
      <tbody>
        ${league.sanctions.map((entry) => {
          const kind = KIND_KEYS[entry.kind];
          const label = kind ? t(locale, kind) : entry.kind;
          const points =
            entry.pointsDelta === null
              ? ''
              : ` (${entry.pointsDelta > 0 ? '+' : ''}${String(entry.pointsDelta)})`;
          const ended =
            entry.endsAt === null
              ? ''
              : ` — ${t(locale, 'web.sanctions.ended', {
                  when: formatWhen(locale, entry.endsAt, league.timeZone),
                })}`;
          return html`<tr>
            <td>${formatWhen(locale, entry.at, league.timeZone)}</td>
            <td>${entry.team}</td>
            <td>${label}${points}${ended}</td>
            <td>${entry.reason}</td>
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
}

function forms(locale: Locale, league: LeagueSanctions, csrf: string): Html {
  const base = `/staff/sanctions/${String(league.competitionId)}`;
  const active = league.teams.filter((team) => team.status === 'active');
  const excluded = league.teams.filter((team) => team.status === 'excluded');
  return html`<form class="card stack" method="post" action="${base}/add">
      ${csrfField(csrf)}
      <h3>${t(locale, 'web.sanctions.add')}</h3>
      ${teamSelect(locale, league.teams)}
      <label
        >${t(locale, 'web.sanctions.kind')}
        <select name="kind" required>
          ${TEAM_SANCTION_KINDS.map(
            (kind) => html`<option value="${kind}">${t(locale, `sanction.kind.${kind}`)}</option>`,
          )}
        </select></label
      >
      <label
        >${t(locale, 'web.sanctions.points')}
        <input type="number" name="points" min="-100" max="100" step="1"
      /></label>
      <p class="muted">${t(locale, 'web.sanctions.pointsHint')}</p>
      ${reasonField(locale)}
      <button type="submit">${t(locale, 'web.sanctions.addSave')}</button>
    </form>
    ${
      active.length === 0
        ? ''
        : html`<form class="card stack" method="post" action="${base}/exclude">
            ${csrfField(csrf)}
            <h3>${t(locale, 'web.sanctions.exclude')}</h3>
            ${teamSelect(locale, active)} ${reasonField(locale)}
            <p class="muted">${t(locale, 'web.sanctions.excludeHint')}</p>
            <button type="submit" class="danger">${t(locale, 'web.sanctions.excludeSave')}</button>
          </form>`
    }
    ${
      excluded.length === 0
        ? ''
        : html`<form class="card stack" method="post" action="${base}/reinstate">
            ${csrfField(csrf)}
            <h3>${t(locale, 'web.sanctions.reinstate')}</h3>
            ${teamSelect(locale, excluded)} ${reasonField(locale)}
            <button type="submit">${t(locale, 'web.sanctions.reinstateSave')}</button>
          </form>`
    }
    <form class="card stack" method="post" action="${base}/auto">
      ${csrfField(csrf)}
      <h3>${t(locale, 'web.sanctions.autoTitle')}</h3>
      ${teamSelect(locale, league.teams)}
      <label
        >${t(locale, 'web.sanctions.autoChoice')}
        <select name="enabled" required>
          <option value="off">${t(locale, 'web.sanctions.autoChoiceOff')}</option>
          <option value="on">${t(locale, 'web.sanctions.autoChoiceOn')}</option>
        </select></label
      >
      ${reasonField(locale)}
      <button type="submit">${t(locale, 'web.sanctions.autoSave')}</button>
    </form>`;
}

export function staffSanctionsPage(
  locale: Locale,
  data: { leagues: LeagueSanctions[]; csrf: string; flash: SanctionsFlash },
): Page {
  const { flash } = data;
  const flashView = !flash
    ? ''
    : 'done' in flash
      ? html`<p class="card flash">${t(locale, `web.sanctions.done.${flash.done}`)}</p>`
      : html`<p class="card flash error">${t(locale, ERROR_KEYS[flash.error])}</p>`;
  const body = html`<h1>${t(locale, 'web.sanctions.title')}</h1>
    <p><a href="/staff">${t(locale, 'web.sanctions.back')}</a></p>
    ${flashView}
    ${data.leagues.map(
      (league) =>
        html`<section id="c${String(league.competitionId)}">
          <h2>${league.name}</h2>
          ${
            league.teams.length === 0
              ? html`<p class="muted">${t(locale, 'web.sanctions.noSeason')}</p>`
              : html`${teamsTable(locale, league.teams)}
                  <h3>${t(locale, 'web.sanctions.history')}</h3>
                  ${sanctionsTable(locale, league)} ${forms(locale, league, data.csrf)}`
          }
        </section>`,
    )}`;
  return pageOf(t(locale, 'web.sanctions.title'), body);
}
