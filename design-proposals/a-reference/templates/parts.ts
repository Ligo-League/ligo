// Small pieces every page of proposal A uses: team names with badges, status pills, form boxes,
// rank change, standings tables, match rows. Dense and plain: the data is the design.

import * as D from '../../_data/index.ts';
import { html, raw, teamBadge, flag, icon, href, join, type Raw, type IconName } from '../../_build/lib.ts';
import { t } from '../../_build/i18n.ts';
import { statusOf, scoreOf, zonesIn, zoneKeyLabel, sourceLabel, type Tone } from '../../_build/shared.ts';

export const teamHref = (tm: D.Team) => href(`/teams/${tm.slug}`);
export const playerHref = (slug: string) => href(`/players/${slug}`);
export const matchHref = (m: { id: number }) => href(`/matches/${m.id}`);

/** Badge + name; in `.tagm` contexts the name becomes the tag below 640 px. */
export function team(tm: D.Team, opts: { size?: number; link?: boolean; tagOnly?: boolean; cls?: string } = {}): Raw {
  const inner = html`${teamBadge(tm, { size: opts.size ?? 16 })}<span class="n">${opts.tagOnly ? tm.tag : tm.name}</span><span class="tg">${tm.tag}</span>`;
  return opts.link === false
    ? html`<span class="tm ${opts.tagOnly ? 'tago' : ''} ${opts.cls ?? ''}">${inner}</span>`
    : html`<a class="tm ${opts.tagOnly ? 'tago' : ''} ${opts.cls ?? ''}" href="${teamHref(tm)}">${inner}</a>`;
}

export function playerLink(slug: string, opts: { flag?: boolean } = {}): Raw {
  const p = D.players.get(slug);
  if (!p) return html`<span>${slug}</span>`;
  return html`<a class="pl" href="${playerHref(slug)}">${opts.flag === false ? '' : flag(p.nat)}<span>${p.tag}</span></a>`;
}

export const pill = (tone: Tone, text: string, ic?: IconName): Raw =>
  html`<span class="pill pill-${tone}">${ic ? icon(ic, 11) : ''}${text}</span>`;

export const status = (m: D.Match): Raw => {
  const s = statusOf(m);
  const ic: Partial<Record<Tone, IconName>> = { danger: 'alert', done: 'check', live: 'timer' };
  return html`<span class="pill pill-${s.tone}" title="${s.label}">${ic[s.tone] ? icon(ic[s.tone] as IconName, 11) : ''}<span class="pl-l">${s.label}</span><span class="pl-s">${s.short}</span></span>`;
};

export const panelHead = (title: string, extra?: Raw | string): Raw =>
  html`<div class="ph"><h2>${title}</h2>${extra ? html`<div class="ph-x">${extra}</div>` : ''}</div>`;

export const panel = (title: string, body: Raw, opts: { extra?: Raw | string; cls?: string; id?: string } = {}): Raw =>
  html`<section class="panel ${opts.cls ?? ''}"${opts.id ? raw(` id="${opts.id}"`) : ''}>${panelHead(title, opts.extra)}${body}</section>`;

/** Rank change: arrow and number, or a dash; always with a text alternative. */
export function move(change: number | null): Raw {
  if (change === null || change === 0) return html`<span class="mv mv-0" title="${t('noChange')}">–</span>`;
  const up = change > 0;
  return html`<span class="mv ${up ? 'mv-up' : 'mv-down'}" title="${up ? '+' : '−'}${Math.abs(change)} place(s)">${icon(up ? 'up' : 'down', 10)}${Math.abs(change)}</span>`;
}

/** Last five results as letter boxes; a forfeit is dashed and says so on hover. */
export function form(list: D.FormResult[]): Raw {
  return html`<span class="form">${list.map(
    (f) =>
      html`<span class="fb fb-${f.result}${f.forfeit ? ' fb-ff' : ''}" title="${f.result === 'W' ? t('formWin') : t('formLoss')}${f.forfeit ? ' ' + t('formForfeit') : ''} · ${f.label}">${f.result}</span>`,
  )}</span>`;
}

export const signedCell = (n: number): Raw => html`<span class="${n > 0 ? 'pos' : n < 0 ? 'neg' : ''}">${D.signed(n)}</span>`;

const ZONE_MARK: Record<Exclude<D.Zone, null>, string> = {
  champion: 'C',
  promotion: 'M',
  barrage_promotion: 'B',
  barrage_relegation: 'B',
  relegation: 'D',
};

export function zoneLegend(rows: D.StandingRow[]): Raw {
  return html`<ul class="legend">${zonesIn(rows).map(
    (z) => html`<li><span class="zm z-${z}">${ZONE_MARK[z]}</span>${zoneKeyLabel(z)}</li>`,
  )}</ul>`;
}

