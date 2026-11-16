// Match pages: a VLR-style header, HLTV-style veto box and lineups, siege.gg-style scoreboards
// and round timeline. One template for every state; sections appear when the data exists.

import * as D from '../../_data/index.ts';
import { html, href, icon, raw, teamBadge, flag, type Raw } from '../../_build/lib.ts';
import { statusOf, scoreOf, sourceLabel, winConditionLabel, otherSide, sideTeam } from '../../_build/shared.ts';
import { page, type Viewer } from './layout.ts';
import { team, panel, pill, status, sourceBadge, playerLink, kv, mapThumb, tabs, signedCell, form } from './parts.ts';

type Side = 'a' | 'b';
const divName = (d: string) => (d === 'ligue-1' ? 'Ligue 1' : 'Ligue 2');
const rankOf = (tm: D.Team) => D.standings(tm.division).find((r) => r.team.slug === tm.slug);
const ordinal = (n: number) => (n === 1 ? '1er' : `${n}e`);

// ---------------------------------------------------------------------------------------------
// Header

interface HeaderOpts {
  a: D.Team;
  b: D.Team;
  context: Raw;
  center: Raw;
  bottom: Raw;
  metaA?: string;
  metaB?: string;
  winner?: Side | null;
}

function header(o: HeaderOpts): Raw {
  const side = (tm: D.Team, s: Side, meta?: string) =>
    html`<a class="mh-team ${s}" href="${href(`/teams/${tm.slug}`)}">${teamBadge(tm, { size: 48 })}<span><span class="nm">${tm.name}</span><br><span class="meta">${meta ?? ''}</span></span></a>`;
  return html`<section class="mh">
    <div class="mh-top">${o.context}</div>
    <div class="mh-body">${side(o.a, 'a', o.metaA)}<div class="mh-mid">${o.center}</div>${side(o.b, 'b', o.metaB)}</div>
    <div class="mh-bot">${o.bottom}</div>
  </section>`;
}

const metaFor = (tm: D.Team) => {
  const r = rankOf(tm);
  if (!r) return '';
  return r.excluded ? `${divName(tm.division)} · exclue` : `${divName(tm.division)} · ${ordinal(r.rank)}${r.shared ? ' ex æquo' : ''} · ${r.points} pts`;
};

function context(m: D.Match): Raw {
  return html`<a href="${href('/c/lfr/s3')}">LFR Saison 3</a><span>${divName(m.division)}</span><span>Semaine ${m.week}${m.extension ? ' (prolongation)' : ''}</span><span>BO${m.bestOf}</span>
    <span class="grow">${status(m)}</span>${m.status === 'validated' ? sourceBadge(m.stats) : ''}`;
}

// ---------------------------------------------------------------------------------------------
// Veto box

export function vetoList(m: D.Match, steps: D.VetoStep[] = m.veto): Raw {
  return html`<ol class="veto-list">${steps.map((s) => {
    const tm = s.team ? sideTeam(m, s.team) : null;
    const label =
      s.action === 'ban'
        ? html`${team(tm as D.Team, { size: 14, tagOnly: true })} <span>a banni</span> <span class="act">${s.map}</span>${s.timedOut ? html` ${pill('warn', 'temps écoulé : tirage', 'clock')}` : ''}`
        : s.action === 'decider'
          ? html`<span class="picked">${s.map}</span> <span>reste : carte jouée</span>`
          : s.action === 'side'
            ? html`${team(tm as D.Team, { size: 14, tagOnly: true })} <span>commence en</span> <span class="act">${s.side === 'atk' ? 'attaque' : 'défense'}</span>`
            : html`${team(tm as D.Team, { size: 14, tagOnly: true })} <span>choisit</span> <span class="act">${s.side === 'atk' ? 'l’attaque' : 'la défense'}</span> <span>en prolongation</span>`;
    return html`<li><span class="n">${s.seq}.</span>${label}</li>`;
  })}</ol>`;
}

// ---------------------------------------------------------------------------------------------
// Scoreboard

interface Board {
  a: D.Team;
  b: D.Team;
  rounds: D.Round[];
  source: D.StatsSource;
}

