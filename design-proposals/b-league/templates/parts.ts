// Components shared by B's pages: badges, pills, match rows, the standings table, the match hero,
// scoreboards, round timelines and veto steps.

import * as D from '../../_data/index.ts';
import { html, icon, href, raw, teamBadge, flag, accentOn, contrast, textOn, teamRoute, playerRoute, matchRoute, type Raw } from '../../_build/lib.ts';
import { t } from '../../_build/i18n.ts';
import { statusOf, scoreOf, zonesIn, zoneKeyLabel, sourceLabel, winConditionLabel, type Tone } from '../../_build/shared.ts';

export const BG = '#111214';

export const badge = (team: D.Team, size = 24) => teamBadge(team, { size, shape: 'square' });
export const teamColor = (team: D.Team) => accentOn(team, BG);

export function pill(label: string, tone: Tone, ic?: Parameters<typeof icon>[0]): Raw {
  return html`<span class="pill ${tone}">${ic ? icon(ic, 12) : ''}${label}</span>`;
}

export function sectionHead(title: string, opts: { small?: string; link?: [string, string]; id?: string; level?: 2 | 3 } = {}): Raw {
  return html`<div class="section-head"${opts.id ? raw(` id="${opts.id}"`) : ''}><h2>${title}${opts.small ? html`<small>${opts.small}</small>` : ''}</h2>${opts.link ? html`<a href="${href(opts.link[1])}">${opts.link[0]} ${icon('chevronRight', 14)}</a>` : ''}</div>`;
}

export function teamLink(team: D.Team, size = 24): Raw {
  return html`<span class="team-cell">${badge(team, size)}<a href="${href(teamRoute(team))}"><span class="name">${team.name}</span><span class="tag">${team.tag}</span></a></span>`;
}

export function playerLink(slug: string, opts: { flag?: boolean } = {}): Raw {
  const p = D.player(slug);
  return html`${opts.flag !== false ? html`${flag(p.nat)} ` : ''}<a href="${href(playerRoute(slug))}">${p.tag}</a>`;
}

export const divName = (slug: string) => ({ 'ligue-1': 'Ligue 1', 'ligue-2': 'Ligue 2', 'division-1': 'Division 1' })[slug] ?? slug;

export function signedCell(n: number): Raw {
  const cls = n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero';
  return html`<span class="${cls}">${D.signed(n)}</span>`;
}

/** Match status pill with the word, never colour alone. */
export function statusPill(m: D.Match): Raw {
  const s = statusOf(m);
  const ic = s.key === 'disputed' ? 'alert' : s.key === 'reported' ? 'clock' : s.key === 'validated' ? 'check' : undefined;
  return html`${pill(s.label, s.tone, ic)}${m.extension && m.status !== 'validated' ? pill(t('stExtension'), 'warn') : ''}`;
}

/** Who hosts and who chooses sides, as a short line. */
export function sidesLine(m: D.Match): string {
  if (m.forfeit || m.status === 'void' || m.status === 'no_result') return '';
  if (m.coinToss) return 'Tirage au sort (semaine 1)';
  const parts: string[] = [];
  if (m.host) parts.push(`Hôte ${(m.host === 'a' ? m.a : m.b).tag}`);
  if (m.sideChooser) parts.push(`côté ${(m.sideChooser === 'a' ? m.a : m.b).tag}`);
  return parts.join(' · ');
}

/** One match line: time box, both teams, score or VS, status. */
export function matchRow(m: D.Match, opts: { showDiv?: boolean; today?: boolean } = {}): Raw {
  const s = scoreOf(m);
  const at = m.scheduledAt ?? (m.status === 'proposed' ? m.proposal?.at ?? null : null);
  const when = at
    ? html`<b>${D.day(at)}</b>${D.timeZ(at)}`
    : m.status === 'to_schedule'
      ? html`<b>—</b>avant le ${D.dateShort(D.weekRange(m.week).end)}`
      : html`<b>—</b>`;
  const loser = (side: 'a' | 'b') => (s && s.winner !== side ? ' loser' : '');
  const mid = s
    ? html`<div class="mid">${s.a}–${s.b}${s.forfeit ? html`<small>W.O.</small>` : m.game?.overtime ? html`<small>prol.</small>` : ''}</div>`
    : m.status === 'reported' && m.reported
      ? html`<div class="mid" style="color:var(--text-2)">${m.reported.score[0]}–${m.reported.score[1]}<small>déclaré</small></div>`
      : html`<div class="mid vs">VS</div>`;
  const sub = [opts.showDiv ? `${divName(m.division)} · S${m.week}` : '', m.status === 'proposed' && m.proposal ? `proposé par ${(m.proposal.by === 'a' ? m.a : m.b).tag}` : sidesLine(m)].filter(Boolean).join(' · ');
  return html`<a class="mrow${opts.today ? ' today' : ''}" href="${href(matchRoute(m.id))}">
    <div class="when">${when}</div>
    <div class="side a${loser('a')}"><span class="name">${m.a.name}</span><span class="tag">${m.a.tag}</span>${badge(m.a, 28)}</div>
    ${mid}
    <div class="side b${loser('b')}">${badge(m.b, 28)}<span class="name">${m.b.name}</span><span class="tag">${m.b.tag}</span></div>
    <div class="meta">${statusPill(m)}${sub ? html`<span class="sub">${sub}</span>` : ''}</div>
  </a>`;
}

