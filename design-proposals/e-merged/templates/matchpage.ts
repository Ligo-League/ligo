// E's match pages: C's centred header and in-match tabs (each tab its own URL) inside A's frame.
// The right column holds only this match's context: veto, facts, the two teams in the standings,
// the same week's other matches. Rounds get their own page: operators (with swaps), kill feed in
// feed order, objective, win condition and the round MVP.

import * as D from '../../_data/index.ts';
import { html, href, icon, raw, teamBadge, type Raw } from '../../_build/lib.ts';
import { scoreOf, sourceLabel, winConditionLabel, sideTeam, otherSide } from '../../_build/shared.ts';
import { page, type Viewer } from './layout.ts';
import { team, panel, pill, status, sourceBadge, playerLink, kv, tabs, matchRow, signedCell } from './parts.ts';
import { boardSide, lineup, preview, metaFor, type Board } from './match.ts';
import { mapArt, opIcon, photo, mvpMark } from './art.ts';
import { focusMatch, qStandings, qWeek, qResults, qMercato } from './quick.ts';

type Side = 'a' | 'b';
const divName = (d: string) => (d === 'ligue-1' ? 'Ligue 1' : 'Ligue 2');
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
const counted = (g: D.GameSim) => g.rounds.filter((r) => r.kind === 'replay');
const visible = (slug: string) => D.player(slug).consent;
const shown = (slug: string) => (visible(slug) ? playerLink(slug) : html`<span class="masked" title="Statistiques non publiées : politique de confidentialité non acceptée">${D.player(slug).tag}</span>`);

const crumbsFor = (m: D.Match, last: string): [string, string | null][] => [
  ['Ligo', '/'], ['LFR', '/mbl-group/lfr/s3'], [divName(m.division), `/mbl-group/lfr/s3/standings/${m.division}`],
  [`Semaine ${m.week}`, '/mbl-group/lfr/s3/calendar'], [`${m.a.tag} – ${m.b.tag}`, last ? `/matches/${m.id}` : null], ...(last ? [[last, null] as [string, null]] : []),
];

// ---------------------------------------------------------------------------------------------
// Header (C) with the map banner of a played match.

function hero(m: D.Match, opts: { center: Raw; line: Raw; banner?: string | null }): Raw {
  const side = (tm: D.Team, s: Side) =>
    html`<a class="hx-team ${s}" href="${href(`/teams/${tm.slug}`)}">${teamBadge(tm, { size: 52 })}<span class="hx-txt"><span class="hx-n">${tm.name}</span><span class="hx-tg">${tm.tag}</span><span class="hx-m">${metaFor(tm)}</span></span></a>`;
  return html`<section class="hx">
    ${opts.banner ? html`<div class="hx-banner">${mapArt(opts.banner, { ratio: '4x1', label: false })}<span class="hx-map">${opts.banner}</span></div>` : ''}
    <div class="hx-ctx"><a href="${href('/mbl-group/lfr/s3')}">LFR Saison 3</a> · ${divName(m.division)} · Semaine ${m.week}${m.extension ? ' (prolongation)' : ''} · BO${m.bestOf}</div>
    <div class="hx-body">${side(m.a, 'a')}<div class="hx-mid">${opts.center}</div>${side(m.b, 'b')}</div>
    <div class="hx-line">${opts.line}</div>
  </section>`;
}

function playedCenter(m: D.Match): Raw {
  const sc = scoreOf(m) as NonNullable<ReturnType<typeof scoreOf>>;
  const g = m.game as D.GameSim;
  return html`<div class="hx-score"><span class="${sc.winner === 'a' ? 'w' : ''}">${sc.a}</span><span class="sep">–</span><span class="${sc.winner === 'b' ? 'w' : ''}">${sc.b}</span></div>
    <div class="hx-when">${g.overtime ? 'après prolongation' : 'temps réglementaire'} · ${status(m)}</div>`;
}

/** A's fact line under the header. */
function playedLine(m: D.Match): Raw {
  const g = m.game as D.GameSim;
  const side = m.veto.find((s) => s.action === 'side');
  const ot = m.veto.find((s) => s.action === 'ot_side');
  return html`<span>${icon('calendar', 12)} <b>${m.scheduledAt ? D.when(m.scheduledAt) : ''}</b></span>
    <span>Carte <b>${g.map}</b></span>
    <span>Hôte <b>${m.host ? sideTeam(m, m.host).tag : 'tirage'}</b></span>
    <span>Départ <b>${side?.team ? `${sideTeam(m, side.team).tag} en ${side.side === 'atk' ? 'attaque' : 'défense'}` : '–'}</b></span>
    <span>Prolongation <b>${g.overtime ? `oui · ${ot?.team ? sideTeam(m, ot.team).tag : ''} ${ot?.side === 'atk' ? 'attaque' : 'défense'}` : 'non'}</b></span>
    <span>Lobbys <b>${g.lobbies}</b></span>
    ${m.stream ? html`<span>${icon('play', 12)} <a href="${m.stream}">${m.stream.replace('https://', '')}</a></span>` : ''}
    <span>${sourceBadge(m.stats)}</span>`;
}