function boardSide(bd: Board, s: Side): Raw {
  const tm = s === 'a' ? bd.a : bd.b;
  const replay = bd.source === 'replay_verified' || bd.source === 'replay_unverified';
  const ids = [...new Set(bd.rounds.flatMap((r) => r.players.filter((p) => p.team === s).map((p) => p.player)))];
  const rows = ids.map((id) => ({ id, p: D.player(id), t: D.addRounds(D.emptyTotals(), bd.rounds, id, replay) }));
  rows.sort((x, y) => y.t.kills - x.t.kills);
  const dash = html`<span class="faint">–</span>`;
  return html`<div class="tw"><table class="data tagm sb"><caption class="vh">Tableau des scores, ${tm.name}</caption>
    <colgroup><col class="c-pl"><col span="3" class="c-n"><col class="c-n2"><col class="c-n2 opt"><col class="c-n2"><col class="c-n2 opt"><col class="c-n2 opt"><col class="c-n2 opt"><col class="c-op opt2"></colgroup>
    <thead><tr><th scope="col" class="tl" style="width:auto">${team(tm, { size: 16 })}</th>
      <th scope="col" class="num"><abbr title="Kills">K</abbr></th><th scope="col" class="num"><abbr title="Morts">D</abbr></th><th scope="col" class="num"><abbr title="Assistances">A</abbr></th>
      <th scope="col" class="num"><abbr title="Kills / morts">K/D</abbr></th><th scope="col" class="num opt"><abbr title="Headshots / kills">HS %</abbr></th>
      <th scope="col" class="num"><abbr title="Manches avec kill, objectif, survie ou échange (replay)">KOST</abbr></th>
      <th scope="col" class="num opt"><abbr title="Premiers kills − premières morts (replay)">Entry</abbr></th>
      <th scope="col" class="num opt"><abbr title="Clutchs gagnés / tentés (replay)">Clutch</abbr></th>
      <th scope="col" class="num opt"><abbr title="Désamorceurs posés (replay)">Plant</abbr></th>
      <th scope="col" class="opt2"><abbr title="Opérateur le plus joué (replay)">Opérateur</abbr></th></tr></thead>
    <tbody>${rows.map(({ id, p, t: tt }) => {
      if (!p.consent) {
        return html`<tr><th scope="row">${playerLink(id)}</th><td colspan="10" class="faint wrapcell" style="font-style:italic">Statistiques non publiées : le joueur n’a pas donné son accord</td></tr>`;
      }
      const d = D.derived(tt);
      return html`<tr><th scope="row">${playerLink(id)}</th>
        <td class="num">${tt.kills}</td><td class="num">${tt.deaths}</td><td class="num">${tt.assists}</td>
        <td class="num"><span class="${d.kd >= 1 ? 'pos' : 'neg'}">${D.ratio(d.kd)}</span></td><td class="num opt">${D.pct(d.hs)}</td>
        <td class="num">${replay ? D.pct(d.kost) : dash}</td><td class="num opt">${replay && d.entry !== null ? signedCell(d.entry) : dash}</td>
        <td class="num opt">${replay ? `${tt.clutchWins}/${tt.clutchAttempts}` : dash}</td><td class="num opt">${replay ? tt.plants : dash}</td>
        <td class="opt2">${replay ? d.topOperator ?? '' : dash}</td></tr>`;
    })}</tbody></table></div>`;
}

function scoreboard(bd: Board, title = 'Tableau des scores'): Raw {
  const src = sourceLabel[bd.source];
  return panel(
    title,
    html`${boardSide(bd, 'a')}${boardSide(bd, 'b')}
    <p class="pad faint" style="font-size:11px;margin:0;border-top:1px solid var(--line)">${src.note}${bd.source === 'manual' ? '' : ' KOST : kill, objectif, survie ou échange. Entry : premiers kills − premières morts.'}</p>`,
    { extra: sourceBadge(bd.source) },
  );
}

// ---------------------------------------------------------------------------------------------
// Round timeline

const COND_MARK: Record<D.WinCondition, string> = { elimination: 'E', defuser: 'P', time: 'T', disable: 'C' };