export function formDots(form: D.FormResult[]): Raw {
  return html`<span class="form">${form.map(
    (f) => html`<i class="${f.result}${f.forfeit ? ' F' : ''}" title="${f.result === 'W' ? t('formWin') : t('formLoss')}${f.forfeit ? ` ${t('formForfeit')}` : ''} · ${f.label}">${f.result}</i>`,
  )}<span class="sr">${form.map((f) => (f.result === 'W' ? t('formWin') : t('formLoss')) + (f.forfeit ? ` ${t('formForfeit')}` : '')).join(', ')}</span></span>`;
}

function moveCell(change: number | null): Raw {
  if (change === null) return html`<span class="same">–</span>`;
  if (change > 0) return html`<span class="up">${icon('up', 12, `+${change}`)} ${change}</span>`;
  if (change < 0) return html`<span class="down">${icon('down', 12, String(change))} ${-change}</span>`;
  return html`<span class="same" title="${t('noChange')}">–</span>`;
}

const ZONE_MARK: Record<Exclude<D.Zone, null>, string> = { champion: 'C', promotion: 'M', barrage_promotion: 'B', barrage_relegation: 'B', relegation: 'D' };

export function zoneBar(z: D.Zone): Raw {
  if (!z) return html`<span class="zbar none"></span>`;
  return html`<span class="zbar z-${z}" title="${zoneKeyLabel(z)}">${ZONE_MARK[z]}<span class="sr"> ${zoneKeyLabel(z)}</span></span>`;
}