function matchTabs(m: D.Match, active: 'resume' | 'tableau' | 'rounds' | 'veto' | 'apercu' | 'compos'): Raw {
  const played = m.status === 'validated' && m.game;
  const replay = m.stats === 'replay_verified' || m.stats === 'replay_unverified';
  const items = played
    ? [
        { label: 'Résumé', route: `/matches/${m.id}`, active: active === 'resume' },
        { label: 'Tableau', route: `/matches/${m.id}/scoreboard`, active: active === 'tableau' },
        ...(replay ? [{ label: 'Rounds', route: `/matches/${m.id}/rounds`, active: active === 'rounds', count: counted(m.game as D.GameSim).length }] : []),
        { label: 'Veto', route: `/matches/${m.id}/veto?state=done`, active: active === 'veto' },
      ]
    : [
        { label: 'Aperçu', route: `/matches/${m.id}`, active: active === 'apercu' },
        { label: 'Compositions', route: `/matches/${m.id}/lineups`, active: active === 'compos' },
        { label: m.vetoState === 'in_progress' ? 'Veto · en direct' : 'Veto', route: `/matches/${m.id}/veto`, active: active === 'veto' },
      ];
  return tabs(items, 'mtabs');
}

// ---------------------------------------------------------------------------------------------
// Right column: this match only.

function vetoMini(m: D.Match, steps: D.VetoStep[] = m.veto): Raw {
  return html`<ol class="vmini">${steps.map((s) => {
    const tm = s.team ? sideTeam(m, s.team) : null;
    if (s.action === 'ban') return html`<li class="ban">${mapArt(s.map as string, { ratio: 'thumb', label: false })}<span class="vm-map">${s.map}</span><span class="vm-who">${tm?.tag} ban${s.timedOut ? html` <abbr title="Temps écoulé : carte tirée au sort">⏱</abbr>` : ''}</span></li>`;
    if (s.action === 'decider' || s.action === 'pick') return html`<li class="pick">${mapArt(s.map as string, { ratio: 'thumb', label: false })}<span class="vm-map"><b>${s.map}</b></span><span class="vm-who">${s.action === 'pick' ? `pick ${tm?.tag}` : 'jouée'}</span></li>`;
    return html`<li class="side"><span class="vm-map">${s.action === 'side' ? 'Départ' : 'Prolongation'}</span><span class="vm-who">${tm?.tag} ${s.side === 'atk' ? 'attaque' : 'défense'}</span></li>`;
  })}</ol>`;
}

/** The two teams' rows in the standings, with their neighbours. */
export function divisionExcerpt(teams: D.Team[], division: string): Raw {
  const rows = D.standings(division);
  const idx = teams.map((tm) => rows.findIndex((r) => r.team.slug === tm.slug)).filter((i) => i >= 0);
  const keep = new Set<number>();
  for (const i of idx) for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < rows.length) keep.add(j);
  const list = [...keep].sort((a, b) => a - b);
  return html`<table class="st mini"><caption class="vh">Extrait du classement</caption>
    <thead><tr><th scope="col" class="num">#</th><th scope="col" class="tl">Équipe</th><th scope="col" class="num">MJ</th><th scope="col" class="num">Diff</th><th scope="col" class="num pts">PTS</th></tr></thead>
    <tbody>${list.map((i, k) => {
      const r = rows[i] as D.StandingRow;
      const gap = k > 0 && i - (list[k - 1] as number) > 1;
      const me = teams.some((tm) => tm.slug === r.team.slug);
      return html`${gap ? html`<tr class="gap"><td colspan="5">…</td></tr>` : ''}<tr class="${me ? 'is-me' : ''}"><td class="num">${r.excluded ? 'EX' : `${r.rank}${r.shared ? '=' : ''}`}</td><th scope="row" class="tl">${team(r.team, { size: 14, tagOnly: true })}</th><td class="num">${r.played}</td><td class="num">${signedCell(r.diff)}</td><td class="num pts">${r.points}</td></tr>`;
    })}</tbody></table>`;
}

