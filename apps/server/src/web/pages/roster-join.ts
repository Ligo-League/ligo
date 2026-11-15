import type { RosterJoinError } from '@ligo/core';
import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { RosterJoinView } from '../../services/rosters.ts';
import { csrfField, pageOf, type Page } from '../layout.ts';

// `/invite/:id/:token`: a roster's invitation (M-33). The player sees the roster and joins with
// their own account, once their game account and nationality are on `/me`.

type JoinData = Extract<RosterJoinView, { ok: true }>;

const REFUSED_KEYS = {
  already_on_roster: 'web.rosterJoin.already',
  roster_closed: 'web.rosterJoin.closed',
  roster_full: 'web.rosterJoin.full',
  incomplete_profile: 'web.join.complete',
} as const satisfies Record<RosterJoinError, MessageKey>;

const GAP_KEYS = {
  game_account: 'web.join.gap.game_account',
  nationality: 'web.join.gap.nationality',
} as const satisfies Record<string, MessageKey>;

export function rosterJoinPage(
  locale: Locale,
  data: JoinData,
  form: { action: string; csrf: string },
): Page {
  const { team, verdict } = data;
  const title = t(locale, 'web.rosterJoin.title', { roster: team.name });
  const gaps = data.gaps.filter((gap): gap is keyof typeof GAP_KEYS => gap in GAP_KEYS);
  const state = verdict.ok
    ? html`<form method="post" action="${form.action}">
        ${csrfField(form.csrf)}
        <button type="submit">${t(locale, 'web.rosterJoin.submit', { roster: team.name })}</button>
      </form>`
    : verdict.error === 'incomplete_profile'
      ? html`<div class="card flash error">
            <p>${t(locale, 'web.join.complete')}</p>
            <ul>
              ${gaps.map((gap) => html`<li>${t(locale, GAP_KEYS[gap])}</li>`)}
            </ul>
            <p>
              <a href="/me" target="_blank" rel="noopener">${t(locale, 'web.join.openMyPage')}</a>
            </p>
          </div>
          <p class="muted">${t(locale, 'web.join.reload')}</p>`
      : html`<p class="card flash${verdict.error === 'already_on_roster' ? '' : ' error'}">
          ${t(locale, REFUSED_KEYS[verdict.error])}
          <a href="/teams/${team.slug}">${team.name}</a>
        </p>`;
  return pageOf(
    title,
    html`<h1>${title}</h1>
      <p>${t(locale, 'web.rosterJoin.intro', { roster: team.name, tag: team.tag })}</p>
      ${state}`,
  );
}
