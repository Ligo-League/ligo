// Components of proposal C: hairline match rows, the standings table, form dots, pills,
// scoreboards and the round strip. Each is a function of plain data returning `html`.

import * as D from '../../_data/index.ts';
import { flag, href, html, icon, matchRoute, raw, teamBadge, teamRoute, playerRoute, type Raw } from '../../_build/lib.ts';
import { t } from '../../_build/i18n.ts';
import { scoreOf, sourceLabel, statusOf, zoneKeyLabel, zonesIn, type Tone } from '../../_build/shared.ts';

/** "26/11": the compact date of a fixture list. */
export const numDate = (at: number) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' }).format(at);

export const pill = (tone: Tone, label: string | Raw, extra = ''): Raw => html`<span class="pill tone-${tone} ${extra}">${label}</span>`;

/** Badge and name; the tag replaces the name on narrow screens. */
export function teamName(team: D.Team, opts: { size?: number; link?: boolean; strong?: boolean } = {}): Raw {
  const inner = html`${teamBadge(team, { size: opts.size ?? 20 })}<span class="tn-long">${team.name}</span><span class="tn-short">${team.tag}</span>`;
  return opts.link === false
    ? html`<span class="tn ${opts.strong ? 'tn-strong' : ''}">${inner}</span>`
    : html`<a class="tn ${opts.strong ? 'tn-strong' : ''}" href="${href(teamRoute(team))}">${inner}</a>`;
}

export function playerLink(slug: string, opts: { flag?: boolean } = {}): Raw {
  const p = D.player(slug);
  return html`<a class="pl" href="${href(playerRoute(slug))}">${opts.flag !== false ? flag(p.nat) : ''}<span>${p.tag}</span></a>`;
}

export function sectionHead(title: string | Raw, link?: [string, string], id?: string): Raw {
  return html`<div class="sh" ${id ? raw(`id="${id}"`) : ''}><h2>${title}</h2>${link ? html`<a href="${href(link[1])}">${link[0]} ${icon('chevronRight', 14)}</a>` : ''}</div>`;
}

export function empty(title: string, text: string | Raw): Raw {
  return html`<div class="empty"><p class="empty-t">${title}</p><p>${text}</p></div>`;
}

// ---------------------------------------------------------------------------------------------
// Form dots: W and L as filled dots carrying the letter; a forfeit result is a ring.

export function formDots(form: D.FormResult[] | ('W' | 'L')[]): Raw {
  const items = form.map((f) => (typeof f === 'string' ? { result: f, forfeit: false, label: f } : f));
  return html`<span class="form" role="list" aria-label="${t('colForm')}">${items.map(
    (f) =>
      html`<span role="listitem" class="fd ${f.result === 'W' ? 'fd-w' : 'fd-l'} ${f.forfeit ? 'fd-f' : ''}" title="${(f.result === 'W' ? t('formWin') : t('formLoss')) + (f.forfeit ? ' ' + t('formForfeit') : '') + (f.label && f.label.length > 1 ? ' · ' + f.label : '')}">${f.result}</span>`,
  )}</span>`;
}

// ---------------------------------------------------------------------------------------------
// Match rows: time or status on the left, the two teams stacked with their scores (Sofascore).

export interface RowOpts {
  showDate?: boolean;
  showDivision?: boolean;
  meta?: boolean;
  highlight?: string;
}

function sideMarks(m: D.Match, s: 'a' | 'b'): Raw {
  const marks: Raw[] = [];
  if (m.host === s) marks.push(html`<abbr class="mk" title="Hôte du lobby">H</abbr>`);
  if (m.sideChooser === s && m.status !== 'validated' && m.status !== 'forfeit') marks.push(html`<abbr class="mk" title="Choix du côté et premier ban">CC</abbr>`);
  return html`${marks}`;
}