/** The match's own facts (A's "Données du match"). */
function matchFacts(m: D.Match): Raw {
  const g = m.game;
  const range = D.weekRange(m.week);
  return panel(
    'Données du match',
    kv(
      g
        ? [
            ['Statut', html`${status(m)} <span class="faint">confirmé par ${m.b.tag}</span>`],
            ['Stats', sourceBadge(m.stats)],
            ['Couverture', m.stats === 'none' ? 'aucune' : m.stats === 'manual' ? 'feuille de stats, 2 équipes' : `${counted(g).length} rounds · enregistrements des 2 équipes`],
            ['Re-hosts', g.lobbies > 1 ? `${m.a.tag} : 1 · ${m.b.tag} : 0` : 'aucun'],
            ['Capture du score', html`${icon('lock', 11)} <span class="faint">staff et les deux équipes</span>`],
            ['Image', html`<a href="#image">Carte de résultat 1200 px</a>`],
          ]
        : [
            ['Fenêtre', `${D.dateShort(range.start)} – ${D.dateShort(range.end)}`],
            ['Date limite', `dim. ${D.dateShort(range.end)} 23:59`],
            ['Hôte', m.host ? sideTeam(m, m.host).tag : 'à convenir'],
            ['Côté et 1er ban', m.sideChooser ? `${sideTeam(m, m.sideChooser).tag} (moins bien classée)` : 'tirage au sort'],
            ['Côté en prolongation', m.otSideChooser ? sideTeam(m, m.otSideChooser).tag : null],
            ['Stream', m.stream ? html`<a href="${m.stream}">${icon('play', 11)} ${m.stream.replace('https://', '')}</a>` : 'aucun annoncé'],
          ],
    ),
   { cls: 'mfacts' },
  );
}

/** Right column of every match page: the division with both teams marked, the week's other
 *  matches, then A's quick access (the other division, results, mercato). */
function matchRight(m: D.Match, extra: Raw = html``): Raw {
  const f = focusMatch(m);
  return html`${extra}${qStandings(m.division, { teams: f.teams, why: f.why })}${qWeek(m)}${['ligue-1', 'ligue-2'].filter((d) => d !== m.division).map((d) => qStandings(d))}${qResults(f)}${qMercato(f)}`;
}

// ---------------------------------------------------------------------------------------------
// Played match: Résumé.

const COND: Record<D.WinCondition, string> = { elimination: 'É', defuser: 'D', time: 'T', disable: 'C' };

function roundStrip(m: D.Match): Raw {
  const g = m.game as D.GameSim;
  const cells = (s: Side) =>
    g.rounds.map((r, i) => {
      const prev = g.rounds[i - 1];
      const sep = (prev && prev.lobby !== r.lobby) || r.n === 13 ? html`<span class="rs-sep" aria-hidden="true"></span>` : '';
      if (r.kind === 'void') return html`${sep}<span class="rs-c void" title="Round interrompu (crash), annulé">×</span>`;
      const won = r.winner === s;
      return html`${sep}<a class="rs-c ${won ? `w ${r.attacker === s ? 'atk' : 'def'}` : ''}" href="${href(`/matches/${m.id}/rounds/${r.n}`)}" title="Round ${r.n} : ${won ? 'gagné' : 'perdu'} en ${r.attacker === s ? 'attaque' : 'défense'}${won && r.condition ? `, ${winConditionLabel[r.condition]}` : ''}">${won && r.condition ? COND[r.condition] : ''}</a>`;
    });
  const nums = g.rounds.map((r, i) => {
    const prev = g.rounds[i - 1];
    const sep = (prev && prev.lobby !== r.lobby) || r.n === 13 ? html`<span class="rs-sep" aria-hidden="true"></span>` : '';
    return html`${sep}<span class="rs-n">${r.n ?? '×'}</span>`;
  });
  return html`<div class="rs" role="group" aria-label="Rounds, cliquables">
    <div class="rs-row"><span class="rs-l">${m.a.tag}</span>${cells('a')}</div>
    <div class="rs-row nums"><span class="rs-l"></span>${nums}</div>
    <div class="rs-row"><span class="rs-l">${m.b.tag}</span>${cells('b')}</div>
  </div>
  <p class="rs-key"><span><i class="k atk"></i>gagné en attaque</span><span><i class="k def"></i>gagné en défense</span><span><b>É</b> élimination · <b>D</b> désamorceur posé · <b>T</b> temps · <b>C</b> désamorceur coupé</span>${g.lobbies > 1 ? html`<span><b>×</b> round interrompu (re-host)</span>` : ''}${g.overtime ? html`<span>┆ prolongation</span>` : ''}</p>`;
}

/** The match's best players on this map, ranked by round MVPs then K/D. */
function standouts(m: D.Match): Raw {
  const g = m.game as D.GameSim;
  const mvps = new Map<string, number>();
  for (const r of counted(g)) if (r.mvp) mvps.set(r.mvp, (mvps.get(r.mvp) ?? 0) + 1);
  const ids = [...new Set(counted(g).flatMap((r) => r.players.map((p) => p.player)))].filter(visible);
  const rows = ids
    .map((id) => ({ id, t: D.addRounds(D.emptyTotals(), g.rounds, id, true), mvp: mvps.get(id) ?? 0 }))
    .sort((a, b) => b.mvp - a.mvp || D.derived(b.t).kd - D.derived(a.t).kd)
    .slice(0, 3);
  return html`<ol class="stand">${rows.map((r, i) => {
    const tm = D.teamOf(r.id) as D.Team;
    const d = D.derived(r.t);
    return html`<li class="${i === 0 ? 'first' : ''}">${photo(r.id, i === 0 ? 56 : 40)}<div><div class="sd-n">${playerLink(r.id)} ${team(tm, { size: 14, tagOnly: true })}</div>
      <div class="sd-s"><b>${r.mvp}</b> MVP de round · ${r.t.kills}–${r.t.deaths} · K/D ${D.ratio(d.kd)} · KOST ${D.pct(d.kost)}</div>
      <div class="sd-o">${Object.entries(r.t.operators).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([op, n]) => html`${opIcon(op, 20)}<span class="faint">${n}</span>`)}</div></div></li>`;
  })}</ol>`;
}

