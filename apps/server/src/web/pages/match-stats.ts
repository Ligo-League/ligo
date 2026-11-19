import type { CellError, SideError } from '@ligo/titles';
import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { SheetCheck, SideSheetView, StatGridView } from '../../services/stat-sheets.ts';
import { csrfField, pageOf, type Html, type Page } from '../layout.ts';

// The manual stat grid (design doc section 7; M-39): one tab per game of the match, one grid
// per side. Typing asks the server to check the side (htmx) without storing anything; pasting
// rows copied from a spreadsheet fills several cells (`/static/stat-paste.js`). Without
// scripts, the forms still save, and the server checks everything again.

export const STATS_DONE = ['saved_own', 'saved_opponent', 'saved_staff', 'confirmed'] as const;
export type StatsDone = (typeof STATS_DONE)[number];

const ERROR_KEYS = {
  not_found: 'web.stats.error.not_allowed',
  not_allowed: 'web.stats.error.not_allowed',
  no_stats: 'web.stats.error.not_allowed',
  no_game: 'web.stats.error.no_game',
  invalid: 'web.stats.error.invalid',
  nothing_to_confirm: 'web.stats.error.nothing_to_confirm',
  no_result: 'web.stats.lock.no_result',
  forfeit: 'web.stats.lock.forfeit',
  void: 'web.stats.lock.void',
  replay: 'web.stats.lock.replay',
  deadline: 'web.stats.lock.deadline',
} as const satisfies Record<string, MessageKey>;
export type StatsError = keyof typeof ERROR_KEYS;
export const isStatsError = (value: string | undefined): value is StatsError =>
  value !== undefined && Object.hasOwn(ERROR_KEYS, value);

export type StatsFlash = { done: StatsDone } | { error: StatsError } | null;

type GridView = Extract<StatGridView, { ok: true }>;
type Metric = GridView['metrics'][number];

export interface StatsPageData {
  view: GridView;
  csrf: string;
  flash: StatsFlash;
  /** A save refused by the checks: the side's values as typed, and what is wrong with them. */
  typed: { side: 'a' | 'b'; values: Map<number, Record<string, string>>; check: SheetCheck } | null;
}

const base = (view: GridView) => `/matches/${String(view.match.id)}/stats`;
const sideUrl = (view: GridView, side: 'a' | 'b') => `${base(view)}/${String(view.game.n)}/${side}`;

const shown = (value: number | null | undefined) =>
  value === null || value === undefined ? '' : String(value);

function cellText(locale: Locale, error: CellError | SideError, label: string): string {
  switch (error.error) {
    case 'required':
      return t(locale, 'web.stats.cell.required', { metric: label });
    case 'not_integer':
      return t(locale, 'web.stats.cell.not_integer', { metric: label });
    case 'below_min':
      return t(locale, 'web.stats.cell.below_min', { metric: label, limit: error.limit });
    case 'above_max':
      return t(locale, 'web.stats.cell.above_max', { metric: label, limit: error.limit });
    case 'side_above_max':
      return t(locale, 'web.stats.cell.side_above_max', {
        metric: label,
        total: error.total,
        limit: error.limit,
      });
  }
}

/** What is wrong with a side as typed, line by line; empty when nothing is. */
export function checkList(
  locale: Locale,
  view: GridView,
  side: 'a' | 'b',
  check: SheetCheck | null,
): Html {
  const label = (key: string) =>
    view.metrics.find((metric) => metric.key === key)?.label[locale] ?? key;
  const names = new Map(
    (view.sides.find((entry) => entry.side === side)?.rows ?? []).map((row) => [
      row.playerId,
      row.name,
    ]),
  );
  const lines: string[] = [];
  if (check) {
    for (const [playerId, errors] of check.rows) {
      for (const error of errors) {
        lines.push(
          `${names.get(playerId) ?? '?'} — ${cellText(locale, error, label(error.metric))}`,
        );
      }
    }
    for (const error of check.side) lines.push(cellText(locale, error, label(error.metric)));
    if (check.unknown.length > 0) lines.push(t(locale, 'web.stats.cell.unknown'));
  }
  return html`<div id="check-${side}" class="check" aria-live="polite">
    ${
      lines.length > 0
        ? html`<ul class="error">
            ${lines.map((line) => html`<li>${line}</li>`)}
          </ul>`
        : ''
    }
  </div>`;
}

function entryLine(locale: Locale, sheet: SideSheetView): string {
  const { entry } = sheet;
  if (!entry) return t(locale, 'web.stats.entry.none');
  if (entry.enteredAs === 'staff')
    return t(locale, 'web.stats.entry.staff', { name: entry.enteredBy });
  if (entry.enteredAs === 'own') return t(locale, 'web.stats.entry.own', { name: entry.enteredBy });
  return entry.confirmed
    ? t(locale, 'web.stats.entry.confirmed', { name: entry.enteredBy, team: sheet.team })
    : t(locale, 'web.stats.entry.waiting', { name: entry.enteredBy, team: sheet.team });
}

function header(locale: Locale, metrics: readonly Metric[]): Html {
  return html`<thead>
    <tr>
      <th scope="col">${t(locale, 'web.stats.player')}</th>
      ${metrics.map(
        (metric) =>
          html`<th scope="col">
            ${metric.label[locale]}${metric.optional ? html` <small class="muted">${t(locale, 'web.stats.optional')}</small>` : ''}
          </th>`,
      )}
    </tr>
  </thead>`;
}

