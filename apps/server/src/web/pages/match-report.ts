import type { DisputeReason, GameScoreSettings } from '@ligo/core';
import { OTHER_DISPUTE_REASON } from '@ligo/core';
import { html } from 'hono/html';
import { impossibleScore, reasonLabel } from '../../discord/match-text.ts';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import { DISPUTE_DETAILS_MAX_LENGTH } from '../../services/reports.ts';
import { csrfField, type Html } from '../layout.ts';

// The match page's result panel, for those who act for a side (officials and captain): report
// the result with the scoreboard screenshot, then the other side confirms or disputes it, as with
// `/match report` and its buttons. The services check everything again on every POST.

export const REPORT_DONE = [
  'reported',
  'reported_unposted',
  'confirmed',
  'validated',
  'disputed',
] as const;
export type ReportDone = (typeof REPORT_DONE)[number];

const ERROR_KEYS = {
  not_linked: 'match.error.not_linked',
  no_team: 'match.error.no_team',
  match_not_found: 'match.error.match_not_found',
  not_your_match: 'match.error.not_your_match',
  not_reportable: 'match.error.not_reportable',
  team_excluded: 'match.error.team_excluded',
  unsupported_series: 'match.error.unsupported_series',
  invalid_score: 'match.error.invalid_score',
  impossible_score: 'match.error.impossible_score',
  screenshot_required: 'match.error.screenshot_required',
  invalid_screenshot: 'match.error.invalid_screenshot',
  screenshot_unreadable: 'match.error.screenshot_unreadable',
  screenshot_unstored: 'match.error.screenshot_unstored',
  queue_not_set: 'match.error.queue_not_set',
  stale: 'match.error.stale',
  not_opponent: 'match.error.not_opponent',
  wrong_status: 'match.error.wrong_status',
  reason_unknown: 'match.error.reason_unknown',
  details_required: 'match.error.details_required',
  details_too_long: 'match.error.details_too_long',
} as const satisfies Record<string, MessageKey>;
export type ReportError = keyof typeof ERROR_KEYS;
export const isReportError = (value: string | undefined): value is ReportError =>
  value !== undefined && Object.hasOwn(ERROR_KEYS, value);

export type ReportFlash = { done: ReportDone } | { error: ReportError } | null;

type Side = 'a' | 'b';

export interface ReportPanelData {
  matchId: number;
  /** The sides the viewer acts for: usually one; both for someone testing with two teams. */
  sides: Side[];
  names: { a: string; b: string };
  /** The report waiting for an answer or for staff; null while the match is to be reported. */
  report: {
    evidenceId: number;
    side: Side | null;
    score: { a: number; b: number } | null;
    status: 'reported' | 'confirmed' | 'disputed';
    /** Whether the server has its own copy of the screenshot to show. */
    shown: boolean;
  } | null;
  reasons: readonly DisputeReason[];
  gameScore: GameScoreSettings | null;
  /** Whether the league posts the report in its schedule channel (M-32). */
  posted: boolean;
  csrf: string;
  flash: ReportFlash;
}

function flashView(locale: Locale, data: ReportPanelData): Html | string {
  const { flash } = data;
  if (!flash) return '';
  if ('done' in flash) {
    return html`<p class="card flash">${t(locale, `web.report.done.${flash.done}`)}</p>`;
  }
  const text =
    flash.error === 'impossible_score' && data.gameScore
      ? impossibleScore(locale, data.gameScore)
      : t(locale, ERROR_KEYS[flash.error], { max: DISPUTE_DETAILS_MAX_LENGTH });
  return html`<p class="card flash error">${text}</p>`;
}

function reportForm(locale: Locale, data: ReportPanelData): Html {
  return html`<form
    class="card"
    method="post"
    action="/matches/${String(data.matchId)}/report"
    enctype="multipart/form-data"
  >
    ${csrfField(data.csrf)}
    <label
      >${t(locale, 'web.report.score', { team: data.names.a })}
      <input type="number" name="score_a" min="0" max="99" required
    /></label>
    <label
      >${t(locale, 'web.report.score', { team: data.names.b })}
      <input type="number" name="score_b" min="0" max="99" required
    /></label>
    <label
      >${t(locale, 'web.report.screenshot')}
      <input type="file" name="screenshot" accept="image/png,image/jpeg,image/webp" required
    /></label>
    <p class="muted">${t(locale, 'web.report.screenshotHint')}</p>
    <button type="submit">${t(locale, 'web.report.send')}</button>
    <p class="muted">${t(locale, data.posted ? 'web.report.posted' : 'web.report.notPosted')}</p>
  </form>`;
}

function answerForms(locale: Locale, data: ReportPanelData, evidenceId: number): Html {
  const base = `/matches/${String(data.matchId)}/report/${String(evidenceId)}`;
  return html`<form method="post" action="${base}/confirm" class="card">
      ${csrfField(data.csrf)}
      <button type="submit">${t(locale, 'report.button.confirm')}</button>
    </form>
    <form method="post" action="${base}/dispute" class="card">
      ${csrfField(data.csrf)}
      <h3>${t(locale, 'dispute.form.title')}</h3>
      <label
        >${t(locale, 'dispute.form.reason')}
        <select name="reason" required>
          ${data.reasons.map(
            (reason) => html`<option value="${reason.key}">${reasonLabel(locale, reason)}</option>`,
          )}
          <option value="${OTHER_DISPUTE_REASON}">${t(locale, 'dispute.reason.other')}</option>
        </select></label
      >
      <label
        >${t(locale, 'dispute.form.details')}
        <textarea name="details" maxlength="${DISPUTE_DETAILS_MAX_LENGTH}" rows="3"></textarea>
      </label>
      <p class="muted">${t(locale, 'dispute.form.detailsHint')}</p>
      <button type="submit" class="danger">${t(locale, 'report.button.dispute')}</button>
    </form>`;
}

function reportView(
  locale: Locale,
  data: ReportPanelData,
  report: NonNullable<ReportPanelData['report']>,
): Html {
  const line = report.score
    ? t(locale, 'web.report.line', {
        a: data.names.a,
        b: data.names.b,
        scoreA: report.score.a,
        scoreB: report.score.b,
      })
    : '';
  const by = report.side ? t(locale, 'web.report.by', { team: data.names[report.side] }) : '';
  // Someone acting for both sides may confirm their own report, as in Discord.
  const answers = report.status === 'reported' && data.sides.some((side) => side !== report.side);
  return html`<div class="card">
      <p><strong>${line}</strong> <span class="muted">${by}</span></p>
      <p class="muted">${t(locale, `web.report.status.${report.status}`)}</p>
      ${
        report.shown
          ? html`<a
              class="shot"
              href="/evidence/${String(report.evidenceId)}"
              target="_blank"
              rel="noreferrer"
              ><img
                src="/evidence/${String(report.evidenceId)}"
                alt="${t(locale, 'web.report.screenshotAlt')}"
            /></a>`
          : ''
      }
    </div>
    ${answers ? answerForms(locale, data, report.evidenceId) : ''}`;
}

export function reportPanel(locale: Locale, data: ReportPanelData): Html {
  return html`<section id="result">
    <h2>${t(locale, 'web.report.title')}</h2>
    ${flashView(locale, data)}
    ${data.report ? reportView(locale, data, data.report) : reportForm(locale, data)}
  </section>`;
}