export function playedResume(m: D.Match): string {
  const g = m.game as D.GameSim;
  const replay = m.stats === 'replay_verified' || m.stats === 'replay_unverified';
  const l1 = counted(g).filter((r) => r.lobby === 1);
  const l2 = counted(g).filter((r) => r.lobby === 2);
  const main = html`
  ${hero(m, { center: playedCenter(m), line: playedLine(m), banner: g.map })}
  ${matchTabs(m, 'resume')}
  <div class="grid2 m-later">
    ${panel('Veto', vetoMini(m), { extra: html`<span class="faint">BO1 · ${m.coinToss ? 'tirage au sort' : `${sideTeam(m, m.sideChooser ?? 'a').tag} moins bien classée`}</span><a href="${href(`/matches/${m.id}/veto?state=done`)}">Détail</a>` })}
    ${matchFacts(m)}
  </div>
  ${panel(
    'Tableau des scores',
    html`${m.stats === 'none' ? html`<p class="pad faint">Aucun replay ni feuille de stats pour ce match.</p>` : html`${boardSide({ a: m.a, b: m.b, rounds: g.rounds, source: m.stats }, 'a')}${boardSide({ a: m.a, b: m.b, rounds: g.rounds, source: m.stats }, 'b')}`}<p class="pad faint small">${sourceLabel[m.stats].note}</p>`,
    { extra: html`${sourceBadge(m.stats)}<a href="${href(`/matches/${m.id}/scoreboard`)}">Opérateurs</a>` },
  )}
  ${replay
    ? panel('Round par round', html`${roundStrip(m)}${g.lobbies > 1 ? html`<p class="note info">${icon('alert', 12)} Re-host : ${g.lobbies} lobbys, ${l1.filter((r) => r.winner === 'a').length}–${l1.filter((r) => r.winner === 'b').length} puis ${l2.filter((r) => r.winner === 'a').length}–${l2.filter((r) => r.winner === 'b').length} → ${g.scoreA}–${g.scoreB}, 1 round interrompu annulé. Le score d’avant le crash est conservé (règlement 4.3).</p>` : ''}`, { extra: html`<span class="faint">${counted(g).length} rounds</span><a href="${href(`/matches/${m.id}/rounds`)}">Détail des rounds</a>` })
    : ''}
  ${replay ? panel('Joueurs du match', standouts(m), { extra: html`<span class="faint">MVP de round : provisoire (M-37)</span>` }) : ''}`;
  return page({
    title: `${m.a.name} ${m.score?.[0]}–${m.score?.[1]} ${m.b.name}`,
    crumbs: crumbsFor(m, ''),
    main,
    league: { comp: 'lfr', season: 's3', tab: 'calendar' },
    game: 'r6',
    cols: 'right',
    right: matchRight(m),
  });
}

// ---------------------------------------------------------------------------------------------
// Played match: Tableau (full scoreboard with operators).

export function playedScoreboard(m: D.Match): string {
  const g = m.game as D.GameSim;
  const bd: Board = { a: m.a, b: m.b, rounds: g.rounds, source: m.stats };
  const opsTable = (s: Side) => {
    const ids = [...new Set(counted(g).flatMap((r) => r.players.filter((p) => p.team === s).map((p) => p.player)))];
    return html`<table class="data dense"><caption class="vh">Opérateurs joués, ${sideTeam(m, s).name}</caption>
      <thead><tr><th scope="col">${team(sideTeam(m, s), { size: 14 })}</th><th scope="col">Attaque</th><th scope="col">Défense</th><th scope="col" class="num">Échanges</th></tr></thead>
      <tbody>${ids.map((id) => {
        if (!visible(id)) return html`<tr><th scope="row">${shown(id)}</th><td colspan="3" class="faint">masqué</td></tr>`;
        const rs = counted(g).map((r) => r.players.find((p) => p.player === id)).filter((p): p is D.PlayerRound => !!p);
        const count = (side: 'atk' | 'def') => {
          const c = new Map<string, number>();
          for (const p of rs.filter((x) => x.side === side)) c.set(p.operator, (c.get(p.operator) ?? 0) + 1);
          return [...c.entries()].sort((a, b) => b[1] - a[1]);
        };
        return html`<tr><th scope="row">${shown(id)}</th>
          <td><span class="opl">${count('atk').map(([op, n]) => html`${opIcon(op, 20)}<span class="faint">${n}</span>`)}</span></td>
          <td><span class="opl">${count('def').map(([op, n]) => html`${opIcon(op, 20)}<span class="faint">${n}</span>`)}</span></td>
          <td class="num">${rs.filter((p) => p.swappedFrom).length}</td></tr>`;
      })}</tbody></table>`;
  };
  const main = html`
  ${hero(m, { center: playedCenter(m), line: playedLine(m), banner: g.map })}
  ${matchTabs(m, 'tableau')}
  ${panel('Tableau des scores', html`${boardSide(bd, 'a')}${boardSide(bd, 'b')}<p class="pad faint small">KOST : round avec kill, objectif, survie ou échange. Entry : premiers kills − premières morts. Un joueur qui n’a pas accepté la politique de confidentialité apparaît sans stats.</p>`, { extra: sourceBadge(m.stats) })}
  ${panel('Opérateurs', html`<div class="grid2 flat">${opsTable('a')}${opsTable('b')}</div><p class="pad faint small">Nombre de rounds par opérateur ; « échanges » : changements d’opérateur pendant la préparation, d’après le replay.</p>`)}`;
  return page({ title: `${m.a.tag}–${m.b.tag} · tableau`, crumbs: crumbsFor(m, 'Tableau'), main, league: { comp: 'lfr', season: 's3', tab: 'calendar' }, game: 'r6', cols: 'right', right: matchRight(m) });
}