/** The standings table of section 11, full or compact. */
export function standingsTable(division: string, opts: { compact?: boolean; limit?: number; caption?: string } = {}): Raw {
  const rows = D.standings(division);
  const shown = opts.limit ? rows.slice(0, opts.limit) : rows;
  const sanctions = D.SANCTIONS.filter((s) => s.division === division && s.points !== 0);
  const compact = !!opts.compact;
  return html`<div class="table-wrap"><table class="tbl standings${compact ? ' compact' : ''}">
    <caption class="sr">${opts.caption ?? `${t('standings')} ${divName(division)}`}</caption>
    <thead><tr>
      <th class="zone-cell"><span class="sr">Zone</span></th>
      <th scope="col">${t('colRank')}</th>
      ${compact ? '' : html`<th scope="col" class="hide-m"><abbr title="Évolution depuis la semaine dernière">${t('colMove')}</abbr></th>`}
      <th scope="col">${t('colTeam')}</th>
      <th scope="col" class="r"><abbr title="${t('colPlayedLong')}">${t('colPlayed')}</abbr></th>
      <th scope="col" class="r"><abbr title="${t('legendW')}">${t('colW')}</abbr></th>
      <th scope="col" class="r"><abbr title="${t('legendL')}">${t('colL')}</abbr></th>
      ${compact ? '' : html`<th scope="col" class="r hide-m"><abbr title="${t('legendRW')}">${t('colRW')}</abbr></th><th scope="col" class="r hide-m"><abbr title="${t('legendRL')}">${t('colRL')}</abbr></th>`}
      <th scope="col" class="r"><abbr title="${t('legendDiff')}">${t('colDiff')}</abbr></th>
      <th scope="col" class="r"><abbr title="${t('legendPts')}">${t('colPts')}</abbr></th>
      ${compact ? '' : html`<th scope="col" class="hide-m">${t('colForm')}</th>`}
    </tr></thead>
    <tbody>${shown.map(
      (r) => html`<tr class="${r.excluded ? 'excluded' : ''}">
        <td class="zone-cell">${zoneBar(r.zone)}</td>
        <th scope="row" class="rank">${r.excluded ? html`<abbr title="${t('excluded')}">EX</abbr>` : html`${r.rank}${r.shared ? html`<abbr title="${t('shared')}">=</abbr>` : ''}`}</th>
        ${compact ? '' : html`<td class="move hide-m">${moveCell(r.change)}</td>`}
        <td>${teamLink(r.team, compact ? 22 : 26)}${r.excluded ? html` <span class="pill muted">${t('excluded')}</span>` : ''}</td>
        <td class="r">${r.played}</td>
        <td class="r">${r.wins}</td>
        <td class="r">${r.losses}</td>
        ${compact ? '' : html`<td class="r hide-m">${r.roundsWon}</td><td class="r hide-m">${r.roundsLost}</td>`}
        <td class="r">${signedCell(r.diff)}</td>
        <td class="r pts">${r.points}${r.sanction ? html`<sup aria-label="sanction">*</sup>` : ''}</td>
        ${compact ? '' : html`<td class="hide-m">${formDots(r.form)}</td>`}
      </tr>`,
    )}</tbody>
  </table></div>
  ${
    compact
      ? ''
      : html`<ul class="legend" aria-label="Zones">${zonesIn(rows).map((z) => html`<li>${zoneBar(z)}${zoneKeyLabel(z)}</li>`)}<li><span class="form"><i class="W">W</i><i class="L F">L</i></span>${t('formWin')} · ${t('formLoss')} ${t('formForfeit')} (cadre)</li></ul>
  <p class="abbr"><b>${t('colPlayed')}</b> ${t('colPlayedLong').toLowerCase()} · <b>W</b> ${t('legendW')} · <b>L</b> ${t('legendL')} · <b>RW</b> ${t('legendRW')} · <b>RL</b> ${t('legendRL')} · <b>Diff</b> ${t('legendDiff')} · <b>PTS</b> ${t('legendPts')} (3 par victoire, forfait 7–0) · <b>=</b> ${t('shared')}</p>
  <ul class="footnotes">
    ${sanctions.map((s) => html`<li>* ${D.team(s.team).name} : ${D.signed(s.points)} pts, ${t('sanction').toLowerCase()} du ${D.dateShort(s.at)} (${s.reason}).</li>`)}
    ${rows.filter((r) => r.excluded).map((r) => html`<li><b>${t('excluded')}</b> : ${r.team.name}, ${D.EXCLUDED[r.team.slug]?.reason}. Règle des 50 % : ses matchs comptent comme forfaits 7–0 pour l’adversaire.</li>`)}
  </ul>`
  }`;
}

/** The hero of a match page: stage in spaced capitals, both teams large, VS or score, date box. */
export function matchHero(opts: {
  stage: string;
  sub?: string;
  a: D.Team;
  b: D.Team;
  aSub?: string;
  bSub?: string;
  score?: [number, number] | null;
  centrePill?: Raw;
  at?: number | null;
  facts?: Raw;
}): Raw {
  const s = opts.score;
  const field = (team: D.Team) => html`<span class="field">${teamBadge(team, { size: 132, shape: 'square' })}</span>`;
  const side = (team: D.Team, sub: string | undefined) => html`<a class="team" href="${href(teamRoute(team))}" style="--team:${teamColor(team)}">${field(team)}<span class="tname"><span class="full">${team.name}</span><span class="short">${team.tag}</span></span>${sub ? html`<span class="tsub">${sub}</span>` : ''}</a>`;
  return html`<section class="hero"><div class="wrap">
    <p class="stage">${opts.stage}</p>${opts.sub ? html`<p class="stage">${opts.sub}</p>` : ''}
    <div class="duel">
      ${side(opts.a, opts.aSub)}
      <div class="centre">
        ${
          s
            ? html`<div class="score" aria-label="Score ${s[0]} à ${s[1]}"><span class="${s[0] < s[1] ? 'lose' : ''}">${s[0]}</span><span class="dash">–</span><span class="${s[1] < s[0] ? 'lose' : ''}">${s[1]}</span></div>`
            : html`<div class="vs">VS</div>`
        }
        ${opts.centrePill ? html`<div class="pills">${opts.centrePill}</div>` : ''}
      </div>
      ${side(opts.b, opts.bSub)}
    </div>
    ${opts.at ? html`<div class="datebox"><div><span>${icon('calendar', 20)} ${D.day(opts.at)}</span><span>${icon('clock', 20)} ${D.timeZ(opts.at)}</span></div></div>` : ''}
    ${opts.facts ? html`<div class="hero-facts">${opts.facts}</div>` : ''}
  </div></section>`;
}

