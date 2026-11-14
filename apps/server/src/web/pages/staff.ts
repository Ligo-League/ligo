import { html } from 'hono/html';
import { requestWhat } from '../../discord/request-text.ts';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { RequestView } from '../../services/requests.ts';
import { REQUEST_REASON_MAX_LENGTH } from '../../services/requests.ts';
import type { QueuedDispute, QueuedReport, StaffQueue } from '../../services/staff-queue.ts';
import { csrfField, formatWhen, pageOf, type Html, type Page } from '../layout.ts';

export interface LeagueQueue {
  name: string;
  timeZone: string;
  queue: StaffQueue;
}

export interface StaffData {
  leagues: LeagueQueue[];
  csrf: string;
  now: number;
  /** What the last form did, from the address it sent back to. */
  flash: { error: boolean; key: MessageKey } | null;
}

/** An address from the database becomes a link only when it is https. */
const safeLink = (url: string | null) => (url?.startsWith('https://') ? url : null);

function disputeBlock(locale: Locale, dispute: QueuedDispute, timeZone: string): Html {
  const reason = dispute.label
    ? (dispute.label[locale] ?? dispute.label.fr)
    : t(locale, 'dispute.reason.other');
  return html`<div class="dispute">
    <p>
      ${t(locale, 'web.staff.disputedBy', {
        name: dispute.raisedBy,
        when: formatWhen(locale, dispute.at, timeZone),
        reason,
      })}
    </p>
    ${dispute.details === null ? '' : html`<blockquote>${dispute.details}</blockquote>`}
  </div>`;
}

function reportItem(
  locale: Locale,
  report: QueuedReport,
  data: Pick<StaffData, 'csrf'>,
  timeZone: string,
): Html {
  const { match } = report;
  const line = match.game
    ? t(locale, 'match.line', {
        division: match.division?.name ?? '—',
        week: match.week ?? '?',
        teamA: match.a.name,
        teamB: match.b.name,
        scoreA: match.game.scoreA,
        scoreB: match.game.scoreB,
      })
    : t(locale, 'match.fixture', {
        division: match.division?.name ?? '—',
        week: match.week ?? '?',
        teamA: match.a.name,
        teamB: match.b.name,
      });
  const { evidence } = report;
  // Reports from before the server kept copies only have the bot's post in Discord.
  const screenshot = evidence?.kept ? null : safeLink(evidence?.url ?? null);
  // The decision applies to the report shown: a newer one makes it stale.
  const decide = (decision: 'validate' | 'reject', label: MessageKey, danger: boolean) =>
    html`<form method="post" action="/staff/matches/${match.id}/${decision}">
      ${csrfField(data.csrf)}
      <input type="hidden" name="evidence" value="${report.evidence?.id ?? ''}" />
      <button type="submit" ${danger ? html`class="danger"` : ''}>${t(locale, label)}</button>
    </form>`;
  return html`<li class="card queue-item">
    <p><strong>${line}</strong></p>
    <p class="muted">
      ${t(locale, 'web.staff.reported', {
        name: report.reportedBy ?? '?',
        team: report.reportingTeam ?? '?',
        when: report.evidence ? formatWhen(locale, report.evidence.at, timeZone) : '?',
      })}
      ${
        match.status === 'confirmed'
          ? t(locale, 'web.staff.confirmed')
          : match.status === 'reported'
            ? t(locale, 'web.staff.awaitingOpponent')
            : ''
      }
    </p>
    ${
      evidence?.kept
        ? html`<a class="shot" href="/evidence/${evidence.id}" target="_blank" rel="noreferrer">
            <img
              src="/evidence/${evidence.id}"
              alt="${t(locale, 'web.staff.screenshotAlt', { line })}"
              loading="lazy"
            />
          </a>`
        : ''
    }
    ${report.disputes.map((dispute) => disputeBlock(locale, dispute, timeZone))}
    <p>
      ${
        screenshot
          ? html`<a href="${screenshot}" rel="noreferrer">${t(locale, 'web.staff.screenshot')}</a>
              ·`
          : ''
      }
      <a href="/matches/${match.id}">${t(locale, 'web.staff.matchPage')}</a>
    </p>
    <div class="actions">
      ${decide('validate', 'web.staff.validate', false)}
      ${decide('reject', 'web.staff.reject', true)}
    </div>
  </li>`;
}

function requestItem(
  locale: Locale,
  request: RequestView,
  data: Pick<StaffData, 'csrf' | 'now'>,
  timeZone: string,
): Html {
  const deadline =
    request.deadline === null
      ? ''
      : html`<span class="${request.deadline < data.now ? 'overdue' : ''}"
          >${t(
            locale,
            request.deadline < data.now
              ? 'web.staff.request.overdue'
              : 'web.staff.request.deadline',
            { deadline: formatWhen(locale, request.deadline, timeZone) },
          )}</span
        >`;
  const action = `/staff/requests/${String(request.id)}`;
  return html`<li class="card queue-item">
    <p>
      <strong
        >${t(locale, 'web.staff.request.title', {
          id: request.id,
          team: request.team.name,
          tag: request.team.tag,
        })}</strong
      >
    </p>
    <p>${requestWhat(locale, request, (person) => person.displayName)}</p>
    <p class="muted">
      ${t(locale, 'web.staff.request.by', {
        name: request.requester.displayName,
        when: formatWhen(locale, request.requestedAt, timeZone),
      })}
      ${deadline}
    </p>
    ${request.note === null ? '' : html`<blockquote>${request.note}</blockquote>`}
    <div class="actions">
      <form method="post" action="${action}/approve">
        ${csrfField(data.csrf)}
        <button type="submit">${t(locale, 'web.staff.approve')}</button>
      </form>
      <form method="post" action="${action}/reject" class="refuse">
        ${csrfField(data.csrf)}
        <label for="reason-${request.id}">${t(locale, 'web.staff.reason')}</label>
        <textarea
          id="reason-${request.id}"
          name="reason"
          rows="2"
          maxlength="${REQUEST_REASON_MAX_LENGTH}"
          required
        ></textarea>
        <button type="submit" class="danger">${t(locale, 'web.staff.refuse')}</button>
      </form>
    </div>
  </li>`;
}

function section<T>(
  locale: Locale,
  title: MessageKey,
  items: readonly T[],
  render: (item: T) => Html,
): Html {
  return html`<h3>${t(locale, title, { count: items.length })}</h3>
    ${
      items.length === 0
        ? html`<p class="muted">${t(locale, 'web.staff.none')}</p>`
        : html`<ul class="queue">
            ${items.map(render)}
          </ul>`
    }`;
}

/** `/staff`: what waits for league staff, in every league the viewer is staff of. */
export function staffPage(locale: Locale, data: StaffData): Page {
  const flash = data.flash
    ? html`<p class="card flash ${data.flash.error ? 'error' : ''}">
        ${t(locale, data.flash.key)}
      </p>`
    : '';
  const body = html`<h1>${t(locale, 'web.staff.title')}</h1>
    ${flash}
    ${data.leagues.map(
      ({ name, timeZone, queue }) =>
        html`<h2>${name}</h2>
          ${section(locale, 'web.staff.reports', queue.reports, (report) =>
            reportItem(locale, report, data, timeZone),
          )}
          ${section(locale, 'web.staff.disputed', queue.disputed, (report) =>
            reportItem(locale, report, data, timeZone),
          )}
          ${section(locale, 'web.staff.requests', queue.requests, (request) =>
            requestItem(locale, request, data, timeZone),
          )}`,
    )}`;
  return pageOf(t(locale, 'web.staff.title'), body);
}