// ---------------------------------------------------------------------------------------------
// Played match: Rounds (list) and one round.

function opsOf(r: D.Round, s: Side): Raw {
  return html`<span class="opl">${r.players.filter((p) => p.team === s).map((p) => opIcon(p.operator, 20, p.swappedFrom ? { swapped: p.swappedFrom } : {}))}</span>`;
}

export function playedRounds(m: D.Match): string {
  const g = m.game as D.GameSim;
  const main = html`
  ${hero(m, { center: playedCenter(m), line: playedLine(m), banner: g.map })}
  ${matchTabs(m, 'rounds')}
  ${panel(
    'Rounds',
    html`<div class="tw"><table class="data rounds-t"><caption class="vh">Tous les rounds</caption>
      <thead><tr><th scope="col" class="num">#</th><th scope="col">Vainqueur</th><th scope="col" class="opt">Fin</th><th scope="col" class="opt2">Site défendu</th><th scope="col" class="opt">${m.a.tag}</th><th scope="col" class="opt">${m.b.tag}</th><th scope="col">MVP</th><th scope="col" class="num opt">Score</th></tr></thead>
      <tbody>${(() => {
        let sa = 0;
        let sb = 0;
        return g.rounds.map((r, i) => {
          const prev = g.rounds[i - 1];
          const lobbyRow = prev && prev.lobby !== r.lobby ? html`<tr class="daysep"><td colspan="8">Lobby ${r.lobby} · re-host, le score repart de ${sa}–${sb}</td></tr>` : '';
          const otRow = r.n === 13 ? html`<tr class="daysep"><td colspan="8">Prolongation · ${sa}–${sb}</td></tr>` : '';
          if (r.kind === 'void') return html`${lobbyRow}<tr class="void"><td class="num">×</td><td colspan="7" class="faint">Round interrompu par un crash (lobby ${r.lobby}), annulé · re-host demandé par ${m.a.tag}</td></tr>`;
          if (r.winner === 'a') sa++;
          else sb++;
          const w = sideTeam(m, r.winner as Side);
          return html`${lobbyRow}${otRow}<tr>
            <td class="num"><a href="${href(`/matches/${m.id}/rounds/${r.n}`)}">${r.n}</a></td>
            <td>${team(w, { size: 14, tagOnly: true })} <span class="faint">en ${r.attacker === r.winner ? 'attaque' : 'défense'}</span></td>
            <td class="opt">${r.condition ? winConditionLabel[r.condition] : ''}</td>
            <td class="opt2 faint">${r.site}</td>
            <td class="opt">${opsOf(r, 'a')}</td><td class="opt">${opsOf(r, 'b')}</td>
            <td>${r.mvp ? playerLink(r.mvp) : html`<span class="faint">–</span>`}</td>
            <td class="num opt">${sa}–${sb}</td></tr>`;
        });
      })()}</tbody></table></div>
      <p class="pad faint small">Chaque numéro ouvre le round : kill feed, opérateurs et échanges, objectif. Une icône soulignée signale un changement d’opérateur pendant la préparation.</p>`,
  )}`;
  return page({ title: `${m.a.tag}–${m.b.tag} · rounds`, crumbs: crumbsFor(m, 'Rounds'), main, league: { comp: 'lfr', season: 's3', tab: 'calendar' }, game: 'r6', cols: 'right', right: matchRight(m) });
}