const playerCell = (locale: Locale, row: SideSheetView['rows'][number]) =>
  html`<th scope="row">
    ${row.name}${row.role === 'sub' ? html` <small class="muted">${t(locale, 'web.stats.sub')}</small>` : ''}
  </th>`;

function sideSection(locale: Locale, data: StatsPageData, sheet: SideSheetView): Html {
  const { view } = data;
  const typed = data.typed?.side === sheet.side ? data.typed : null;
  const flagged = (playerId: number, key: string) =>
    typed?.check.rows.get(playerId)?.some((error) => error.metric === key) ?? false;
  const table = sheet.canEdit
    ? html`<table class="stat-grid" data-stat-grid>
        ${header(locale, view.metrics)}
        <tbody>
          ${sheet.rows.map(
            (row, r) =>
              html`<tr>
                ${playerCell(locale, row)}
                ${view.metrics.map(
                  (metric, col) =>
                    html`<td>
                      <input
                        name="v.${String(row.playerId)}.${metric.key}"
                        value="${typed ? (typed.values.get(row.playerId)?.[metric.key] ?? '') : shown(row.values[metric.key])}"
                        inputmode="numeric"
                        size="3"
                        autocomplete="off"
                        aria-label="${row.name} — ${metric.label[locale]}"
                        data-row="${String(r)}"
                        data-col="${String(col)}"
                        ${flagged(row.playerId, metric.key) ? html`aria-invalid="true"` : ''}
                      />
                    </td>`,
                )}
              </tr>`,
          )}
        </tbody>
      </table>`
    : html`<table class="stat-grid">
        ${header(locale, view.metrics)}
        <tbody>
          ${sheet.rows.map(
            (row) =>
              html`<tr>
                ${playerCell(locale, row)}
                ${view.metrics.map((metric) => html`<td>${shown(row.values[metric.key])}</td>`)}
              </tr>`,
          )}
        </tbody>
      </table>`;
  const form = sheet.canEdit
    ? html`<form
        method="post"
        action="${sideUrl(view, sheet.side)}"
        hx-post="${sideUrl(view, sheet.side)}/check"
        hx-trigger="input delay:500ms"
        hx-target="#check-${sheet.side}"
        hx-swap="outerHTML"
      >
        ${csrfField(data.csrf)} ${table}
        ${checkList(locale, view, sheet.side, typed?.check ?? null)}
        <button type="submit">${t(locale, 'web.stats.save')}</button>
      </form>`
    : table;
  const confirm = sheet.canConfirm
    ? html`<form method="post" action="${sideUrl(view, sheet.side)}/confirm">
        ${csrfField(data.csrf)}
        <button type="submit">${t(locale, 'web.stats.confirm', { team: sheet.team })}</button>
      </form>`
    : '';
  return html`<section class="card" id="side-${sheet.side}">
    <h2>${sheet.team}</h2>
    <p class="muted">${entryLine(locale, sheet)}</p>
    ${form} ${confirm}
  </section>`;
}

export function statsPageView(locale: Locale, data: StatsPageData): Page {
  const { view } = data;
  const { game } = view;
  const title = t(locale, 'web.stats.title', { a: view.match.a, b: view.match.b });
  const flash = !data.flash
    ? ''
    : 'done' in data.flash
      ? html`<p class="card flash">${t(locale, `web.stats.done.${data.flash.done}`)}</p>`
      : html`<p class="card flash error">${t(locale, ERROR_KEYS[data.flash.error])}</p>`;
  const tabs = html`<nav class="tabs">
    ${view.games.map(
      (entry) =>
        html`<a
          href="${base(view)}?game=${String(entry.n)}"
          ${entry.n === game.n ? html`aria-current="page"` : ''}
          >${t(locale, 'web.stats.game', {
            n: entry.n,
            score: `${String(entry.scoreA)}–${String(entry.scoreB)}`,
          })}${entry.map ? ` · ${entry.map}` : ''}</a
        >`,
    )}
  </nav>`;
  const names = { a: view.match.a, b: view.match.b };
  const warnings = view.warnings.map(
    (warning) =>
      html`<p class="card flash error">
        ${t(locale, 'web.stats.warning', {
          team: names[warning.side],
          kills: warning.kills,
          other: names[warning.side === 'a' ? 'b' : 'a'],
          deaths: warning.deaths,
        })}
      </p>`,
  );
  const editable = view.sides.some((sheet) => sheet.canEdit);
  return pageOf(
    title,
    html`<p><a href="/matches/${String(view.match.id)}">${t(locale, 'web.stats.back')}</a></p>
      <h1>${title}</h1>
      ${tabs} ${flash}
      ${game.lock ? html`<p class="card flash">${t(locale, ERROR_KEYS[game.lock])}</p>` : ''}
      ${editable ? html`<p class="muted">${t(locale, 'web.stats.intro')}</p>` : ''} ${warnings}
      ${view.sides.map((sheet) => sideSection(locale, data, sheet))}
      ${editable ? html`<script src="/static/stat-paste.js" defer></script>` : ''}`,
  );
}

/** The match page's link to the grid, for its teams and league staff once it has a result. */
export const statsLink = (locale: Locale, matchId: number): Html =>
  html`<p><a href="/matches/${String(matchId)}/stats">${t(locale, 'web.stats.link')}</a></p>`;
