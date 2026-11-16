// Quick access, as in A: most pages carry summaries that double as menus (tonight, upcoming,
// standings, latest results, mercato). Each is a <details> panel: open on desktop, folded on
// phones so the page's own content stays short.
//
// Which competition the summaries follow (the "focus"):
//   1. a page inside a competition (hub, standings, calendar, match): that competition, and the
//      match's or page's division first;
//   2. a team: its division; a player: their current team's division;
//   3. a logged-in visitor on a platform page (Ligo home, game home): their team's division;
//   4. otherwise (logged out on the home, organisation page): every division of the busiest
//      competition tonight, and the other competitions as leaders only.
// The focus is named in each panel's header, so a visitor knows why they see that table.

import * as D from '../../_data/index.ts';
import { html, href, icon, raw, type Raw } from '../../_build/lib.ts';
import { matchesOn, latestResults, weekMatches, zoneKeyLabel } from '../../_build/shared.ts';
import { team, matchRow, pill, matchHref, signedCell, playerLink } from './parts.ts';
import { tonightList } from './layout.ts';

export interface Focus {
  /** Divisions shown first, in order. */
  divisions: string[];
  /** Teams marked in the tables and used to filter matches. */
  teams?: D.Team[];
  /** Why this focus: shown in the panel header ("votre division", "division de GRD"). */
  why?: string;
}

const divName = (d: string) => (d === 'ligue-1' ? 'Ligue 1' : 'Ligue 2');
const ALL = ['ligue-1', 'ligue-2'];

export const focusAll: Focus = { divisions: ALL };
export const focusMatch = (m: D.Match): Focus => ({ divisions: [m.division], teams: [m.a, m.b], why: 'division du match' });
export const focusTeam = (tm: D.Team, why = `division de ${tm.tag}`): Focus => ({ divisions: [tm.division], teams: [tm], why });

/** A quick-access panel: <details>, opened on desktop by CSS and a one-line script. */
export function qa(title: string, body: Raw, opts: { extra?: Raw | string; cls?: string; count?: number | string } = {}): Raw {
  return html`<details class="panel qa ${opts.cls ?? ''}"><summary class="ph"><h2>${title}</h2>${opts.count !== undefined ? html`<span class="qa-n">${opts.count}</span>` : ''}${opts.extra ? html`<span class="ph-x">${opts.extra}</span>` : ''}<span class="qa-chev" aria-hidden="true">${icon('chevronRight', 11)}</span></summary><div class="qa-b">${body}</div></details>`;
}

// ---------------------------------------------------------------------------------------------
// Left column: matches.

export function qTonight(): Raw {
  const toPlay = D.featured.toPlay;
  const n = matchesOn(D.NOW).filter((m) => m.scheduledAt && m.scheduledAt >= D.NOW - 3 * 3_600_000).length + D.otherMatchesToday.filter((o) => o.status === 'scheduled').length;
  return qa(
    'Ce soir · jeu. 26 nov.',
    html`<div class="live-veto">
      <div class="lv-h">${pill('live', 'Veto en cours', 'timer')}<span class="faint">LFR · L1 · 21:00</span></div>
      <a class="lv-m" href="${href(`/matches/${toPlay.id}/veto`)}">${team(toPlay.a, { size: 16, link: false, tagOnly: true })}<span class="vs">vs</span>${team(toPlay.b, { size: 16, link: false, tagOnly: true })}</a>
      <div class="lv-s faint">Étape 5/9 · ${toPlay.b.tag} bannit · 2:37</div>
    </div>${tonightList()}`,
    { cls: 'qa-tonight', count: n, extra: html`<a href="${href('/matches')}">Tous</a>` },
  );
}