export function matchRow(m: D.Match, o: RowOpts = {}): Raw {
  const st = statusOf(m);
  const sc = scoreOf(m);
  const final = !!sc;
  const when = m.scheduledAt;
  const left = final
    ? html`<span class="mr-t">${when ? (o.showDate ? numDate(when) : D.time(when)) : `S${m.week}`}</span><span class="mr-s">${m.status === 'forfeit' ? 'W.O.' : 'Fin'}</span>`
    : m.status === 'proposed' && m.proposal
      ? html`<span class="mr-t mr-q">${D.time(m.proposal.at)}</span><span class="mr-s">${numDate(m.proposal.at)}</span>`
      : when
        ? html`<span class="mr-t">${D.time(when)}</span><span class="mr-s">${D.sameDay(when, D.NOW) ? 'Auj.' : numDate(when)}</span>`
        : html`<span class="mr-t mr-dash">–</span><span class="mr-s">S${m.week}</span>`;
  const teamLine = (s: 'a' | 'b') => {
    const team = s === 'a' ? m.a : m.b;
    const won = sc ? sc.winner === s : false;
    const score = sc ? (s === 'a' ? sc.a : sc.b) : m.status === 'reported' && m.reported ? (s === 'a' ? m.reported.score[0] : m.reported.score[1]) : null;
    const excluded = !!D.EXCLUDED[team.slug];
    return html`<span class="mr-team ${won ? 'won' : ''} ${sc && !won ? 'lost' : ''} ${o.highlight === team.slug ? 'hl' : ''}">
      ${teamBadge(team, { size: 20 })}<span class="tn-long">${team.name}</span><span class="tn-short">${team.tag}</span>${excluded ? html`<span class="mk mk-ex" title="Équipe exclue">EX</span>` : ''}${sideMarks(m, s)}
      <span class="mr-score ${m.status === 'reported' ? 'pending' : ''}">${score ?? ''}</span></span>`;
  };
  const pills: Raw[] = [];
  if (m.extension) pills.push(pill('warn', t('stExtension')));
  if (!['validated', 'to_schedule', 'scheduled'].includes(m.status) || st.key === 'auto' || st.key === 'veto') pills.push(pill(st.tone, st.label));
  if (m.convertedFrom) pills.push(pill('muted', html`joué ${m.convertedFrom[0]}–${m.convertedFrom[1]}, converti`));
  const meta: Raw[] = [];
  if (o.showDivision) meta.push(html`<span>${m.division === 'ligue-1' ? 'Ligue 1' : 'Ligue 2'} · S${m.week}</span>`);
  if (o.meta !== false && m.map && final) meta.push(html`<span>${m.map}</span>`);
  if (o.meta !== false && m.coinToss && !final) meta.push(html`<span>${icon('coin', 13)} Tirage au sort</span>`);
  if (m.stream && !final) meta.push(html`<span>${icon('play', 13)} Diffusé</span>`);
  return html`<li class="mr ${m.status === 'void' || m.status === 'no_result' ? 'mr-void' : ''}"><a href="${href(matchRoute(m.id))}">
    <span class="mr-when">${left}</span>
    <span class="mr-teams">${teamLine('a')}${teamLine('b')}</span>
    ${pills.length || meta.length ? html`<span class="mr-info">${pills}${meta.length ? html`<span class="mr-meta">${meta}</span>` : ''}</span>` : ''}
  </a></li>`;
}

export const matchList = (ms: D.Match[], o: RowOpts = {}): Raw => html`<ul class="mlist">${ms.map((m) => matchRow(m, o))}</ul>`;