function timeline(bd: Board): Raw {
  const rs = bd.rounds;
  const cells = (s: Side) =>
    rs.map((r, i) => {
      const prev = rs[i - 1];
      const sep = prev && prev.lobby !== r.lobby ? html`<span class="rt-sep" aria-hidden="true"></span>` : r.n === 13 ? html`<span class="rt-sep" aria-hidden="true"></span>` : '';
      if (r.kind === 'void') return html`${sep}<span class="rt-cell void" title="Manche interrompue (crash), annulée">×</span>`;
      const won = r.winner === s;
      const atk = r.attacker === s;
      const bg = atk ? '#9c4a1e' : '#245a86';
      return html`${sep}<span class="rt-cell ${won ? 'w' : ''}" style="${won ? `background:${bg};border-color:${bg}` : ''}" title="Manche ${r.n} : ${won ? 'gagnée' : 'perdue'} en ${atk ? 'attaque' : 'défense'}${won && r.condition ? ` (${winConditionLabel[r.condition]})` : ''}${r.site ? ` · site ${r.site}` : ''}">${won && r.condition ? COND_MARK[r.condition] : ''}</span>`;
    });
  const nums = rs.map((r, i) => {
    const prev = rs[i - 1];
    const sep = prev && prev.lobby !== r.lobby ? html`<span class="rt-sep" aria-hidden="true" style="height:12px"></span>` : r.n === 13 ? html`<span class="rt-sep" aria-hidden="true" style="height:12px"></span>` : '';
    return html`${sep}<span class="rt-n">${r.n ?? '·'}</span>`;
  });
  const lobbies = Math.max(...rs.map((r) => r.lobby));
  const ot = rs.some((r) => r.overtime);
  return panel(
    'Manche par manche',
    html`<div class="rt" role="img" aria-label="Chronologie des manches">
      <div class="rt-row"><span class="rt-lbl"></span>${nums}</div>
      <div class="rt-row"><span class="rt-lbl">${bd.a.tag}</span>${cells('a')}</div>
      <div class="rt-row" style="margin-top:3px"><span class="rt-lbl">${bd.b.tag}</span>${cells('b')}</div>
    </div>
    <div class="rt-legend">
      <span><b style="color:#9c4a1e">■</b> gagnée en attaque</span><span><b style="color:#245a86">■</b> gagnée en défense</span>
      <span><b>E</b> élimination · <b>P</b> désamorceur posé · <b>T</b> temps écoulé · <b>C</b> désamorceur coupé</span>
      ${lobbies > 1 ? html`<span><b>×</b> manche interrompue, annulée · ┆ nouveau lobby (re-host)</span>` : ''}
      ${ot ? html`<span>┆ après la manche 12 : prolongation (BO3 de manches)</span>` : ''}
    </div>
    ${lobbies > 1 ? html`<p class="note info">Re-host détecté : ${lobbies} lobbys, ${rs.filter((r) => r.lobby === 1 && r.kind === 'replay' && r.winner === 'a').length}–${rs.filter((r) => r.lobby === 1 && r.kind === 'replay' && r.winner === 'b').length} puis ${rs.filter((r) => r.lobby === 2 && r.winner === 'a').length}–${rs.filter((r) => r.lobby === 2 && r.winner === 'b').length}, 1 manche interrompue annulée. Le score d’avant le crash est conservé (règlement 4.3).</p>` : ''}`,
    { extra: html`<span class="faint">${rs.filter((r) => r.kind === 'replay').length} manches · couverture 2/2 enregistrements</span>` },
  );
}

// ---------------------------------------------------------------------------------------------
// Lineups (HLTV-style), with captains and substitutes

function lineup(tm: D.Team): Raw {
  const entries = D.rosters.get(tm.slug) ?? [];
  return html`<div><div class="lu-h">${team(tm, { size: 18 })}</div><ul class="lu">${entries.map((e) => {
    const p = D.player(e.player);
    return html`<li class="${e.role === 'sub' ? 'sub' : ''}"><span>${playerLink(e.player)}${e.captain ? html`<abbr class="cap" title="Capitaine">C</abbr>` : ''}</span><span class="role">${e.position}${e.role === 'sub' ? ' · remplaçant' : ''}</span></li>`;
  })}</ul></div>`;
}

// ---------------------------------------------------------------------------------------------
// Preview (section 17): tendencies side by side and past meetings