export function roundPage(m: D.Match, n: number): string {
  const g = m.game as D.GameSim;
  const r = g.rounds.find((x) => x.n === n) as D.Round;
  const list = counted(g);
  const before = list.filter((x) => (x.n ?? 0) < n);
  const sa = before.filter((x) => x.winner === 'a').length;
  const sb = before.filter((x) => x.winner === 'b').length;
  const w = sideTeam(m, r.winner as Side);
  const block = (s: Side) => {
    const tm = sideTeam(m, s);
    return html`<table class="data rp"><caption class="vh">${tm.name}, round ${n}</caption>
      <thead><tr><th scope="col">${team(tm, { size: 16 })} <span class="faint">${r.attacker === s ? 'attaque' : 'défense'}</span></th><th scope="col">Opérateur</th><th scope="col" class="num">K</th><th scope="col" class="num opt">HS</th><th scope="col" class="num opt">A</th><th scope="col">Faits</th></tr></thead>
      <tbody>${r.players.filter((p) => p.team === s).map((p) => {
        if (!visible(p.player)) return html`<tr><th scope="row">${shown(p.player)}</th><td>${opIcon(p.operator, 24)}</td><td colspan="4" class="faint">stats masquées</td></tr>`;
        const facts = [
          p.openingKill ? 'ouverture' : '', p.openingDeath && !p.openingKill ? 'première mort' : '', p.tradeKill ? 'échange' : '', p.plant ? 'désamorceur posé' : '',
          p.defuse ? 'désamorceur coupé' : '', p.clutchVs ? `clutch 1v${p.clutchVs}${p.clutchWon ? ' gagné' : ''}` : '', p.died ? '' : 'survit',
        ].filter(Boolean);
        return html`<tr class="${p.died ? 'dead' : ''}"><th scope="row">${shown(p.player)}${r.mvp === p.player ? mvpMark() : ''}</th>
          <td class="opc">${opIcon(p.operator, 24, p.swappedFrom ? { swapped: p.swappedFrom } : {})}<span>${p.operator}${p.swappedFrom ? html`<br><span class="faint small">échange depuis ${p.swappedFrom}</span>` : ''}</span></td>
          <td class="num">${p.kills}</td><td class="num opt">${p.headshots}</td><td class="num opt">${p.assists}</td><td class="faint small">${facts.join(' · ')}</td></tr>`;
      })}</tbody></table>`;
  };
  const tagOf = (slug: string) => (r.players.find((p) => p.player === slug)?.team === 'a' ? m.a : m.b);
  const name = (slug: string) => (visible(slug) ? D.player(slug).tag : `${D.player(slug).tag}*`);
  const feed = html`<ol class="feed">${r.events.map((e) => {
    const victimTeam = tagOf(e.victim);
    return html`<li><span class="fd-t">${mmss(e.elapsed)}</span>${e.kind === 'kill' && e.killer
      ? html`<span class="fd-k" style="--tc:${tagOf(e.killer).colors[0]}">${name(e.killer)}</span><span class="fd-x" aria-label="${e.headshot ? 'a tué d’un headshot' : 'a tué'}">${e.headshot ? 'HS' : '›'}</span><span class="fd-v" style="--tc:${victimTeam.colors[0]}">${name(e.victim)}</span>`
      : html`<span class="fd-v" style="--tc:${victimTeam.colors[0]}">${name(e.victim)}</span><span class="faint">mort sans tueur (chute ou explosion)</span>`}</li>`;
  })}${r.plantAt ? html`<li class="obj"><span class="fd-t">${mmss(r.plantAt)}</span><span>Désamorceur posé · ${r.site}</span></li>` : ''}
    <li class="end"><span class="fd-t">fin</span><span><b>${w.tag}</b> gagne : ${r.condition ? winConditionLabel[r.condition].toLowerCase() : ''}</span></li></ol>`;
  const chips = html`<nav class="rchips" aria-label="Rounds"><ul>${list.map(
    (x) => html`<li><a class="${x.winner === 'a' ? 'ca' : 'cb'}" href="${href(`/matches/${m.id}/rounds/${x.n}`)}"${x.n === n ? raw(' aria-current="page"') : ''}>${x.n}</a></li>`,
  )}</ul></nav>`;
  const main = html`
  ${hero(m, { center: playedCenter(m), line: playedLine(m) })}
  ${matchTabs(m, 'rounds')}
  ${chips}
  <section class="panel rhead">
    <div class="rh-l">${mapArt(g.map, { ratio: 'thumb', label: false })}<div><h2 class="rh-t">Round ${n}${r.overtime ? ' · prolongation' : ''}${g.lobbies > 1 ? html` <span class="faint">· lobby ${r.lobby}, round ${r.local}</span>` : ''}</h2>
      <div class="faint">${team(sideTeam(m, r.attacker), { size: 14, tagOnly: true, link: false })} attaque · site ${r.site} · score avant le round ${sa}–${sb}</div></div></div>
    <div class="rh-r"><span class="rh-w">${team(w, { size: 20, link: false })}</span><span>${r.condition ? winConditionLabel[r.condition] : ''} · ${sa + (r.winner === 'a' ? 1 : 0)}–${sb + (r.winner === 'b' ? 1 : 0)}</span>${r.mvp ? html`<span>MVP ${playerLink(r.mvp)}</span>` : ''}</div>
  </section>
  <div class="grid2">
    ${panel('Kill feed', feed, { extra: html`<span class="faint">ordre du feed, temps depuis le début du round</span>` })}
    ${panel('MVP du round', r.mvp ? html`<div class="mvpbox">${photo(r.mvp, 72)}<div><div class="sd-n">${playerLink(r.mvp)}</div><div class="faint small">${(() => {
      const p = r.players.find((x) => x.player === r.mvp) as D.PlayerRound;
      return `${p.kills} kill${p.kills > 1 ? 's' : ''}${p.openingKill ? ', ouverture' : ''}${p.clutchWon ? ', clutch gagné' : ''}${p.plant ? ', désamorceur posé' : ''}${p.died ? '' : ', survit'}`;
    })()}</div><p class="faint small">Calcul provisoire : kills, ouverture, clutch, objectif et échanges pondérés (M-37), en attendant le rating d’impact.</p></div></div>` : html`<p class="pad faint">—</p>`)}
  </div>
  ${panel('Joueurs', html`${block('a')}${block('b')}<p class="pad faint small">* stats masquées : politique de confidentialité non acceptée. Ligne grisée : joueur mort dans le round.</p>`)}
  <nav class="rnav">${n > 1 ? html`<a href="${href(`/matches/${m.id}/rounds/${n - 1}`)}">‹ Round ${n - 1}</a>` : html`<span></span>`}${n < list.length ? html`<a href="${href(`/matches/${m.id}/rounds/${n + 1}`)}">Round ${n + 1} ›</a>` : ''}</nav>`;
  return page({ title: `${m.a.tag}–${m.b.tag} · round ${n}`, crumbs: crumbsFor(m, `Round ${n}`), main, league: { comp: 'lfr', season: 's3', tab: 'calendar' }, game: 'r6', cols: 'right', right: matchRight(m) });
}