// ---------------------------------------------------------------------------------------------
// Maps: flat colour placeholders where a thumbnail would sit (no Ubisoft art).

const MAP_TONES: Record<string, string> = {
  Bank: '#3d4a5c', Border: '#6b5a3e', Chalet: '#4c5e57', Clubhouse: '#5a4646', Consulate: '#4b4f6b',
  'Kafe Dostoyevsky': '#6a4a37', Lair: '#3f5560', 'Nighthaven Labs': '#3c5a4a', Skyscraper: '#5b4a62',
};
export const mapTone = (m: string) => MAP_TONES[m] ?? '#3a3b40';
export const mapChip = (m: string) => html`<span style="display:inline-block;width:10px;height:10px;background:${mapTone(m)};vertical-align:-1px;margin-right:6px" aria-hidden="true"></span>${m}`;

// ---------------------------------------------------------------------------------------------
// Scoreboards and rounds.

export function scoreboard(rounds: D.Round[], side: 'a' | 'b', team: D.Team, source: D.StatsSource, won: boolean | null, score: number | null): Raw {
  const replay = source === 'replay_verified' || source === 'replay_unverified';
  const lineup = [...new Set(rounds.flatMap((r) => r.players.filter((p) => p.team === side).map((p) => p.player)))];
  const rows = lineup.map((slug) => ({ slug, tot: D.addRounds(D.emptyTotals(), rounds, slug, replay), p: D.player(slug) }));
  rows.sort((x, y) => (y.p.consent ? 1 : 0) - (x.p.consent ? 1 : 0) || y.tot.kills - x.tot.kills);
  const na = html`<span class="dim">–</span>`;
  return html`<div class="sb-head" style="--team:${teamColor(team)}">${badge(team, 30)}<h3>${team.name}</h3>${score !== null ? html`<span class="res">${score}${won === null ? '' : won ? html` <span class="pill done">Victoire</span>` : html` <span class="pill muted">Défaite</span>`}</span>` : ''}</div>
  <div class="table-wrap"><table class="tbl scoreboard">
    <thead><tr><th scope="col">Joueur</th><th scope="col" class="r">K</th><th scope="col" class="r">D</th><th scope="col" class="r">A</th><th scope="col" class="r"><abbr title="Kills / morts">K/D</abbr></th><th scope="col" class="r hide-m"><abbr title="Kills en headshot">HS %</abbr></th><th scope="col" class="r"><abbr title="Rounds avec kill, objectif, survie ou trade">KOST</abbr></th><th scope="col" class="r hide-m"><abbr title="Ouvertures gagnées − perdues">Entry</abbr></th><th scope="col" class="r hide-m"><abbr title="Clutchs gagnés / tentés">Clutch</abbr></th><th scope="col" class="r hide-m">Plants</th><th scope="col" class="hide-m">Opérateur</th></tr></thead>
    <tbody>${rows.map(({ slug, tot, p }) => {
      if (!p.consent) {
        return html`<tr><th scope="row" class="player">${playerLink(slug)}</th><td colspan="10" class="hidden-stats">${icon('lock', 12)} Stats non publiées : pas de consentement</td></tr>`;
      }
      const d = D.derived(tot);
      return html`<tr><th scope="row" class="player" style="font-weight:600">${playerLink(slug)}</th>
        <td class="r strong">${tot.kills}</td><td class="r">${tot.deaths}</td><td class="r">${tot.assists}</td>
        <td class="r">${D.ratio(d.kd)}</td><td class="r hide-m">${D.pct(d.hs)}</td>
        <td class="r">${replay ? D.pct(d.kost) : na}</td>
        <td class="r hide-m">${replay && d.entry !== null ? signedCell(d.entry) : na}</td>
        <td class="r hide-m">${replay ? `${tot.clutchWins}/${tot.clutchAttempts}` : na}</td>
        <td class="r hide-m">${replay ? tot.plants : na}</td>
        <td class="hide-m">${replay ? d.topOperator ?? '–' : na}</td></tr>`;
    })}</tbody>
  </table></div>`;
}

const CONDITION_SHORT: Record<D.WinCondition, string> = { elimination: 'ÉLIM', defuser: 'BOMBE', time: 'TEMPS', disable: 'DÉSAM' };

