import type { ForfeitThresholds, GameScoreSettings } from '@ligo/core';
import { html } from 'hono/html';
import { impossibleScore } from '../../discord/match-text.ts';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import { csrfField, type Html } from '../layout.ts';

// The match page's staff panel (phase 3f), for league staff only: enter or correct the result,
// validate or refuse the report waiting, record a forfeit, annul the match. The services check
// staff and the match's state again on every POST.

export const STAFF_DONE = ['entered', 'validated', 'rejected', 'voided', 'forfeited'] as const;
export type StaffDone = (typeof STAFF_DONE)[number];

const ERROR_KEYS = {
  not_linked: 'match.error.not_linked',
  match_not_found: 'match.error.match_not_found',
  match_closed: 'web.staffMatch.error.match_closed',
  unsupported_series: 'match.error.unsupported_series',
  invalid_score: 'match.error.invalid_score',
  impossible_score: 'match.error.impossible_score',
  invalid_screenshot: 'match.error.invalid_screenshot',
  screenshot_unstored: 'match.error.screenshot_unstored',
  stale: 'match.error.stale',
  wrong_status: 'match.error.wrong_status',
  reason_required: 'match.error.reason_required',
} as const satisfies Record<string, MessageKey>;
export type StaffError = keyof typeof ERROR_KEYS;
export const isStaffError = (value: string | undefined): value is StaffError =>
  value !== undefined && Object.hasOwn(ERROR_KEYS, value);

export type StaffFlash = { done: StaffDone } | { error: StaffError } | null;

export interface StaffPanelData {
  matchId: number;
  names: { a: string; b: string };
  /** Whether a result can be entered, and whether it would correct one already counted. */
  entry: { correcting: boolean } | null;
  /** The report waiting for staff, by its screenshot's evidence row. */
  report: { evidenceId: number; score: { a: number; b: number } | null } | null;
  forfeit: {
    counts: { a: number; b: number };
    thresholds: ForfeitThresholds | null;
  } | null;
  canVoid: boolean;
  gameScore: GameScoreSettings | null;
  csrf: string;
  flash: StaffFlash;
}

function flashView(locale: Locale, data: StaffPanelData): Html | string {
  const { flash } = data;
  if (!flash) return '';
  if ('done' in flash) {
    return html`<p class="card flash">${t(locale, `web.staffMatch.done.${flash.done}`)}</p>`;
  }
  const text =
    flash.error === 'impossible_score' && data.gameScore
      ? impossibleScore(locale, data.gameScore)
      : t(locale, ERROR_KEYS[flash.error]);
  return html`<p class="card flash error">${text}</p>`;
}

const action = (data: StaffPanelData, what: string) =>
  `/matches/${String(data.matchId)}/staff/${what}`;

function reportForms(
  locale: Locale,
  data: StaffPanelData,
  report: NonNullable<StaffPanelData['report']>,
): Html {
  const evidence = html`<input
    type="hidden"
    name="evidence"
    value="${String(report.evidenceId)}"
  />`;
  const line = report.score
    ? t(locale, 'web.report.line', {
        a: data.names.a,
        b: data.names.b,
        scoreA: report.score.a,
        scoreB: report.score.b,
      })
    : '';
  return html`<div class="card">
    <h3>${t(locale, 'web.staffMatch.report')}</h3>
    <p><strong>${line}</strong></p>
    <form method="post" action="${action(data, 'validate')}">
      ${csrfField(data.csrf)} ${evidence}
      <button type="submit">${t(locale, 'report.button.validate')}</button>
    </form>
    <form method="post" action="${action(data, 'reject')}">
      ${csrfField(data.csrf)} ${evidence}
      <button type="submit" class="danger">${t(locale, 'report.button.reject')}</button>
    </form>
  </div>`;
}

function entryForm(locale: Locale, data: StaffPanelData, correcting: boolean): Html {
  return html`<form
    class="card"
    method="post"
    action="${action(data, 'result')}"
    enctype="multipart/form-data"
  >
    ${csrfField(data.csrf)}
    <h3>${t(locale, correcting ? 'web.staffMatch.correct' : 'web.staffMatch.enter')}</h3>
    <label
      >${t(locale, 'web.report.score', { team: data.names.a })}
      <input type="number" name="score_a" min="0" max="99" required
    /></label>
    <label
      >${t(locale, 'web.report.score', { team: data.names.b })}
      <input type="number" name="score_b" min="0" max="99" required
    /></label>
    <label
      >${t(locale, 'web.staffMatch.screenshot')}
      <input type="file" name="screenshot" accept="image/png,image/jpeg,image/webp"
    /></label>
    <p class="muted">${t(locale, 'web.staffMatch.entryHint')}</p>
    <button type="submit">${t(locale, 'web.staffMatch.save')}</button>
  </form>`;
}

function forfeitForm(
  locale: Locale,
  data: StaffPanelData,
  forfeit: NonNullable<StaffPanelData['forfeit']>,
): Html {
  const warning = forfeit.thresholds?.warning_at ?? null;
  const exclusion = forfeit.thresholds?.exclusion_at ?? null;
  const rule =
    exclusion === null
      ? ''
      : warning === null
        ? t(locale, 'web.staffMatch.exclusionAt', { exclusion })
        : t(locale, 'web.staffMatch.thresholds', { warning, exclusion });
  return html`<form class="card" method="post" action="${action(data, 'forfeit')}">
    ${csrfField(data.csrf)}
    <h3>${t(locale, 'web.staffMatch.forfeit')}</h3>
    <p class="muted">
      ${t(locale, 'web.staffMatch.count', { team: data.names.a, count: forfeit.counts.a })} ·
      ${t(locale, 'web.staffMatch.count', { team: data.names.b, count: forfeit.counts.b })}
    </p>
    ${rule ? html`<p class="muted">${rule}</p>` : ''}
    <label
      >${t(locale, 'web.staffMatch.forfeitSide')}
      <select name="side" required>
        <option value="a">${data.names.a}</option>
        <option value="b">${data.names.b}</option>
        <option value="both">${t(locale, 'web.staffMatch.forfeitBoth')}</option>
      </select></label
    >
    <button type="submit" class="danger">${t(locale, 'web.staffMatch.forfeitSave')}</button>
  </form>`;
}

function voidForm(locale: Locale, data: StaffPanelData): Html {
  return html`<form class="card" method="post" action="${action(data, 'void')}">
    ${csrfField(data.csrf)}
    <h3>${t(locale, 'web.staffMatch.void')}</h3>
    <label
      >${t(locale, 'web.staffMatch.voidReason')}
      <textarea name="reason" maxlength="500" rows="2" required></textarea>
    </label>
    <p class="muted">${t(locale, 'web.staffMatch.voidHint')}</p>
    <button type="submit" class="danger">${t(locale, 'web.staffMatch.voidSave')}</button>
  </form>`;
}

export function staffPanel(locale: Locale, data: StaffPanelData): Html {
  return html`<section id="staff">
    <h2>${t(locale, 'web.staffMatch.title')}</h2>
    ${flashView(locale, data)} ${data.report ? reportForms(locale, data, data.report) : ''}
    ${data.entry ? entryForm(locale, data, data.entry.correcting) : ''}
    ${data.forfeit ? forfeitForm(locale, data, data.forfeit) : ''}
    ${data.canVoid ? voidForm(locale, data) : ''}
  </section>`;
}