function preview(m: D.Match): Raw {
  const ta = D.tendencies(m.a.slug);
  const tb = D.tendencies(m.b.slug);
  const sa = D.teamSeason(m.a.slug);
  const sb = D.teamSeason(m.b.slug);
  const bar = (v: number | null, right = false) =>
    v === null ? html`<span class="faint">–</span>` : html`<span style="display:inline-flex;align-items:center;gap:5px;${right ? '' : 'flex-direction:row-reverse'}"><span class="bar2"><span style="width:${Math.round(v * 100)}%"></span></span>${D.pct(v)}</span>`;
  const rate = (w: number, n: number) => (n ? w / n : null);
  const rows: [string, Raw | string, Raw | string][] = [
    ['Bilan (cartes jouées)', `${sa.record.wins}–${sa.record.losses}`, `${sb.record.wins}–${sb.record.losses}`],
    ['Manches gagnées en attaque', bar(rate(sa.attack.won, sa.attack.rounds)), bar(rate(sb.attack.won, sb.attack.rounds), true)],
    ['Manches gagnées en défense', bar(rate(sa.defence.won, sa.defence.rounds)), bar(rate(sb.defence.won, sb.defence.rounds), true)],
    ['Premier ban', ta.firstBans[0]?.[0] ?? '–', tb.firstBans[0]?.[0] ?? '–'],
    ['Bans fréquents', ta.banCounts.slice(0, 3).map(([mp, n]) => `${mp} ×${n}`).join(', ') || '–', tb.banCounts.slice(0, 3).map(([mp, n]) => `${mp} ×${n}`).join(', ') || '–'],
    ['Jamais bannie', ta.neverBanned.slice(0, 3).join(', ') || '–', tb.neverBanned.slice(0, 3).join(', ') || '–'],
    ['Couverture replays', `${ta.coverage.replay}/${ta.coverage.maps} cartes`, `${tb.coverage.replay}/${tb.coverage.maps} cartes`],
  ];
  const maps = [...new Set([...ta.perMap.map((x) => x.map), ...tb.perMap.map((x) => x.map)])];
  const meet = D.pastMeetings[`${m.a.slug}|${m.b.slug}`] ?? [];
  return html`
  ${panel(
    'Avant-match : tendances',
    html`<table class="cmp"><caption class="vh">Comparaison des deux équipes</caption>
      <thead><tr><th scope="col" style="text-align:right">${team(m.a, { size: 14, tagOnly: true })}</th><th scope="col" class="mid" style="text-align:center">Saison 3, matchs officiels</th><th scope="col">${team(m.b, { size: 14, tagOnly: true })}</th></tr></thead>
      <tbody>${rows.map(([k, a, b]) => html`<tr><td class="a">${a}</td><th scope="row" class="mid" style="font-weight:400">${k}</th><td>${b}</td></tr>`)}</tbody></table>`,
    { extra: html`<a href="${href(`/teams/${m.a.slug}/tendances`)}">Tendances ${m.a.tag}</a><a href="${href(`/teams/${m.b.slug}/tendances`)}">Tendances ${m.b.tag}</a>` },
  )}
  ${panel(
    'Bilan par carte',
    html`<table class="data dense"><caption class="vh">Bilan par carte</caption><thead><tr><th scope="col">Carte</th><th scope="col" class="num">${m.a.tag} V–D</th><th scope="col" class="num opt">${m.a.tag} manches</th><th scope="col" class="num">${m.b.tag} V–D</th><th scope="col" class="num opt">${m.b.tag} manches</th></tr></thead><tbody>
    ${maps.map((mp) => {
      const x = sa.maps.find((r) => r.map === mp);
      const y = sb.maps.find((r) => r.map === mp);
      return html`<tr><th scope="row">${mapThumb(mp, 28)} ${mp}</th><td class="num">${x ? `${x.wins}–${x.played - x.wins}` : '–'}</td><td class="num opt">${x ? `${x.roundsWon}–${x.roundsLost}` : '–'}</td><td class="num">${y ? `${y.wins}–${y.played - y.wins}` : '–'}</td><td class="num opt">${y ? `${y.roundsWon}–${y.roundsLost}` : '–'}</td></tr>`;
    })}</tbody></table>`,
  )}
  ${panel(
    'Confrontations',
    meet.length
      ? html`<table class="data dense"><caption class="vh">Confrontations</caption><tbody>${meet.map((x) => html`<tr><td class="faint">${D.dateYear(x.at)}</td><td>${x.season} · ${x.stage}</td><td>${D.team(x.a).tag} ${x.score} ${D.team(x.b).tag}</td><td class="faint opt wrapcell">${x.maps}</td></tr>`)}</tbody></table>`
      : html`<p class="pad faint">Première rencontre officielle entre ces deux équipes.</p>`,
  )}`;
}

// ---------------------------------------------------------------------------------------------
// Pages