export function roundTimeline(game: D.GameSim, a: D.Team, b: D.Team): Raw {
  const items: Raw[] = [];
  let lastLobby = 0;
  let otShown = false;
  for (const r of game.rounds) {
    if (r.lobby !== lastLobby) {
      if (game.lobbies > 1) items.push(html`<div class="div">Lobby ${r.lobby}${r.lobby > 1 ? ' · re-host, le score repart du score d’avant le crash' : ''}</div>`);
      lastLobby = r.lobby;
    }
    if (r.overtime && !otShown) {
      items.push(html`<div class="div">Prolongation · 6–6, ${(game.otAttacker === 'a' ? a : b).tag} en attaque au round 13, puis les côtés alternent</div>`);
      otShown = true;
    }
    if (r.kind === 'void') {
      items.push(html`<div class="rnd void"><b>—</b>Annulé<br>crash</div>`);
      continue;
    }
    const winner = r.winner === 'a' ? a : b;
    const atk = r.attacker === r.winner;
    items.push(html`<div class="rnd${r.overtime ? ' ot' : ''}" style="--rc:${teamColor(winner)}" title="Round ${r.n} : ${winner.name}, ${atk ? 'attaque' : 'défense'}, ${winConditionLabel[r.condition as D.WinCondition]}"><b>${r.n}</b><span class="w">${winner.tag}</span><br>${atk ? 'ATT' : 'DÉF'} · ${CONDITION_SHORT[r.condition as D.WinCondition]}</div>`);
  }
  return html`<div class="rounds">${items}</div>
  <p class="note">Chaque case : numéro du round, vainqueur (couleur de l’équipe et tag), côté du vainqueur (ATT/DÉF) et condition : ÉLIM élimination, BOMBE désamorceur posé et protégé, TEMPS temps écoulé, DÉSAM désamorceur coupé.</p>`;
}

export function sourceBadge(source: D.StatsSource, coverage?: string): Raw {
  const s = sourceLabel[source];
  return html`<div class="callout ${s.tone === 'done' ? 'done' : s.tone === 'pending' ? 'warn' : ''}"><strong>${icon(source === 'replay_verified' ? 'check' : source === 'none' ? 'x' : 'file', 14)} ${s.label}${coverage ? html` · <span class="muted">${coverage}</span>` : ''}</strong>${s.note}</div>`;
}

// ---------------------------------------------------------------------------------------------
// Veto steps.

export function vetoSteps(m: D.Match, steps: D.VetoStep[], total: number, nowSeq: number | null): Raw {
  const team = (s: 'a' | 'b' | null) => (s === 'a' ? m.a : s === 'b' ? m.b : null);
  const sideFR = (s?: 'atk' | 'def') => (s === 'atk' ? 'Attaque' : s === 'def' ? 'Défense' : '');
  const actLabel = { ban: 'Ban', pick: 'Pick', decider: 'Carte jouée', side: 'Côté de départ', ot_side: 'Côté en prolongation' };
  const sequence: { seq: number; team: 'a' | 'b' | null; action: D.VetoStep['action'] }[] = [];
  const firstBan = steps[0]?.team ?? m.sideChooser ?? 'a';
  for (let i = 0; i < 8; i++) sequence.push({ seq: i + 1, team: i % 2 === 0 ? firstBan : firstBan === 'a' ? 'b' : 'a', action: 'ban' });
  sequence.push({ seq: 9, team: null, action: 'decider' });
  sequence.push({ seq: 10, team: m.sideChooser, action: 'side' });
  sequence.push({ seq: 11, team: m.otSideChooser, action: 'ot_side' });
  return html`<ol class="steps">${sequence.slice(0, total).map((q) => {
    const done = steps.find((s) => s.seq === q.seq);
    const tm = team(q.team);
    const isNow = nowSeq === q.seq;
    return html`<li class="step${isNow ? ' now' : done ? '' : ' todo'}">
      <span class="n">${q.seq}</span>
      <span class="act">${actLabel[q.action]}</span>
      <span class="who">${tm ? html`${badge(tm, 20)} ${tm.tag}` : html`<span class="dim">Restante</span>`}${done?.map ? html` · <b>${done.map}</b>` : ''}${done?.side ? html` · <b>${sideFR(done.side)}</b>` : ''}</span>
      <span>${done ? (done.timedOut ? pill('Temps écoulé : ban au hasard', 'warn', 'timer') : done.took ? html`<span class="dim">${Math.floor(done.took / 60)}:${String(done.took % 60).padStart(2, '0')}</span>` : '') : isNow ? pill('À jouer', 'live') : html`<span class="dim">—</span>`}</span>
    </li>`;
  })}</ol>`;
}

export { contrast, textOn, icon, flag, html, raw, href, teamBadge };