/** Rows grouped by day with sticky headers, the way FotMob and BBC list fixtures. */
export function byDay(ms: D.Match[], o: RowOpts = {}): Raw {
  const groups = new Map<string, D.Match[]>();
  const undated: D.Match[] = [];
  for (const m of [...ms].sort((x, y) => (x.scheduledAt ?? x.proposal?.at ?? 0) - (y.scheduledAt ?? y.proposal?.at ?? 0))) {
    const at = m.scheduledAt ?? null;
    if (!at) {
      undated.push(m);
      continue;
    }
    const key = D.day(at);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return html`${[...groups.entries()].map(([k, list]) => {
    const today = D.sameDay((list[0] as D.Match).scheduledAt as number, D.NOW);
    return html`<div class="day ${today ? 'today' : ''}"><h3 class="day-h">${today ? html`<span class="today-tag">Aujourd’hui</span>` : ''}${k}</h3>${matchList(list, o)}</div>`;
  })}${undated.length ? html`<div class="day"><h3 class="day-h">Sans horaire</h3>${matchList(undated, o)}</div>` : ''}`;
}

// ---------------------------------------------------------------------------------------------
// Standings table.

const ZONE_MARK: Record<Exclude<D.Zone, null>, string> = { champion: 'C', promotion: 'M', barrage_promotion: 'B', barrage_relegation: 'B', relegation: 'D' };

export function zoneLegend(rows: D.StandingRow[]): Raw {
  return html`<ul class="legend" aria-label="Zones">${zonesIn(rows).map(
    (z) => html`<li><span class="zm z-${z}">${ZONE_MARK[z]}</span>${zoneKeyLabel(z)}</li>`,
  )}</ul>`;
}

function changeCell(c: number | null): Raw {
  if (c === null || c === 0) return html`<span class="chg chg-0" title="${t('noChange')}">–</span>`;
  return c > 0
    ? html`<span class="chg chg-up" title="+${c}">${icon('up', 12)}<span>${c}</span><span class="sr">places gagnées</span></span>`
    : html`<span class="chg chg-down" title="−${-c}">${icon('down', 12)}<span>${-c}</span><span class="sr">places perdues</span></span>`;
}

export interface StandingsOpts {
  compact?: boolean;
  highlight?: string[];
  caption?: string;
  limit?: number;
  form?: boolean;
}

export function standingsTable(rows: D.StandingRow[], o: StandingsOpts = {}): Raw {
  const list = o.limit ? rows.slice(0, o.limit) : rows;
  const sanctions = D.SANCTIONS.filter((s) => s.points !== 0 && rows.some((r) => r.team.slug === s.team));
  return html`<div class="tbl-wrap"><table class="st ${o.compact ? 'st-compact' : ''}">
    ${o.caption ? html`<caption class="sr">${o.caption}</caption>` : ''}
    <thead><tr>
      <th scope="col" class="c-rank"><abbr title="Rang">${t('colRank')}</abbr></th>
      ${o.compact ? '' : html`<th scope="col" class="c-chg"><abbr title="Évolution depuis la semaine dernière">${t('colMove')}</abbr></th>`}
      <th scope="col" class="c-team">${t('colTeam')}</th>
      <th scope="col" class="num"><abbr title="${t('colPlayedLong')}">${t('colPlayed')}</abbr></th>
      <th scope="col" class="num"><abbr title="${t('legendW')}">${t('colW')}</abbr></th>
      <th scope="col" class="num"><abbr title="${t('legendL')}">${t('colL')}</abbr></th>
      ${o.compact ? '' : html`<th scope="col" class="num hide-s"><abbr title="${t('legendRW')}">${t('colRW')}</abbr></th><th scope="col" class="num hide-s"><abbr title="${t('legendRL')}">${t('colRL')}</abbr></th>`}
      <th scope="col" class="num"><abbr title="${t('legendDiff')}">${t('colDiff')}</abbr></th>
      <th scope="col" class="num c-pts"><abbr title="${t('legendPts')}">${t('colPts')}</abbr></th>
      ${o.compact || o.form === false ? '' : html`<th scope="col" class="c-form hide-m">${t('colForm')}</th>`}
    </tr></thead>
    <tbody>
    ${list.map((r) => {
      const hl = o.highlight?.includes(r.team.slug);
      const sanction = r.sanction !== 0;
      return html`<tr class="${r.zone ? `z z-${r.zone}` : ''} ${r.excluded ? 'ex' : ''} ${hl ? 'hl' : ''}">
        <td class="c-rank">${r.excluded ? html`<abbr title="${t('excluded')}">EX</abbr>` : html`${r.rank}${r.shared ? html`<abbr class="eq" title="${t('shared')}">=</abbr>` : ''}`}${r.zone && !r.excluded ? html`<span class="zl" aria-label="${zoneKeyLabel(r.zone)}">${ZONE_MARK[r.zone]}</span>` : ''}</td>
        ${o.compact ? '' : html`<td class="c-chg">${changeCell(r.change)}</td>`}
        <th scope="row" class="c-team">${teamName(r.team, { size: 22 })}${r.excluded ? pill('muted', t('excluded'), 'pill-xs') : ''}${sanction ? html`<a class="note-ref" href="#sanctions" title="${t('sanction')}">*</a>` : ''}</th>
        <td class="num">${r.played}</td>
        <td class="num">${r.wins}</td>
        <td class="num">${r.losses}</td>
        ${o.compact ? '' : html`<td class="num hide-s">${r.roundsWon}</td><td class="num hide-s">${r.roundsLost}</td>`}
        <td class="num diff ${r.diff > 0 ? 'pos' : r.diff < 0 ? 'neg' : ''}">${D.signed(r.diff)}</td>
        <td class="num c-pts">${r.points}</td>
        ${o.compact || o.form === false ? '' : html`<td class="c-form hide-m">${formDots(r.form)}</td>`}
      </tr>`;
    })}
    </tbody>
  </table></div>
  ${o.compact ? '' : zoneLegend(rows)}
  ${
    !o.compact && sanctions.length
      ? html`<ol class="notes" id="sanctions">${sanctions.map(
          (s) => html`<li><span class="note-mark">*</span> <strong>${D.team(s.team).name}</strong> : ${D.signed(s.points)} pts, sanction du ${D.dateShort(s.at)}. ${s.reason}.</li>`,
        )}</ol>`
      : ''
  }`;
}

// ---------------------------------------------------------------------------------------------
// Small facts.

export function facts(items: [string | Raw, string | Raw][]): Raw {
  return html`<dl class="facts">${items.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
}

export function sourceBadge(s: D.StatsSource): Raw {
  const l = sourceLabel[s];
  return pill(l.tone, html`${s === 'replay_verified' ? icon('check', 12) : s === 'replay_unverified' ? icon('clock', 12) : ''}${l.label}`);
}

/** A percentile bar: the value's place among the division (0–100). */
export function pctBar(p: number | null): Raw {
  if (p === null) return html`<span class="pbar pbar-na">–</span>`;
  return html`<span class="pbar" role="img" aria-label="${p}e percentile"><span class="pbar-fill" style="width:${Math.max(2, p)}%"></span></span>`;
}

export const sideLabel = (s: 'atk' | 'def') => (s === 'atk' ? 'Attaque' : 'Défense');
export const sideShort = (s: 'atk' | 'def') => (s === 'atk' ? 'ATK' : 'DEF');