function playedBottom(m: D.Match): Raw {
  const g = m.game as D.GameSim;
  const side = m.veto.find((s) => s.action === 'side');
  const ot = m.veto.find((s) => s.action === 'ot_side');
  return html`<span>${icon('calendar', 12)} <b>${m.scheduledAt ? D.when(m.scheduledAt) : ''}</b></span>
    <span>Carte <b>${g.map}</b></span>
    <span>Hôte <b>${m.host ? sideTeam(m, m.host).tag : 'à convenir (tirage)'}</b></span>
    <span>Côté de départ <b>${side?.team ? `${sideTeam(m, side.team).tag} en ${side.side === 'atk' ? 'attaque' : 'défense'}` : '–'}</b></span>
    <span>Prolongation <b>${g.overtime ? `oui · ${ot?.team ? sideTeam(m, ot.team).tag : ''} ${ot?.side === 'atk' ? 'attaque' : 'défense'}` : 'non'}</b></span>
    <span>Lobbys <b>${g.lobbies}</b></span>
    ${m.stream ? html`<span>${icon('play', 12)} <a href="${m.stream}">${m.stream.replace('https://', '')}</a></span>` : ''}`;
}

export function played(m: D.Match, viewer: Viewer = null): string {
  const g = m.game as D.GameSim;
  const sc = scoreOf(m) as NonNullable<ReturnType<typeof scoreOf>>;
  const bd: Board = { a: m.a, b: m.b, rounds: g.rounds, source: m.stats };
  const main = html`
  ${header({
    a: m.a, b: m.b, context: context(m), metaA: metaFor(m.a), metaB: metaFor(m.b), bottom: playedBottom(m),
    center: html`<div class="mh-score"><span class="${sc.winner === 'a' ? '' : 'l'}">${sc.a}</span><span class="sep">:</span><span class="${sc.winner === 'b' ? '' : 'l'}">${sc.b}</span></div>
      <div class="mh-sub">${g.overtime ? 'après prolongation' : 'temps réglementaire'} · validé le ${m.validatedAt ? D.dateShort(m.validatedAt) : ''}</div>`,
  })}
  ${tabs([{ label: `Carte 1 · ${g.map} ${m.score?.[0]}–${m.score?.[1]}`, route: `/matches/${m.id}`, active: true }, { label: 'Veto', route: `/matches/${m.id}/veto` }], 'boxed')}
  <div class="grid2">
    ${panel('Veto', vetoList(m), { extra: html`<span class="faint">BO1 · ${m.coinToss ? 'tirage au sort' : `${sideTeam(m, m.sideChooser ?? 'a').tag} moins bien classée`}</span>` })}
    ${panel(
      'Données du match',
      kv([
        ['Statut', html`${status(m)} <span class="faint">confirmé par ${m.b.tag}</span>`],
        ['Stats', html`${sourceBadge(m.stats)}`],
        ['Couverture', m.stats === 'none' ? 'aucune' : m.stats === 'manual' ? 'feuille de stats, 2 équipes' : html`${g.rounds.filter((r) => r.kind === 'replay').length} manches · enregistrements des 2 équipes`],
        ['Re-hosts', g.lobbies > 1 ? `${m.a.tag} : 1 · ${m.b.tag} : 0` : 'aucun'],
        ['Capture du score', html`${icon('lock', 12)} <span class="faint">réservée au staff et aux deux équipes</span>`],
        ['Image', html`<a href="#image">Carte de résultat 1200 px</a>`],
      ]),
    )}
  </div>
  ${m.stats === 'none' ? panel('Tableau des scores', html`<p class="pad faint">Aucun replay ni feuille de stats pour ce match. Les équipes peuvent encore <a href="${href(`/matches/${m.id}/upload`)}">envoyer leurs replays</a>.</p>`) : scoreboard(bd)}
  ${m.stats === 'replay_verified' || m.stats === 'replay_unverified' ? timeline(bd) : ''}
  ${m.stats === 'replay_unverified' ? html`<p class="note">${icon('clock', 12)} Replays analysés dans le navigateur de l’équipe ; la vérification par le serveur est en cours. Un joueur inconnu (<code>ShadowFox.LUN</code>) apparaît dans les replays : le staff a été alerté.</p>` : ''}`;
  return page({
    title: `${m.a.name} ${m.score?.[0]}–${m.score?.[1]} ${m.b.name}`,
    crumbs: [['Accueil', '/'], ['LFR', '/c/lfr/s3'], [divName(m.division), `/c/lfr/s3/standings/${m.division}`], [`Semaine ${m.week}`, '/c/lfr/s3/calendar'], [`${m.a.tag} – ${m.b.tag}`, null]],
    main,
    league: { comp: 'lfr', season: 's3', tab: 'calendar' },
    cols: 'right',
    viewer,
  });
}