/** The full standings table (section 11 column names). */
export function standingsTable(division: string, opts: { caption?: string } = {}): Raw {
  const rows = D.standings(division);
  const sanctions = D.SANCTIONS.filter((s) => s.division === division && s.points !== 0);
  return html`<div class="tw"><table class="st tagm">
    <caption class="vh">${opts.caption ?? t('standings')}</caption>
    <thead><tr>
      <th scope="col" class="zc"><span class="vh">Zone</span></th>
      <th scope="col" class="num rk">${t('colRank')}</th>
      <th scope="col" class="mvc"><abbr title="Évolution depuis la semaine précédente">${t('colMove')}</abbr></th>
      <th scope="col" class="tl">${t('colTeam')}</th>
      <th scope="col" class="num"><abbr title="${t('colPlayedLong')}">${t('colPlayed')}</abbr></th>
      <th scope="col" class="num"><abbr title="${t('legendW')}">${t('colW')}</abbr></th>
      <th scope="col" class="num"><abbr title="${t('legendL')}">${t('colL')}</abbr></th>
      <th scope="col" class="num opt"><abbr title="${t('legendRW')}">${t('colRW')}</abbr></th>
      <th scope="col" class="num opt"><abbr title="${t('legendRL')}">${t('colRL')}</abbr></th>
      <th scope="col" class="num"><abbr title="${t('legendDiff')}">${t('colDiff')}</abbr></th>
      <th scope="col" class="num pts"><abbr title="${t('legendPts')}">${t('colPts')}</abbr></th>
      <th scope="col" class="opt2 fc">${t('colForm')}</th>
    </tr></thead>
    <tbody>${rows.map((r) => {
      const z = r.zone;
      return html`<tr class="${r.excluded ? 'ex' : ''}">
        <td class="zc">${z ? html`<span class="zb z-${z}" title="${zoneKeyLabel(z)}"><span class="vh">${zoneKeyLabel(z)}</span>${ZONE_MARK[z]}</span>` : ''}</td>
        <td class="num rk">${r.excluded ? html`<abbr title="${t('excluded')}">EX</abbr>` : html`${r.rank}${r.shared ? html`<abbr class="eq" title="${t('shared')}">=</abbr>` : ''}`}</td>
        <td class="mvc">${move(r.change)}</td>
        <th scope="row" class="tl">${team(r.team)}${r.excluded ? html` <span class="ex-l">${t('excluded')}</span>` : ''}${r.sanction ? html`<sup class="fn"><a href="#sanctions-${division}" title="${t('sanction')}">${r.sanction > 0 ? '+' : '−'}${Math.abs(r.sanction)}</a></sup>` : ''}</th>
        <td class="num">${r.played}</td>
        <td class="num">${r.wins}</td>
        <td class="num">${r.losses}</td>
        <td class="num opt">${r.roundsWon}</td>
        <td class="num opt">${r.roundsLost}</td>
        <td class="num">${signedCell(r.diff)}</td>
        <td class="num pts">${r.points}</td>
        <td class="opt2 fc">${form(r.form)}</td>
      </tr>`;
    })}</tbody>
  </table></div>
  ${zoneLegend(rows)}
  ${sanctions.length || rows.some((r) => r.excluded) || rows.some((r) => r.shared)
    ? html`<ol class="notes" id="sanctions-${division}">
      ${sanctions.map((s) => html`<li><strong>${D.team(s.team).name} : ${D.signed(s.points)} pts</strong> · ${s.reason} (décision du ${D.dateShort(s.at)}).</li>`)}
      ${rows.some((r) => r.shared) ? html`<li><strong>=</strong> rang partagé : même nombre de points et même Diff (réglage <code>unresolved_tie: shared</code>).</li>` : ''}
      ${rows.some((r) => r.excluded) ? html`<li><strong>EX</strong> équipe exclue après 3 forfaits, classée dernière. Règle des 50 % : elle a joué moins de la moitié de ses matchs, tous ses matchs comptent comme forfaits 7–0 pour l’adversaire ; un match entre deux exclues ne compte pour personne.</li>` : ''}
    </ol>`
    : ''}`;
}