export function qUpcoming(focus: Focus = focusAll, limit = 7): Raw {
  const slugs = focus.teams?.map((t) => t.slug);
  const later = D.matches
    .filter((m) => m.scheduledAt && m.scheduledAt > D.NOW && !D.sameDay(m.scheduledAt, D.NOW) && (m.status === 'scheduled' || m.status === 'proposed'))
    .filter((m) => !slugs || slugs.includes(m.a.slug) || slugs.includes(m.b.slug) || focus.divisions.includes(m.division))
    .sort((a, b) => {
      // The focus teams' own matches first, then the rest by date.
      const mine = (m: D.Match) => (slugs && (slugs.includes(m.a.slug) || slugs.includes(m.b.slug)) ? 0 : 1);
      return mine(a) - mine(b) || (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0);
    })
    .slice(0, limit);
  return qa('À venir', html`<ul class="mlist">${later.map((m) => matchRow(m, { date: true }))}</ul>`, {
    extra: html`<a href="${href('/mbl-group/lfr/s3/calendar')}">Calendrier</a>`,
  });
}

export function qPending(): Raw {
  const f = D.featured;
  return qa(
    'En attente',
    html`<ul class="wl">
      <li>${pill('pending', 'Déclaré')} <a href="${matchHref(f.reported)}">${f.reported.a.tag}–${f.reported.b.tag}</a> <span class="faint">5–7 · attend ${f.reported.a.tag}</span></li>
      <li>${pill('danger', 'Contesté', 'alert')} <a href="${matchHref(f.disputed)}">${f.disputed.a.tag}–${f.disputed.b.tag}</a> <span class="faint">staff</span></li>
      <li>${pill('info', 'Proposé')} <a href="${matchHref(f.proposed)}">${f.proposed.a.tag}–${f.proposed.b.tag}</a> <span class="faint">ven. 21:30 ?</span></li>
    </ul>`,
    { count: 3 },
  );
}

/** The match's week: the same division's other matches. */
export function qWeek(m: D.Match): Raw {
  const others = weekMatches(m.division, m.week).filter((x) => x.id !== m.id);
  return qa(`Semaine ${m.week} · ${divName(m.division)}`, html`<ul class="mlist">${others.map((x) => matchRow(x, { date: true }))}</ul>`, {
    extra: html`<a href="${href('/mbl-group/lfr/s3/calendar')}">Calendrier</a>`,
  });
}

export const leftQuick = (focus: Focus = focusAll): Raw => html`${qTonight()}${qUpcoming(focus)}${qPending()}`;

// ---------------------------------------------------------------------------------------------
// Right column: standings, results, mercato.

/** A full division table, the focus teams marked. */
export function qStandings(division: string, opts: { teams?: D.Team[]; why?: string } = {}): Raw {
  const rows = D.standings(division);
  const marked = new Set((opts.teams ?? []).map((t) => t.slug));
  return qa(
    divName(division),
    html`<table class="st mini"><caption class="vh">Classement ${divName(division)}</caption>
    <thead><tr><th scope="col" class="zc"><span class="vh">Zone</span></th><th scope="col" class="num">#</th><th scope="col" class="tl">Équipe</th><th scope="col" class="num"><abbr title="Matchs joués">MJ</abbr></th><th scope="col" class="num">Diff</th><th scope="col" class="num pts">PTS</th></tr></thead>
    <tbody>${rows.map(
      (r) => html`<tr class="${r.excluded ? 'ex' : ''} ${marked.has(r.team.slug) ? 'is-me' : ''}"><td class="zc">${r.zone ? html`<span class="zb z-${r.zone}" title="${zoneKeyLabel(r.zone)}"><span class="vh">${zoneKeyLabel(r.zone)}</span></span>` : ''}</td>
      <td class="num">${r.excluded ? 'EX' : html`${r.rank}${r.shared ? '=' : ''}`}</td>
      <th scope="row" class="tl">${team(r.team, { size: 14, tagOnly: true })}</th>
      <td class="num">${r.played}</td><td class="num">${signedCell(r.diff)}</td><td class="num pts">${r.points}</td></tr>`,
    )}</tbody></table>`,
    { cls: 'qa-st', extra: html`${opts.why ? html`<span class="faint">${opts.why}</span>` : ''}<a href="${href(`/mbl-group/lfr/s3/standings/${division}`)}">Complet</a>` },
  );
}