export function upcoming(m: D.Match, viewer: Viewer = null): string {
  const official = viewer !== null;
  const range = D.weekRange(m.week);
  const vetoLive = m.vetoState === 'in_progress';
  const center = m.scheduledAt
    ? html`<div class="mh-when">${D.time(m.scheduledAt)} <span class="faint" style="font-weight:400;font-size:12px">${D.zoneName(m.scheduledAt)}</span></div><div class="mh-sub">${D.day(m.scheduledAt)} · ${D.relative(m.scheduledAt)}</div>`
    : m.proposal
      ? html`<div class="mh-when" style="font-size:13px">Horaire proposé</div><div class="mh-sub">${D.when(m.proposal.at)}<br>par ${sideTeam(m, m.proposal.by).tag}, en attente de ${sideTeam(m, otherSide(m.proposal.by)).tag}</div>`
      : html`<div class="mh-when">vs</div><div class="mh-sub">horaire à convenir</div>`;
  const bottom = html`<span>Fenêtre <b>${D.dateShort(range.start)} – ${D.dateShort(range.end)}</b></span><span>Date limite <b>dim. ${D.dateShort(range.end)} 23:59</b></span>
    <span>Hôte <b>${m.host ? sideTeam(m, m.host).tag : 'à convenir'}</b></span>
    <span>Côté et 1er ban <b>${m.sideChooser ? sideTeam(m, m.sideChooser).tag : 'tirage'}</b></span><span>Côté en prolongation <b>${m.otSideChooser ? sideTeam(m, m.otSideChooser).tag : '–'}</b></span>
    ${m.stream ? html`<span>${icon('play', 12)} <a href="${m.stream}">${m.stream.replace('https://', '')}</a></span>` : ''}`;
  const main = html`
  ${header({ a: m.a, b: m.b, context: context(m), center, bottom, metaA: metaFor(m.a), metaB: metaFor(m.b) })}
  ${official
    ? html`<section class="panel"><div class="ph"><h2>Actions de ${viewer?.team ? D.team(viewer.team).name : ''}</h2><div class="ph-x"><span class="faint">vous êtes manager du club Greed</span></div></div>
      <div class="actions">
        <a class="btn" href="#propose">${icon('calendar', 13)}Proposer un horaire</a>
        <a class="btn btn-p" href="${href(`/matches/${m.id}/veto`)}">${icon('timer', 13)}${vetoLive ? 'Reprendre le veto (votre tour)' : 'Lancer le veto'}</a>
        <a class="btn" href="#report">${icon('check', 13)}Déclarer le résultat</a>
        <a class="btn" href="${href(`/matches/${D.featured.reported.id}/upload`)}">${icon('upload', 13)}Envoyer replays et MOSS</a>
        <a class="btn" href="#captain">Nommer un capitaine pour ce match</a>
      </div>
      <p class="note info">L’horaire de jeu. 26 nov. 21:00 a été accepté par W Mates le 24 nov. Le résultat se déclare avec une capture du tableau final ; W Mates le confirme ou le conteste.</p></section>`
    : ''}
  ${m.status === 'proposed' && m.proposal
    ? html`<p class="note info">${icon('clock', 12)} ${sideTeam(m, m.proposal.by).name} propose <b>${D.when(m.proposal.at)}</b> (le ${D.dateShort(m.proposal.madeAt)} à ${D.time(m.proposal.madeAt)}). ${sideTeam(m, otherSide(m.proposal.by)).name} peut accepter ou refuser sur cette page ou sur Discord. Sans accord à la fin de la semaine, le match passe en prolongation et le bot le fixe au dimanche 6 déc. 21:00.</p>`
    : ''}
  ${vetoLive
    ? panel(
        'Veto en cours',
        html`${vetoList(m)}<p class="pad" style="margin:0"><b>Étape 5 sur 9 :</b> ${m.b.name} bannit · 2:37 restantes · <a href="${href(`/matches/${m.id}/veto`)}">suivre le veto</a></p>`,
        { extra: pill('live', 'direct', 'timer') },
      )
    : ''}
  ${panel('Compositions', html`<div class="lineups">${lineup(m.a)}${lineup(m.b)}</div>`, { extra: html`<span class="faint">5 titulaires, jusqu’à 2 remplaçants · C : capitaine</span>` })}
  ${preview(m)}`;
  return page({
    title: `${m.a.name} – ${m.b.name}`,
    crumbs: [['Accueil', '/'], ['LFR', '/c/lfr/s3'], [divName(m.division), `/c/lfr/s3/standings/${m.division}`], [`Semaine ${m.week}`, '/c/lfr/s3/calendar'], [`${m.a.tag} – ${m.b.tag}`, null]],
    main,
    league: { comp: 'lfr', season: 's3', tab: 'calendar' },
    cols: 'right',
    viewer,
  });
}

