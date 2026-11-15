import type { VetoTeam } from '@ligo/core';
import { html } from 'hono/html';
import { sideLabel, vetoChoiceLabel, vetoTeamName } from '../../discord/veto-message.ts';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { VetoView } from '../../services/veto.ts';
import { csrfField, pageOf, type Html, type Page } from '../layout.ts';

// The map veto on the website (phase 3e): what the Discord message shows, as a page. It asks
// the server every few seconds whether the veto moved (htmx), and stops once it is over. Choices
// are forms: they work without JavaScript, and the service checks each one again.

export const VETO_DONE = ['started', 'started_unposted', 'chosen'] as const;
export type VetoDone = (typeof VETO_DONE)[number];

const ERROR_KEYS = {
  not_linked: 'veto.error.not_linked',
  no_team: 'veto.error.no_team',
  match_not_found: 'veto.error.match_not_found',
  not_your_match: 'veto.error.not_your_match',
  not_schedulable: 'veto.error.not_schedulable',
  team_excluded: 'veto.error.team_excluded',
  already_started: 'veto.error.already_started',
  no_format: 'veto.error.no_format',
  pool_size: 'veto.error.pool_size',
  no_ranks: 'veto.error.no_ranks',
  not_started: 'veto.error.not_started',
  stale: 'veto.error.stale',
  finished: 'veto.error.finished',
  not_your_turn: 'veto.error.not_your_turn',
  invalid_choice: 'veto.error.invalid_choice',
} as const satisfies Record<string, MessageKey>;
export type VetoError = keyof typeof ERROR_KEYS;
export const isVetoError = (value: string | undefined): value is VetoError =>
  value !== undefined && Object.hasOwn(ERROR_KEYS, value);

export type VetoFlash = { done: VetoDone } | { error: VetoError } | null;

/** How often the page asks whether the veto moved. */
export const VETO_POLL_SECONDS = 3;

export interface VetoSectionData {
  matchId: number;
  names: { a: string; b: string };
  bestOf: number;
  /** Null until the veto starts. */
  view: VetoView | null;
  /** The sides the viewer acts for: their turns get the choices. */
  sides: ('a' | 'b')[];
  /** Whether the viewer may start the veto: a side or league staff, the match still to play. */
  canStart: boolean;
  timeZone: string;
  csrf: string;
  flash: VetoFlash;
}

/** What the page last showed: the number of steps, or -1 before the start. */
export const vetoMarker = (view: VetoView | null): number => view?.steps.length ?? -1;

function clock(locale: Locale, at: number, timeZone: string): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone,
  }).format(at);
}

/** The steps so far, line by line, as the Discord message gives them. */
function stepLines(locale: Locale, view: VetoView): string[] {
  const name = (team: VetoTeam | null) => vetoTeamName(view, team);
  const { match } = view;
  const lines =
    view.byCoin || view.host === null
      ? [t(locale, 'web.veto.coin', { winner: name('A') })]
      : [
          t(locale, 'veto.roles', {
            chooser: name('A'),
            other: name('B'),
            host: match[view.host].name,
          }),
        ];
  for (const step of view.steps) {
    const late = step.timedOut ? t(locale, 'veto.timedOut') : '';
    if (
      step.action === 'toss_choice' &&
      (step.choice === 'side_selection' || step.choice === 'first_ban')
    ) {
      lines.push(t(locale, `veto.tossChoice.${step.choice}`, { team: name(step.team) }) + late);
    } else if (step.action === 'first_ban' && (step.choice === 'A' || step.choice === 'B')) {
      lines.push(t(locale, 'veto.firstBan', { team: name(step.choice) }) + late);
    }
  }
  const bans = view.steps
    .filter((step) => step.action === 'ban')
    .map((step) =>
      t(locale, step.timedOut ? 'veto.ban.timedOut' : 'veto.ban', {
        map: step.map ?? '?',
        team: name(step.team),
      }),
    );
  if (bans.length > 0) lines.push(t(locale, 'veto.bans', { list: bans.join(', ') }));
  for (const step of view.steps) {
    if (step.action !== 'pick' && step.action !== 'decider') continue;
    const game = { n: step.game ?? 1, map: step.map ?? '?', team: name(step.team) };
    const key: MessageKey =
      match.bestOf === 1
        ? 'web.veto.game'
        : step.action === 'decider'
          ? 'web.veto.game.decider'
          : 'web.veto.game.picked';
    const parts = [t(locale, key, game)];
    const toss = view.steps.find((s) => s.action === 'toss' && s.game === step.game);
    if (toss) parts.push(t(locale, 'veto.deciderToss', { team: name(toss.team) }));
    const side = view.steps.find((s) => s.action === 'side' && s.game === step.game);
    const otSide = view.steps.find((s) => s.action === 'ot_side' && s.game === step.game);
    if (side?.side && otSide?.side) {
      parts.push(
        t(locale, 'veto.sides', {
          team: name(side.team),
          side: sideLabel(locale, side.side),
          otTeam: name(otSide.team),
          otSide: sideLabel(locale, otSide.side),
        }),
      );
    } else if (side?.side) {
      parts.push(
        t(locale, 'veto.sides.start', {
          team: name(side.team),
          side: sideLabel(locale, side.side),
        }),
      );
    } else if (step.action === 'decider' && view.state.status === 'done') {
      parts.push(t(locale, 'veto.sides.later'));
    }
    lines.push(parts.join(' — '));
  }
  return lines;
}

