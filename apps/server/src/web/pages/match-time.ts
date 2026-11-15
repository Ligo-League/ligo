import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { PendingProposal } from '../../services/scheduling.ts';
import { csrfField, formatWhen, type Html } from '../layout.ts';

// The match page's time panel, for those who act for a side (officials and captain): the
// proposals waiting, the other side's to accept or decline, and a form to propose a time. The
// services check everything again on every POST.

export const TIME_DONE = ['proposed', 'proposed_unposted', 'accepted', 'declined'] as const;
export type TimeDone = (typeof TIME_DONE)[number];

const ERROR_KEYS = {
  not_linked: 'schedule.error.not_linked',
  no_team: 'schedule.error.no_team',
  match_not_found: 'schedule.error.match_not_found',
  not_your_match: 'schedule.error.not_your_match',
  not_schedulable: 'schedule.error.not_schedulable',
  in_past: 'schedule.error.in_past',
  outside_period: 'schedule.error.outside_period',
  stale: 'schedule.error.stale',
  not_opponent: 'schedule.error.not_opponent',
  invalid_date: 'schedule.error.invalid_date',
  invalid_time: 'schedule.error.invalid_time',
  nonexistent_time: 'schedule.error.nonexistent_time',
  team_excluded: 'schedule.error.team_excluded',
} as const satisfies Record<string, MessageKey>;
export type TimeError = keyof typeof ERROR_KEYS;
export const isTimeError = (value: string | undefined): value is TimeError =>
  value !== undefined && Object.hasOwn(ERROR_KEYS, value);

export type TimeFlash = { done: TimeDone } | { error: TimeError } | null;

export interface TimePanelData {
  matchId: number;
  /** The sides the viewer acts for: usually one; both for someone testing with two teams. */
  sides: ('a' | 'b')[];
  names: { a: string; b: string };
  proposals: PendingProposal[];
  /** The days a time may be proposed on, as the bot suggests them. */
  days: { date: string; weekday: number }[];
  timeZone: string;
  /** Whether the league posts proposals in its schedule channel (M-32). */
  posted: boolean;
  csrf: string;
  flash: TimeFlash;
}

function flashView(locale: Locale, flash: TimeFlash): Html | string {
  if (!flash) return '';
  return 'done' in flash
    ? html`<p class="card flash">${t(locale, `web.time.done.${flash.done}`)}</p>`
    : html`<p class="card flash error">${t(locale, ERROR_KEYS[flash.error])}</p>`;
}

function dayLabel(locale: Locale, date: string): string {
  // Noon UTC names the same calendar day in every European zone.
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(Date.parse(`${date}T12:00:00Z`));
}

export function timePanel(locale: Locale, data: TimePanelData): Html {
  const base = `/matches/${String(data.matchId)}/time`;
  const proposals =
    data.proposals.length === 0
      ? html`<p class="muted">${t(locale, 'web.time.none')}</p>`
      : html`<ul class="card">
          ${data.proposals.map((proposal) => {
            const answerable = data.sides.some((side) => side !== proposal.side);
            return html`<li>
              ${t(locale, 'web.time.proposal', {
                team: data.names[proposal.side],
                when: formatWhen(locale, proposal.at, data.timeZone),
                name: proposal.proposedBy,
              })}
              ${
                answerable
                  ? html`<span class="actions">
                      <form method="post" action="${base}/${proposal.id}/accept">
                        ${csrfField(data.csrf)}
                        <button type="submit">${t(locale, 'schedule.button.accept')}</button>
                      </form>
                      <form method="post" action="${base}/${proposal.id}/decline">
                        ${csrfField(data.csrf)}
                        <button type="submit" class="danger">
                          ${t(locale, 'schedule.button.decline')}
                        </button>
                      </form>
                    </span>`
                  : html`<span class="muted">· ${t(locale, 'web.time.waiting')}</span>`
              }
            </li>`;
          })}
        </ul>`;
  const form =
    data.days.length === 0
      ? html`<p class="muted">${t(locale, 'schedule.hint.nothingLeft')}</p>`
      : html`<form class="card" method="post" action="${base}/propose">
          ${csrfField(data.csrf)}
          <label
            >${t(locale, 'web.time.date')}
            <select name="date" required>
              ${data.days.map(
                (day) => html`<option value="${day.date}">${dayLabel(locale, day.date)}</option>`,
              )}
            </select></label
          >
          <label
            >${t(locale, 'web.time.time')} <input type="time" name="time" required value="21:00"
          /></label>
          <button type="submit">${t(locale, 'web.time.propose')}</button>
          <p class="muted">${t(locale, data.posted ? 'web.time.posted' : 'web.time.notPosted')}</p>
        </form>`;
  return html`<section id="time">
    <h2>${t(locale, 'web.time.title')}</h2>
    ${flashView(locale, data.flash)} ${proposals} ${form}
  </section>`;
}