/** The narrow standings of the sidebars: rank, tag, MJ, Diff, PTS. */
export function miniStandings(division: string): Raw {
  const rows = D.standings(division);
  return html`<table class="st mini">
    <caption class="vh">${t('standings')} ${division === 'ligue-1' ? 'Ligue 1' : 'Ligue 2'}</caption>
    <thead><tr><th scope="col" class="zc"><span class="vh">Zone</span></th><th scope="col" class="num">#</th><th scope="col" class="tl">${t('colTeam')}</th><th scope="col" class="num"><abbr title="${t('colPlayedLong')}">${t('colPlayed')}</abbr></th><th scope="col" class="num">${t('colDiff')}</th><th scope="col" class="num pts">${t('colPts')}</th></tr></thead>
    <tbody>${rows.map(
      (r) => html`<tr class="${r.excluded ? 'ex' : ''}"><td class="zc">${r.zone ? html`<span class="zb z-${r.zone}" title="${zoneKeyLabel(r.zone)}"><span class="vh">${zoneKeyLabel(r.zone)}</span></span>` : ''}</td>
      <td class="num">${r.excluded ? 'EX' : html`${r.rank}${r.shared ? '=' : ''}`}</td>
      <th scope="row" class="tl">${team(r.team, { size: 14, tagOnly: true })}</th>
      <td class="num">${r.played}</td><td class="num">${signedCell(r.diff)}</td><td class="num pts">${r.points}</td></tr>`,
    )}</tbody></table>`;
}

const ddmmFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: D.TIME_ZONE, day: '2-digit', month: '2-digit' });
/** "28/11", for narrow date columns. */
export const ddmm = (at: number) => ddmmFmt.format(at);

/** One match as a compact row: time, A, score or status, B. */
export function matchRow(m: D.Match, opts: { date?: boolean; division?: boolean } = {}): Raw {
  const sc = scoreOf(m);
  const st = statusOf(m);
  const when = m.scheduledAt ? (opts.date ? ddmm(m.scheduledAt) + ' ' + D.time(m.scheduledAt) : D.time(m.scheduledAt)) : m.proposal ? 'prop.' : '—';
  const mid = sc
    ? html`<a class="sc" href="${matchHref(m)}"><span class="${sc.winner === 'a' ? 'w' : ''}">${sc.a}</span>–<span class="${sc.winner === 'b' ? 'w' : ''}">${sc.b}</span>${sc.forfeit ? html`<small>W.O.</small>` : ''}</a>`
    : html`<a class="sc st-${st.tone}" href="${matchHref(m)}" title="${st.label}">${st.key === 'veto' ? 'veto' : 'vs'}</a>`;
  return html`<li class="mr${opts.date ? ' mr-d' : ''}">
    <span class="mr-t">${when}${opts.division ? html`<small>${m.division === 'ligue-1' ? 'L1' : 'L2'}</small>` : ''}</span>
    <span class="mr-a ${sc?.winner === 'a' ? 'w' : ''}">${team(m.a, { size: 14, tagOnly: true })}</span>
    ${mid}
    <span class="mr-b ${sc?.winner === 'b' ? 'w' : ''}">${team(m.b, { size: 14, tagOnly: true })}</span>
  </li>`;
}

export const sourceBadge = (s: D.StatsSource): Raw => {
  const v = sourceLabel[s];
  return html`<span class="pill pill-${v.tone}" title="${v.note}">${s === 'replay_verified' ? icon('check', 11) : s === 'replay_unverified' ? icon('clock', 11) : ''}${v.label}</span>`;
};

export const mapThumb = (map: string, w = 40): Raw => {
  // Flat colour placeholder where a map thumbnail would sit: a hue per map, no game art.
  const hue = [...map].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
  return html`<span class="mapth" style="width:${w}px;background:hsl(${hue} 18% 72%)" aria-hidden="true"></span>`;
};

export function kv(rows: [string, Raw | string | number | null][]): Raw {
  return html`<dl class="kv">${rows.filter((r) => r[1] !== null && r[1] !== '').map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;
}

export const tabs = (items: { label: string; route: string; active?: boolean; count?: string | number }[], cls = ''): Raw =>
  html`<nav class="tabs ${cls}" aria-label="Sections"><ul>${items.map(
    (i) => html`<li><a href="${href(i.route)}"${i.active ? raw(' aria-current="page"') : ''}>${i.label}${i.count !== undefined ? html`<span class="cnt">${i.count}</span>` : ''}</a></li>`,
  )}</ul></nav>`;

export const empty = (title: string, text: string, action?: Raw): Raw =>
  html`<div class="empty"><p><strong>${title}</strong></p><p>${text}</p>${action ?? ''}</div>`;

export const pctBar = (p: number | null, label?: string): Raw =>
  p === null ? html`<span class="faint">–</span>` : html`<span class="pb" title="${label ?? ''}"><span style="width:${Math.round(p)}%"></span></span>`;

export { join, raw, icon, flag, html, href };
export type { Raw };