// ---------------------------------------------------------------------------------------------
// Upcoming match (Aperçu): time instead of score; veto in progress; preview.

export function upcomingPage(m: D.Match, viewer: Viewer = null): string {
  const center = m.scheduledAt
    ? html`<div class="hx-when">${icon('calendar', 12)} ${D.day(m.scheduledAt)}</div><div class="hx-score time">${D.time(m.scheduledAt)}<small>${D.zoneName(m.scheduledAt)}</small></div><div>${status(m)} <span class="faint small">${D.relative(m.scheduledAt)}</span></div>`
    : html`<div class="hx-score time">vs</div><div>${status(m)}</div>`;
  const vetoLive = m.vetoState === 'in_progress';
  const main = html`
  ${hero(m, { center, line: html`Hôte <b>${m.host ? sideTeam(m, m.host).tag : 'à convenir'}</b> · côté et 1er ban <b>${m.sideChooser ? sideTeam(m, m.sideChooser).tag : 'tirage'}</b> · prolongation <b>${m.otSideChooser ? sideTeam(m, m.otSideChooser).tag : '–'}</b>${m.stream ? html` · ${icon('play', 12)} <a href="${m.stream}">${m.stream.replace('https://', '')}</a>` : ''}` })}
  ${matchTabs(m, 'apercu')}
  ${viewer
    ? html`<section class="panel"><div class="ph"><h2>Actions · ${viewer.team ? D.team(viewer.team).name : ''}</h2><div class="ph-x"><span class="faint">${viewer.role}</span></div></div>
      <div class="actions"><a class="btn btn-p" href="${href(`/matches/${m.id}/veto`)}">${icon('timer', 13)}${vetoLive ? 'Reprendre le veto (votre tour)' : 'Lancer le veto'}</a><a class="btn" href="#propose">${icon('calendar', 13)}Proposer un horaire</a><a class="btn" href="#report">${icon('check', 13)}Déclarer le résultat</a><a class="btn" href="#upload">${icon('upload', 13)}Envoyer replays et MOSS</a></div></section>`
    : ''}
  ${vetoLive
    ? html`<a class="vlive" href="${href(`/matches/${m.id}/veto`)}">${pill('live', 'Veto en direct', 'timer')}<span>Étape 5 sur 9 · <b>${m.b.name}</b> bannit · 2:37</span><span class="vlive-maps">${m.veto.map((s) => mapArt(s.map as string, { ratio: 'thumb', label: false, cls: 'banned' }))}</span><span class="go">Suivre ›</span></a>`
    : ''}
  <div class="grid2">
    ${panel('Compositions', html`<div class="lineups one">${lineup(m.a)}${lineup(m.b)}</div>`)}
    ${matchFacts(m)}
  </div>
  ${preview(m)}`;
  return page({
    title: `${m.a.name} – ${m.b.name}`,
    crumbs: crumbsFor(m, ''),
    main,
    league: { comp: 'lfr', season: 's3', tab: 'calendar' },
    game: 'r6',
    cols: 'right',
    right: matchRight(m),
    viewer,
  });
}

// ---------------------------------------------------------------------------------------------
// Veto with map cards.