function flashView(locale: Locale, flash: VetoFlash): Html | string {
  if (!flash) return '';
  return 'done' in flash
    ? html`<p class="card flash">${t(locale, `web.veto.done.${flash.done}`)}</p>`
    : html`<p class="card flash error">${t(locale, ERROR_KEYS[flash.error])}</p>`;
}

function turnView(locale: Locale, data: VetoSectionData, view: VetoView): Html | string {
  const { state } = view;
  if (state.status === 'done') return html`<p><strong>${t(locale, 'veto.done')}</strong></p>`;
  const turnSide = state.team === 'A' ? view.teamA : view.teamA === 'a' ? 'b' : 'a';
  const turn = html`<p>
    <strong
      >${t(locale, `web.veto.turn.${state.action}`, {
        team: vetoTeamName(view, state.team),
        map: state.map ?? '?',
      })}</strong
    >
    ${
      view.deadline === null
        ? ''
        : t(locale, 'web.veto.deadline', { time: clock(locale, view.deadline, data.timeZone) })
    }
  </p>`;
  const mine = data.sides.includes(turnSide);
  const choices = mine
    ? html`<form
        class="card veto-choices"
        method="post"
        action="/matches/${String(data.matchId)}/veto/choose"
      >
        ${csrfField(data.csrf)}
        <input type="hidden" name="step" value="${String(state.step)}" />
        ${state.choices.map(
          (choice) =>
            html`<button
              type="submit"
              name="choice"
              value="${choice}"
              class="${state.action === 'ban' ? 'danger' : ''}"
            >
              ${vetoChoiceLabel(locale, view, choice)}
            </button>`,
        )}
      </form>`
    : html`<p class="muted">${t(locale, 'web.veto.waiting')}</p>`;
  return html`${turn} ${choices}
    <p class="muted">${t(locale, 'veto.timeoutRule')}</p>`;
}

/**
 * The part of the page that follows the veto: the whole of it, replaced each time it moves. While
 * the veto is under way or still to start, it asks again every few seconds.
 */
export function vetoSection(locale: Locale, data: VetoSectionData): Html {
  const { view } = data;
  const live =
    view?.state.status === 'done'
      ? ''
      : html` hx-get="/matches/${String(data.matchId)}/veto/live?step=${String(vetoMarker(view))}"
        hx-trigger="every ${String(VETO_POLL_SECONDS)}s" hx-swap="outerHTML"`;
  const body = view
    ? html`<div class="card">${stepLines(locale, view).map((line) => html`<p>${line}</p>`)}</div>
        ${turnView(locale, data, view)}`
    : html`<p class="muted">${t(locale, 'web.veto.notStarted')}</p>
        ${
          data.canStart
            ? html`<form
                class="card"
                method="post"
                action="/matches/${String(data.matchId)}/veto/start"
              >
                ${csrfField(data.csrf)}
                <button type="submit">${t(locale, 'web.veto.start')}</button>
              </form>`
            : ''
        }`;
  return html`<section id="veto" ${live}>${flashView(locale, data.flash)} ${body}</section>`;
}

export function vetoPageView(locale: Locale, data: VetoSectionData): Page {
  const title = t(locale, 'web.veto.title');
  return pageOf(
    title,
    html`<p class="muted">
        <a href="/matches/${String(data.matchId)}"
          >${t(locale, 'web.veto.match', {
            a: data.names.a,
            b: data.names.b,
            bestOf: data.bestOf,
          })}</a
        >
      </p>
      <h1>${title}</h1>
      ${vetoSection(locale, data)}`,
  );
}

/** The match page's link to the veto, for those who follow it. */
export function vetoLink(locale: Locale, matchId: number): Html {
  return html`<p>
    <a href="/matches/${String(matchId)}/veto">${t(locale, 'web.veto.title')}</a>
  </p>`;
}