/** Leaders of every running competition: the logged-out home has no single league to follow. */
export function qLeaders(): Raw {
  const lfr = ALL.map((d) => {
    const rows = D.standings(d).filter((r) => !r.excluded).slice(0, 3);
    return html`<tr class="daysep"><td colspan="3"><a href="${href(`/mbl-group/lfr/s3/standings/${d}`)}">LFR · ${divName(d)}</a></td></tr>${rows.map(
      (r) => html`<tr><td class="num">${r.rank}${r.shared ? '=' : ''}</td><th scope="row" class="tl">${team(r.team, { size: 14, tagOnly: true })}</th><td class="num pts">${r.points}</td></tr>`,
    )}`;
  });
  const others = D.competitionCards.filter((c) => c.slug !== 'lfr' && c.status === 'active' && c.teams > 0);
  return qa(
    'Classements',
    html`<table class="st mini lead"><caption class="vh">Têtes de classement</caption><tbody>${lfr}
      ${others.map((c) => html`<tr class="daysep"><td colspan="3"><a href="${href(`/${c.org}/${c.slug}`)}">${c.short} · ${c.divisions[0]}</a> <span class="faint">${c.progress}</span></td></tr>`)}</tbody></table>`,
    { cls: 'qa-st', extra: html`<span class="faint">têtes de classement</span>` },
  );
}

export function qResults(focus: Focus = focusAll, limit = 7): Raw {
  const slugs = focus.teams?.map((t) => t.slug);
  const list = latestResults(40)
    .filter((m) => focus.divisions.includes(m.division) || (slugs && (slugs.includes(m.a.slug) || slugs.includes(m.b.slug))))
    .slice(0, limit);
  return qa('Derniers résultats', html`<ul class="mlist">${list.map((m) => matchRow(m, { date: true }))}</ul>`, {
    extra: focus.divisions.length === 1 ? html`<span class="faint">${divName(focus.divisions[0] as string)}</span>` : '',
  });
}

export function qMercato(focus: Focus = focusAll): Raw {
  const slugs = focus.teams?.map((t) => t.slug);
  const moves = D.mercatoMoves
    .slice()
    .sort((a, b) => {
      const mine = (mv: (typeof D.mercatoMoves)[number]) => (slugs && (slugs.includes(mv.from ?? '') || slugs.includes(mv.to ?? '')) ? 0 : 1);
      return mine(a) - mine(b) || b.at - a.at;
    })
    .slice(0, 5);
  return qa(
    'Mercato',
    html`<ul class="merc">${moves.map((mv) => {
      const from = mv.from ? D.team(mv.from) : null;
      const to = mv.to ? D.team(mv.to) : null;
      const slug = mv.player.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return html`<li><span class="faint">${D.dateShort(mv.at)}</span> ${playerLink(slug)} <span class="mvm">${from ? from.tag : 'libre'} ${icon('chevronRight', 10)} ${to ? to.tag : 'libre'}</span></li>`;
    })}</ul>`,
    { extra: html`<span class="faint">close le 15 nov.</span>` },
  );
}

/** Standings first (focus divisions, then the rest), results, mercato. */
export function rightQuick(focus: Focus = focusAll, opts: { otherDivisions?: boolean } = {}): Raw {
  const rest = opts.otherDivisions === false ? [] : ALL.filter((d) => !focus.divisions.includes(d));
  return html`${focus.divisions.map((d) => qStandings(d, { teams: focus.teams, why: focus.why }))}${rest.map((d) => qStandings(d))}${qResults(focus)}${qMercato(focus)}`;
}

export const _u = [raw];