export function vetoPage(m: D.Match, done: boolean): string {
  const steps = done ? D.finishedVetoOf(m) : m.veto;
  const sequence: { team: Side | null; action: string }[] = [
    ...Array.from({ length: 8 }, (_, i) => ({ team: (i % 2 === 0 ? m.sideChooser : otherSide(m.sideChooser ?? 'a')) as Side, action: 'ban' })),
    { team: null, action: 'decider' }, { team: m.sideChooser, action: 'side' }, { team: m.otSideChooser, action: 'ot_side' },
  ];
  const stepOf = (map: string) => steps.find((s) => s.map === map && (s.action === 'ban' || s.action === 'decider'));
  const turn = done ? null : sequence[steps.length];
  const turnTeam = turn?.team ? sideTeam(m, turn.team) : null;
  const cards = html`<ul class="vcards">${D.MAP_POOL.map((map) => {
    const st = stepOf(map);
    const banned = st?.action === 'ban';
    const played = st?.action === 'decider';
    const by = st?.team ? sideTeam(m, st.team) : null;
    return html`<li class="vc ${banned ? 'is-ban' : ''} ${played ? 'is-pick' : ''} ${!st && !done ? 'is-open' : ''}">
      ${mapArt(map, { ratio: '16x9' })}
      <div class="vc-f">${banned
        ? html`<span class="vc-s">${st.seq}</span><span>${by?.tag} bannit${st.timedOut ? html` · ${pill('warn', 'temps écoulé', 'clock')}` : ''}</span>`
        : played
          ? html`<span class="vc-s">${st.seq}</span><b>Carte jouée</b>`
          : done ? html`<span class="faint">—</span>` : html`<button class="btn btn-ban" type="button">Bannir</button>`}</div>
    </li>`;
  })}</ul>`;
  const sides = done
    ? html`<div class="vsides">${steps.filter((s) => s.action === 'side' || s.action === 'ot_side').map((s) => html`<div><span class="lbl">${s.action === 'side' ? 'Côté de départ' : 'Côté en prolongation'}</span><b>${sideTeam(m, s.team as Side).name}</b> en ${s.side === 'atk' ? 'attaque' : 'défense'}</div>`)}</div>`
    : '';
  const main = html`
  ${hero(m, { center: html`<div class="hx-when">${icon('calendar', 12)} ${D.day(m.scheduledAt as number)}</div><div class="hx-score time">${D.time(m.scheduledAt as number)}<small>CET</small></div><div>${done ? pill('done', 'Veto terminé', 'check') : pill('live', 'Veto en cours', 'timer')}</div>`, line: html`BO1 · pool de 9 cartes · ${m.sideChooser ? sideTeam(m, m.sideChooser).tag : ''} bannit en premier et choisit le côté · 4 min par étape` })}
  ${matchTabs(m, 'veto')}
  ${done
    ? html`<section class="panel vfinal">${mapArt(steps.find((s) => s.action === 'decider')?.map as string, { ratio: '4x1' })}<div class="vf-t"><span class="lbl">Carte jouée</span><b>${steps.find((s) => s.action === 'decider')?.map}</b></div>${sides}</section>`
    : html`<section class="vturn"><div class="vt-who">${turnTeam ? teamBadge(turnTeam, { size: 28 }) : ''}<div><b>À vous : ${turnTeam?.name} bannit</b><br><span class="faint">Étape ${steps.length + 1} sur 9 · vous voyez cette page en tant que manager de ${turnTeam?.tag}</span></div></div>
      <div class="vt-timer" role="timer" aria-label="Temps restant">${icon('timer', 16)}<span class="big">2:37</span><span class="faint">sur 4:00</span><span class="tbar"><span style="width:65%"></span></span></div>
      <p class="faint small">Sans choix à la fin du temps, une carte restante est bannie au hasard. Chaque choix modifie aussi le message du bot sur Discord ; la page se met à jour toute seule.</p></section>`}
  ${panel('Pool de cartes', cards, { extra: html`<span class="faint">${steps.filter((s) => s.action === 'ban').length} bannies · ${9 - steps.filter((s) => s.action === 'ban' || s.action === 'decider').length} restantes</span>` })}`;
  return page({
    title: `Veto ${m.a.tag}–${m.b.tag}`,
    crumbs: crumbsFor(m, 'Veto'),
    main,
    league: { comp: 'lfr', season: 's3', tab: 'calendar' },
    game: 'r6',
    cols: 'right',
    right: html`${panel('Séquence', vetoMini(m, steps), { extra: html`<span class="faint">BO1</span>` })}${panel(
      'Ordre BO1',
      html`<ol class="seq">${sequence.map((s, i) => html`<li class="${i < steps.length ? 'done' : i === steps.length && !done ? 'now' : ''}"><span>${i + 1}.</span> ${s.team ? sideTeam(m, s.team).tag : '—'} ${s.action === 'ban' ? 'ban' : s.action === 'decider' ? 'carte restante jouée' : s.action === 'side' ? 'côté de départ' : 'côté en prolongation'}</li>`)}</ol>`,
    )}${matchRight(m)}`,
    viewer: done ? null : { name: 'Houblon', role: 'Manager · GREED Academy', team: 'greed-academy' },
  });
}