export function forfeit(m: D.Match): string {
  const by = sideTeam(m, m.forfeit?.by as Side);
  const sc = scoreOf(m) as NonNullable<ReturnType<typeof scoreOf>>;
  const r = rankOf(by);
  const main = html`
  ${header({
    a: m.a, b: m.b, context: context(m), metaA: metaFor(m.a), metaB: metaFor(m.b),
    center: html`<div class="mh-score"><span class="${sc.winner === 'a' ? '' : 'l'}">${sc.a}</span><span class="sep">:</span><span class="${sc.winner === 'b' ? '' : 'l'}">${sc.b}</span></div><div class="mh-sub">forfait (W.O.)</div>`,
    bottom: html`<span>${icon('calendar', 12)} Prévu <b>${m.scheduledAt ? D.when(m.scheduledAt) : ''}</b></span><span>Score de forfait <b>7–0</b> (réglage de saison)</span>`,
  })}
  ${panel(
    'Forfait',
    html`<p class="pad">${by.name} ne s’est pas présentée à l’heure convenue. Le staff a enregistré le forfait le ${m.validatedAt ? D.when(m.validatedAt) : ''} : 3 points et 7–0 en manches pour ${sideTeam(m, otherSide(m.forfeit?.by as Side)).name}, un match joué et perdu pour ${by.name}.</p>
    ${kv([
      ['Forfaits de ' + by.tag, html`${r?.forfeits ?? 2} cette saison · ${pill('warn', 'avertissement au 2e')}`],
      ['Seuil d’exclusion', '3e forfait'],
      ['Enregistré par', 'le staff LFR'],
    ])}`,
  )}
  ${panel('Tableau des scores', html`<p class="pad faint">Pas de partie, pas de statistiques.</p>`)}`;
  return page({
    title: `${m.a.name} – ${m.b.name} (forfait)`,
    crumbs: [['Accueil', '/'], ['LFR', '/c/lfr/s3'], [divName(m.division), `/c/lfr/s3/standings/${m.division}`], [`Semaine ${m.week}`, '/c/lfr/s3/calendar'], [`${m.a.tag} – ${m.b.tag}`, null]],
    main, league: { comp: 'lfr', season: 's3', tab: 'calendar' }, cols: 'right',
  });
}

export function disputed(m: D.Match): string {
  const rep = m.reported as NonNullable<D.Match['reported']>;
  const dis = m.disputed as NonNullable<D.Match['disputed']>;
  const main = html`
  ${header({
    a: m.a, b: m.b, context: context(m), metaA: metaFor(m.a), metaB: metaFor(m.b),
    center: html`<div class="mh-score" style="color:var(--faint)">${rep.score[0]}<span class="sep">:</span>${rep.score[1]}</div><div class="mh-sub">score déclaré, ne compte pas</div>`,
    bottom: html`<span>${icon('calendar', 12)} Joué <b>${m.scheduledAt ? D.when(m.scheduledAt) : ''}</b></span><span>Semaine 5 en prolongation</span>`,
  })}
  <p class="note danger">${icon('alert', 12)} <b>Résultat contesté.</b> ${sideTeam(m, dis.by).name} conteste le score déclaré par ${sideTeam(m, rep.by).name}. Le staff tranche : valider, rejeter, annuler ou saisir un autre résultat. Le motif de la contestation n’est visible que du staff.</p>
  ${panel(
    'Historique',
    html`<table class="data dense"><caption class="vh">Historique du résultat</caption><tbody>
      <tr><td class="faint">${D.when(rep.at)}</td><td>${sideTeam(m, rep.by).name} déclare <b>${rep.score[0]}–${rep.score[1]}</b> avec une capture du tableau final</td></tr>
      <tr><td class="faint">${D.when(dis.at)}</td><td>${sideTeam(m, dis.by).name} conteste</td></tr>
      <tr><td class="faint">—</td><td>${pill('pending', 'En attente du staff')} <span class="faint">depuis ${D.relative(dis.at).replace('il y a ', '')}</span></td></tr>
    </tbody></table>`,
  )}
  ${panel('Tableau des scores', html`<p class="pad faint">Les statistiques apparaîtront quand le résultat sera validé.</p>`)}`;
  return page({
    title: `${m.a.name} – ${m.b.name} (contesté)`,
    crumbs: [['Accueil', '/'], ['LFR', '/c/lfr/s3'], [divName(m.division), `/c/lfr/s3/standings/${m.division}`], [`Semaine ${m.week}`, '/c/lfr/s3/calendar'], [`${m.a.tag} – ${m.b.tag}`, null]],
    main, league: { comp: 'lfr', season: 's3', tab: 'calendar' }, cols: 'right',
  });
}

// ---------------------------------------------------------------------------------------------
// Cup BO3, one tab per game (separate URLs)

export function cupMatch(cm: D.CupMatch, gameN: number): string {
  const a = (cm.a as D.CupSeed).team;
  const b = (cm.b as D.CupSeed).team;
  const g = cm.games[gameN - 1] as D.CupGame;
  const series = cm.series as [number, number];
  const fake = { id: cm.id, a, b } as unknown as D.Match;
  const veto: D.VetoStep[] = D.cupVetoQf1.map((s) => ({ seq: s.seq, team: s.team, action: s.action, map: s.map as D.MapName, ...('side' in s ? { side: s.side } : {}), ...('timedOut' in s ? { timedOut: true } : {}) }));
  const bd: Board = { a, b, rounds: g.sim?.rounds ?? [], source: g.stats };
  const routes = ['', '/games/2', '/games/3'];
  const ctx = html`<a href="${href('/c/lfr/s3/bracket')}">Coupe de France</a><span>Quarts de finale</span><span>BO3</span><span class="grow">${pill('done', 'Validé', 'check')}</span>`;
  const main = html`
  ${header({
    a, b, context: ctx, metaA: `Tête de série ${cm.a?.seed} · L1 · 1er`, metaB: `Tête de série ${cm.b?.seed} · L2 · 1er`,
    center: html`<div class="mh-score"><span class="${series[0] > series[1] ? '' : 'l'}">${series[0]}</span><span class="sep">:</span><span class="${series[1] > series[0] ? '' : 'l'}">${series[1]}</span></div><div class="mh-sub">série BO3 · ${cm.at ? D.when(cm.at) : ''}</div>`,
    bottom: html`${cm.games.map((x) => html`<span>Carte ${x.n} <b>${x.map} ${x.score?.[0]}–${x.score?.[1]}</b>${x.pickedBy ? html` <span>(choix ${x.pickedBy === 'a' ? a.tag : b.tag})</span>` : html` <span>(décisive)</span>`}</span>`)}<span>Côtés désignés par le staff · hôte convenu : ${a.tag}</span>`,
  })}
  ${tabs(cm.games.map((x, i) => ({ label: `Carte ${x.n} · ${x.map} ${x.score?.[0]}–${x.score?.[1]}`, route: `/matches/${cm.id}${routes[i]}`, active: x.n === gameN })), 'boxed')}
  <div class="grid2">
    ${panel('Veto BO3', vetoList(fake, veto), { extra: html`<a href="${href(`/matches/${cm.id}/veto`)}">Détail</a>` })}
    ${panel(
      `Carte ${g.n} · ${g.map}`,
      kv([
        ['Score', html`<b>${g.score?.[0]}–${g.score?.[1]}</b>${g.sim?.overtime ? ' après prolongation' : ''}`],
        ['Choisie par', g.pickedBy ? (g.pickedBy === 'a' ? a.name : b.name) : 'décisive (personne)'],
        ['Côté de départ', g.startSide ? `${g.startSide.team === 'a' ? a.tag : b.tag} en ${g.startSide.side === 'atk' ? 'attaque' : 'défense'}` : '–'],
        ['Stats', sourceBadge(g.stats)],
      ]),
    )}
  </div>
  ${scoreboard(bd, `Tableau des scores · carte ${g.n}`)}
  ${timeline(bd)}`;
  return page({
    title: `${a.name} ${series[0]}–${series[1]} ${b.name} · carte ${gameN}`,
    crumbs: [['Accueil', '/'], ['LFR', '/c/lfr/s3'], ['Coupe de France', '/c/lfr/s3/bracket'], ['Quarts de finale', '/c/lfr/s3/bracket'], [`${a.tag} – ${b.tag}`, null]],
    main, league: { comp: 'lfr', season: 's3', tab: 'cup' }, cols: 'right',
  });
}

export { lineup, header, preview, form };
export const _unused = flag;
