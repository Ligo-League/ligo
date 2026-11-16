// Match pages: header like a football app's match page (teams, score, status), the round strip
// as the "events", then scoreboards, rounds, veto and lineups.

import * as D from '../../_data/index.ts';
import { contrast, href, html, icon, raw, rel, teamBadge, teamRoute, textOn, type Raw } from '../../_build/lib.ts';
import { t } from '../../_build/i18n.ts';
import { matchContext, scoreOf, sourceLabel, statusOf, winConditionLabel } from '../../_build/shared.ts';
import { doc, type Viewer } from './layout.ts';
import { facts, formDots, pill, playerLink, sectionHead, sideLabel, sideShort, sourceBadge } from './ui.ts';

/** A team's colour for marks on white: its primary, unless the primary vanishes on white. */
export const teamTone = (t: D.Team, _bg = '#FFFFFF') => (contrast(t.colors[0], '#FFFFFF') >= 1.6 ? t.colors[0] : t.colors[1]);

const divName = (d: string) => (d === 'ligue-1' ? 'Ligue 1' : 'Ligue 2');
const other = (s: 'a' | 'b'): 'a' | 'b' => (s === 'a' ? 'b' : 'a');
export const COND_LETTER: Record<D.WinCondition, string> = { elimination: 'É', defuser: 'D', time: 'T', disable: 'C' };

export interface HeadSide {
  team: D.Team;
  note?: string | Raw;
}

export interface HeadOpts {
  a: HeadSide;
  b: HeadSide;
  score: [number | string, number | string] | null;
  winner?: 'a' | 'b' | null;
  status: Raw;
  context: string;
  crumbs: [string, string | null][];
  when: string | Raw;
  under?: Raw | string;
}

export function matchHead(o: HeadOpts): Raw {
  const side = (s: 'a' | 'b') => {
    const x = s === 'a' ? o.a : o.b;
    const won = o.winner === s;
    return html`<a class="mh-team mh-${s} ${won ? 'won' : ''} ${o.winner && !won ? 'lost' : ''}" href="${href(teamRoute(x.team))}" style="--tc:${teamTone(x.team, '#FFFFFF')}">
      ${teamBadge(x.team, { size: 56 })}<span class="mh-name"><span class="tn-long">${x.team.name}</span><span class="tn-short">${x.team.tag}</span></span>${x.note ? html`<span class="mh-note">${x.note}</span>` : ''}</a>`;
  };
  return html`<section class="mh">
    <div class="mh-ctx"><div class="mh-ctx-in"><nav class="crumbs" aria-label="Fil d’Ariane"><ol>${o.crumbs.map(([l, r]) => html`<li>${r ? html`<a href="${href(r)}">${l}</a>` : html`<span aria-current="page">${l}</span>`}</li>`)}</ol></nav><span class="mh-context">${o.context}</span></div></div>
    <div class="mh-in">
      <p class="mh-when">${o.when}</p>
      <div class="mh-row">
        ${side('a')}
        <div class="mh-mid">${
          o.score
            ? html`<p class="mh-score" aria-label="Score ${o.score[0]} à ${o.score[1]}"><span class="${o.winner === 'a' ? 'w' : ''}">${o.score[0]}</span><span class="mh-dash">–</span><span class="${o.winner === 'b' ? 'w' : ''}">${o.score[1]}</span></p>`
            : html`<p class="mh-vs">VS</p>`
        }${o.status}</div>
        ${side('b')}
      </div>
      ${o.under ? html`<div class="mh-under">${o.under}</div>` : ''}
    </div>
  </section>`;
}

const leagueCrumbs = (m: D.Match): [string, string | null][] => [
  ['LFR', '/c/lfr/s3'],
  [divName(m.division), `/c/lfr/s3/standings/${m.division}`],
  [`${t('week')} ${m.week}`, '/c/lfr/s3/calendar'],
];

function rankNote(team: D.Team): string {
  const r = D.standings(team.division).find((x) => x.team.slug === team.slug);
  if (!r) return '';
  return r.excluded ? t('excluded') : `${r.rank}${r.rank === 1 ? 'er' : 'e'}${r.shared ? ' ex æquo' : ''} · ${r.points} pts`;
}

function leagueHead(m: D.Match, under?: Raw | string): Raw {
  const st = statusOf(m);
  const sc = scoreOf(m);
  const reported = m.status === 'reported' || m.status === 'disputed';
  return matchHead({
    a: { team: m.a, note: rankNote(m.a) },
    b: { team: m.b, note: rankNote(m.b) },
    score: sc ? [sc.a, sc.b] : null,
    winner: sc?.winner ?? null,
    status: html`${pill(st.tone, st.label)}${m.extension ? pill('warn', t('stExtension')) : ''}${reported ? html`<span class="mh-rep">Déclaré : ${m.reported?.score[0]}–${m.reported?.score[1]}</span>` : ''}`,
    context: `BO${m.bestOf}${m.map ? ` · ${m.map}` : ''}`,
    crumbs: leagueCrumbs(m),
    when: m.scheduledAt ? html`${icon('calendar', 14)} ${D.day(m.scheduledAt)} ${icon('clock', 14)} ${D.timeZ(m.scheduledAt)}` : m.status === 'proposed' && m.proposal ? html`${icon('clock', 14)} Horaire proposé : ${D.when(m.proposal.at)}` : html`${icon('calendar', 14)} À jouer avant le ${D.dateShort(D.weekRange(m.week).end)}`,
    ...(under ? { under } : {}),
  });
}

// ---------------------------------------------------------------------------------------------
// Round strip: two rows, one per team; a round sits in the row of its winner. Position carries
// the meaning, so it reads without colour; the letter is the win condition.

export function roundStrip(game: D.GameSim, a: D.Team, b: D.Team): Raw {
  const rounds = game.rounds;
  const ca = teamTone(a, '#FFFFFF');
  const cb = teamTone(b, '#FFFFFF');
  const cell = (r: D.Round, row: 'a' | 'b', i: number) => {
    const prev = rounds[i - 1];
    const lobbyStart = prev && prev.lobby !== r.lobby;
    const otStart = r.overtime && prev && !prev.overtime;
    const cls = `${lobbyStart ? 'rs-lobby' : ''} ${otStart ? 'rs-ot' : ''}`;
    if (r.kind === 'void') return html`<span class="rs-c rs-void ${cls}" title="Round interrompu, annulé">${row === 'a' ? '×' : ''}</span>`;
    const won = r.winner === row;
    const team = row === 'a' ? a : b;
    const atk = r.attacker === row;
    return won
      ? html`<span class="rs-c rs-w ${cls}" style="background:${row === 'a' ? ca : cb};color:${textOn(row === 'a' ? ca : cb)}" title="Round ${r.n} : ${team.tag} gagne en ${atk ? 'attaque' : 'défense'}, ${winConditionLabel[r.condition as D.WinCondition].toLowerCase()}">${COND_LETTER[r.condition as D.WinCondition]}</span>`
      : html`<span class="rs-c ${cls} ${atk ? 'rs-atk' : ''}"></span>`;
  };
  const cols = rounds.length;
  return html`<div class="rs" style="--n:${cols}" role="img" aria-label="Déroulé des rounds : ${rounds.filter((r) => r.kind === 'replay').map((r) => `${r.n} ${r.winner === 'a' ? a.tag : b.tag}`).join(', ')}">
    <span class="rs-l">${a.tag}</span>${rounds.map((r, i) => cell(r, 'a', i))}
    <span class="rs-l rs-l-n" aria-hidden="true"></span>${rounds.map((r, i) => html`<span class="rs-n ${rounds[i - 1] && rounds[i - 1]?.lobby !== r.lobby ? 'rs-lobby' : ''} ${r.overtime && !rounds[i - 1]?.overtime ? 'rs-ot' : ''}">${r.n ?? '×'}</span>`)}
    <span class="rs-l">${b.tag}</span>${rounds.map((r, i) => cell(r, 'b', i))}
  </div>
  <p class="rs-key sm"><span>É élimination</span><span>D désamorceur posé</span><span>T temps écoulé</span><span>C désamorceur coupé</span>${game.lobbies > 1 ? html`<span><span class="rs-key-bar" aria-hidden="true"></span>nouveau lobby (re-host)</span>` : ''}${game.overtime ? html`<span><span class="rs-key-bar rs-key-ot" aria-hidden="true"></span>prolongation</span>` : ''}<span>× round annulé</span></p>`;
}

// ---------------------------------------------------------------------------------------------
// Scoreboard for one side.

export function scoreboard(team: D.Team, side: 'a' | 'b', game: D.GameSim, source: D.StatsSource): Raw {
  const replay = source === 'replay_verified' || source === 'replay_unverified';
  const lineup = [...new Set(game.rounds.flatMap((r) => r.players.filter((p) => p.team === side).map((p) => p.player)))];
  const won = (side === 'a' ? game.scoreA : game.scoreB) > (side === 'a' ? game.scoreB : game.scoreA);
  const rows = lineup.map((slug) => {
    const tt = D.addRounds(D.emptyTotals(), game.rounds, slug, replay);
    return { slug, tt, d: D.derived(tt) };
  });
  rows.sort((x, y) => y.tt.kills - x.tt.kills);
  const na = html`<span class="na" title="Demande un replay">–</span>`;
  return html`<div class="tbl-wrap"><table class="sb">
    <caption class="sb-cap"><span class="sb-team" style="--tc:${teamTone(team, '#FFFFFF')}">${teamBadge(team, { size: 20 })} ${team.name}</span><span class="sb-res ${won ? 'pos' : 'muted'}">${won ? 'Victoire' : 'Défaite'}</span></caption>
    <thead><tr><th scope="col" class="c-pl">Joueur</th><th scope="col" class="num"><abbr title="Kills">K</abbr></th><th scope="col" class="num"><abbr title="Morts">D</abbr></th><th scope="col" class="num"><abbr title="Assistances">A</abbr></th><th scope="col" class="num"><abbr title="Kills par mort">K/D</abbr></th><th scope="col" class="num hide-s"><abbr title="Kills en headshot">HS %</abbr></th><th scope="col" class="num"><abbr title="Rounds avec kill, objectif, survie ou échange">KOST</abbr></th><th scope="col" class="num hide-s"><abbr title="Ouvertures gagnées moins perdues">Entry</abbr></th><th scope="col" class="num hide-m"><abbr title="Clutchs gagnés / tentés">Clutch</abbr></th><th scope="col" class="num hide-m"><abbr title="Désamorceurs posés">Plants</abbr></th><th scope="col" class="hide-m">Opérateur</th></tr></thead>
    <tbody>${rows.map(({ slug, tt, d }) => {
      const p = D.player(slug);
      if (!p.consent) {
        return html`<tr class="nc"><th scope="row" class="c-pl">${playerLink(slug)}</th><td colspan="10" class="nc-cell"><span title="Ce joueur n’a pas donné son accord pour publier ses statistiques">Stats non publiées</span><span class="hide-s"> : le joueur n’a pas donné son accord.</span></td></tr>`;
      }
      return html`<tr><th scope="row" class="c-pl">${playerLink(slug)}</th><td class="num">${tt.kills}</td><td class="num">${tt.deaths}</td><td class="num">${tt.assists}</td><td class="num ${d.kd >= 1 ? 'pos' : 'neg'}">${D.ratio(d.kd)}</td><td class="num hide-s">${D.pct(d.hs)}</td><td class="num">${replay ? D.pct(d.kost) : na}</td><td class="num hide-s">${replay ? D.signed(d.entry ?? 0) : na}</td><td class="num hide-m">${replay ? `${tt.clutchWins}/${tt.clutchAttempts}` : na}</td><td class="num hide-m">${replay ? tt.plants : na}</td><td class="hide-m">${d.topOperator ?? na}</td></tr>`;
    })}</tbody>
  </table></div>`;
}

function roundsTable(game: D.GameSim, a: D.Team, b: D.Team): Raw {
  return html`<div class="tbl-wrap"><table class="tbl rt">
    <thead><tr><th scope="col" class="num">#</th><th scope="col">Vainqueur</th><th scope="col">Côté</th><th scope="col">Fin du round</th><th scope="col" class="hide-s">Site défendu</th><th scope="col" class="num hide-s"><abbr title="Joueurs en vie à la fin">Vivants</abbr></th></tr></thead>
    <tbody>${game.rounds.map((r, i) => {
      const prev = game.rounds[i - 1];
      const sep = prev && prev.lobby !== r.lobby ? html`<tr class="rt-sep"><td colspan="6">${icon('alert', 14)} Lobby ${r.lobby} : re-host, le score repart de ${scoreAt(game, i)}</td></tr>` : r.overtime && prev && !prev.overtime ? html`<tr class="rt-sep"><td colspan="6">Prolongation à 6–6</td></tr>` : '';
      if (r.kind === 'void') return html`${sep}<tr class="rt-void"><td class="num">×</td><td colspan="5">Round interrompu (crash du lobby ${r.lobby}), annulé</td></tr>`;
      const w = r.winner === 'a' ? a : b;
      const atk = r.attacker === r.winner;
      return html`${sep}<tr><td class="num">${r.n}</td><td>${teamBadge(w, { size: 16 })} ${w.tag}</td><td>${sideLabel(atk ? 'atk' : 'def')}</td><td>${winConditionLabel[r.condition as D.WinCondition]}</td><td class="hide-s">${r.site}</td><td class="num hide-s">${r.aliveA}–${r.aliveB}</td></tr>`;
    })}</tbody>
  </table></div>`;
}

function scoreAt(game: D.GameSim, idx: number): string {
  let a = 0;
  let b = 0;
  for (const r of game.rounds.slice(0, idx)) {
    if (r.kind !== 'replay') continue;
    if (r.winner === 'a') a++;
    else b++;
  }
  return `${a}–${b}`;
}

export function vetoSummary(steps: D.VetoStep[], a: D.Team, b: D.Team): Raw {
  const tm = (s: 'a' | 'b' | null) => (s === 'a' ? a : s === 'b' ? b : null);
  return html`<ol class="veto-sum">${steps.map((s) => {
    const team = tm(s.team);
    const verb = s.action === 'ban' ? 'ban' : s.action === 'pick' ? 'pick' : s.action === 'decider' ? 'carte jouée' : s.action === 'side' ? 'côté de départ' : 'côté en prolongation';
    return html`<li class="vs-${s.action} ${s.timedOut ? 'vs-to' : ''}"><span class="vs-n">${s.seq}</span><span class="vs-team">${team ? html`${teamBadge(team, { size: 16 })} ${team.tag}` : html`<span class="muted">—</span>`}</span><span class="vs-act">${verb}</span><span class="vs-map">${s.action === 'side' || s.action === 'ot_side' ? sideLabel(s.side as 'atk' | 'def') : s.map}</span>${s.timedOut ? pill('warn', 'temps écoulé, tirage au hasard', 'pill-xs') : ''}</li>`;
  })}</ol>`;
}

export function lineups(m: { a: D.Team; b: D.Team }, opts: { captains?: Partial<Record<'a' | 'b', string>> } = {}): Raw {
  const col = (team: D.Team, s: 'a' | 'b') => {
    const entries = D.rosters.get(team.slug) ?? [];
    return html`<div class="lu"><h3 class="lu-h">${teamBadge(team, { size: 20 })} ${team.name}</h3>
      <ul class="list">${entries.map((e) => {
        const p = D.player(e.player);
        const cap = opts.captains?.[s] ? opts.captains[s] === e.player : e.captain;
        return html`<li class="lu-p ${e.role === 'sub' ? 'lu-sub' : ''}">${playerLink(e.player)}${cap ? html`<abbr class="cap" title="Capitaine">C</abbr>` : ''}<span class="muted sm">${e.role === 'sub' ? 'Remplaçant' : e.position}</span></li>`;
      })}</ul></div>`;
  };
  return html`<div class="lus">${col(m.a, 'a')}${col(m.b, 'b')}</div>`;
}

function sectionNav(items: [string, string][]): Raw {
  return html`<nav class="secnav" aria-label="Sections du match"><div class="secnav-in">${items.map(([l, id], i) => html`<a href="#${id}" ${i === 0 ? raw('aria-current="true"') : ''}>${l}</a>`)}</div></nav>`;
}

// ---------------------------------------------------------------------------------------------
// Played league match (also overtime, manual, unverified variants).

export function playedMatch(m: D.Match, viewer: Viewer = null): string {
  const g = m.game as D.GameSim;
  const src = sourceLabel[m.stats];
  const replay = m.stats === 'replay_verified' || m.stats === 'replay_unverified';
  const voided = g.rounds.filter((r) => r.kind === 'void').length;
  const underBits = [
    m.map,
    g.overtime ? `Prolongation ${g.scoreA}–${g.scoreB}` : null,
    g.lobbies > 1 ? `${g.lobbies} lobbys (re-host)` : null,
  ].filter(Boolean);
  const unknown = m.stats === 'replay_unverified' ? D.staffQueue.unknownPlayers.find((u) => u.match.id === m.id) : null;
  const body = html`${leagueHead(m, html`<span>${underBits.join(' · ')}</span>`)}
  ${sectionNav([
    ['Résumé', 'resume'],
    ['Tableau', 'tableau'],
    ...(replay ? ([['Rounds', 'rounds']] as [string, string][]) : []),
    ['Veto', 'veto'],
    ['Compos', 'compos'],
  ])}
  <div class="page split">
    <div class="col-main">
      <section id="resume">
        ${replay ? html`${sectionHead('Déroulé')}${roundStrip(g, m.a, m.b)}` : ''}
        <div class="src-line">${sourceBadge(m.stats)}<span class="sm">${src.note}</span></div>
        ${replay ? html`<p class="sm muted">Couverture : ${g.rounds.filter((r) => r.kind === 'replay').length} rounds comptés sur ${g.scoreA + g.scoreB}${voided ? `, ${voided} round interrompu annulé` : ''} · ${g.lobbies} lobby${g.lobbies > 1 ? 's' : ''} · enregistrements des deux équipes.</p>` : ''}
        ${unknown ? html`<p class="callout callout-warn">${icon('alert', 16)} Un compte inconnu apparaît dans le replay de ${unknown.side} (${unknown.account}). Le staff vérifie ; le résultat n’en dépend pas.</p>` : ''}
        ${g.lobbies > 1 ? html`<p class="callout">${icon('alert', 16)} Re-host détecté : 2 lobbys, ${scoreAt(g, g.rounds.findIndex((r) => r.lobby === 2))} puis ${g.scoreA - Number(scoreAt(g, g.rounds.findIndex((r) => r.lobby === 2)).split('–')[0])}–${g.scoreB - Number(scoreAt(g, g.rounds.findIndex((r) => r.lobby === 2)).split('–')[1])} → ${g.scoreA}–${g.scoreB}, ${voided} round interrompu annulé. ${m.a.tag} avait demandé le re-host.</p>` : ''}
      </section>
      <section id="tableau">
        ${sectionHead('Tableau des joueurs')}
        ${m.stats === 'none' ? html`<p class="empty-inline">${src.note}</p>` : html`${scoreboard(m.a, 'a', g, m.stats)}${scoreboard(m.b, 'b', g, m.stats)}`}
      </section>
      ${replay ? html`<section id="rounds">${sectionHead('Rounds')}${roundsTable(g, m.a, m.b)}</section>` : ''}
    </div>
    <aside class="col-side">
      <section id="veto">
        ${sectionHead('Veto', ['Détail', `/matches/${m.id}/veto`])}
        ${vetoSummary(m.veto, m.a, m.b)}
      </section>
      <section>
        ${sectionHead('Infos du match')}
        ${facts([
          ['Compétition', `LFR · ${matchContext(m)}`],
          ['Format', 'BO1, premier à 7 ; prolongation à 6–6'],
          ['Hôte', m.host ? (m.host === 'a' ? m.a.name : m.b.name) : 'Choisi par les équipes (tirage au sort)'],
          ['Choix du côté', m.sideChooser === 'a' ? m.a.name : m.b.name],
          ['Validé', m.validatedAt ? html`${D.when(m.validatedAt)} par confirmation de l’adversaire` : '—'],
          ['Capture du score', html`${icon('lock', 13)} Réservée au staff et aux deux équipes`],
          ...(m.stream ? ([['Diffusion', html`<a href="${m.stream}">${m.stream.replace('https://', '')} ${icon('external', 12)}</a>`]] as [string, Raw][]) : []),
        ])}
      </section>
    </div>
  </div>
  <div class="page" id="compos">
    ${sectionHead('Compositions')}
    ${lineups(m)}
  </div>`;
  return doc({ title: `${m.a.name} – ${m.b.name}`, comp: 'lfr', body, viewer, nav: 'matches' });
}

// ---------------------------------------------------------------------------------------------
// Forfeit and disputed matches.

export function forfeitMatch(m: D.Match): string {
  const by = m.forfeit?.by === 'a' ? m.a : m.b;
  const rows = D.standings(by.division).find((r) => r.team.slug === by.slug);
  const body = html`${leagueHead(m, html`<span>Victoire par forfait : score du règlement, 7–0</span>`)}
  <div class="page split">
    <div class="col-main">
      <section>
        ${sectionHead('Forfait')}
        <p><strong>${by.name}</strong> ne s’est pas présentée à l’heure du match (${m.scheduledAt ? D.when(m.scheduledAt) : ''}). Le staff a enregistré le forfait : ${(m.forfeit?.by === 'a' ? m.b : m.a).name} gagne 7–0, ${by.name} perd 0–7. Le match compte comme joué pour les deux équipes.</p>
        ${facts([
          ['Forfaits de la saison', `${by.name} : ${rows?.forfeits ?? 0} (avertissement au 2e, exclusion au 3e)`],
          ['Enregistré par', 'le staff LFR, le ' + (m.validatedAt ? D.when(m.validatedAt) : '')],
          ['Statistiques', 'Aucune : pas de partie jouée'],
        ])}
        ${(rows?.forfeits ?? 0) >= 2 ? html`<p class="callout callout-warn">${icon('alert', 16)} 2e forfait de ${by.name} cette saison : avertissement. Au 3e, l’équipe est exclue.</p>` : ''}
      </section>
    </div>
    <aside class="col-side">
      <section>${sectionHead('Forme')}
        ${[m.a, m.b].map((x) => {
          const r = D.standings(x.division).find((y) => y.team.slug === x.slug);
          return html`<p class="form-line">${teamBadge(x, { size: 18 })} ${x.tag} ${r ? formDots(r.form) : ''}</p>`;
        })}
      </section>
    </aside>
  </div>`;
  return doc({ title: `${m.a.name} – ${m.b.name}`, comp: 'lfr', body, nav: 'matches' });
}

export function disputedMatch(m: D.Match): string {
  const rep = m.reported as NonNullable<D.Match['reported']>;
  const dis = m.disputed as NonNullable<D.Match['disputed']>;
  const by = rep.by === 'a' ? m.a : m.b;
  const against = dis.by === 'a' ? m.a : m.b;
  const body = html`${leagueHead(m, html`<span>Le score ne compte pas tant que le staff n’a pas tranché</span>`)}
  <div class="page split">
    <div class="col-main">
      <section>
        ${sectionHead('Résultat contesté')}
        <ol class="timeline">
          <li><span class="tl-at">${D.when(m.scheduledAt as number)}</span><span>Match joué (semaine de prolongation).</span></li>
          <li><span class="tl-at">${D.when(rep.at)}</span><span><strong>${by.name}</strong> déclare <strong>${rep.score[0]}–${rep.score[1]}</strong> avec la capture du tableau final.</span></li>
          <li><span class="tl-at">${D.when(dis.at)}</span><span><strong>${against.name}</strong> conteste le résultat. Le motif est transmis au staff seulement.</span></li>
          <li class="tl-now"><span class="tl-at">Maintenant</span><span>${pill('danger', 'En attente du staff')} Le staff valide, rejette, annule ou saisit le résultat.</span></li>
        </ol>
        <p class="sm muted">Le classement ne compte ce match qu’une fois tranché. Les replays envoyés servent de preuve au staff ; ils ne décident jamais seuls du résultat.</p>
      </section>
    </div>
    <aside class="col-side">
      <section>${sectionHead('Infos du match')}
        ${facts([
          ['Compétition', `LFR · ${matchContext(m)}`],
          ['Format', 'BO1'],
          ['Preuves', html`${icon('lock', 13)} Capture et replays visibles du staff et des deux équipes`],
        ])}
      </section>
    </aside>
  </div>
  <div class="page">${sectionHead('Compositions')}${lineups(m)}</div>`;
  return doc({ title: `${m.a.name} – ${m.b.name}`, comp: 'lfr', body, nav: 'matches' });
}

// ---------------------------------------------------------------------------------------------
// Match to be played: time, sides, lineups, the preview (section 17), and the official's actions.

function previewSide(team: D.Team): { t: ReturnType<typeof D.tendencies>; s: D.TeamSeason; row: D.StandingRow | undefined } {
  return { t: D.tendencies(team.slug), s: D.teamSeason(team.slug), row: D.standings(team.division).find((r) => r.team.slug === team.slug) };
}

function preview(m: D.Match): Raw {
  const A = previewSide(m.a);
  const B = previewSide(m.b);
  const rate = (w: number, n: number) => (n < 10 ? html`<span class="muted" title="Moins de 10 rounds">${n} r.</span>` : html`${D.pct(w / n)} <span class="muted sm">${n} r.</span>`);
  const maps = D.MAP_POOL.filter((map) => A.t.perMap.some((p) => p.map === map) || B.t.perMap.some((p) => p.map === map));
  const rec = (x: typeof A, map: D.MapName) => {
    const p = x.t.perMap.find((q) => q.map === map);
    return p ? `${p.wins}–${p.played - p.wins}` : '–';
  };
  const meetings = D.pastMeetings[`${m.a.slug}|${m.b.slug}`] ?? [];
  return html`<section id="apercu">
    ${sectionHead('Avant-match')}
    <div class="cmp">
      <div class="cmp-h"><span>${teamBadge(m.a, { size: 20 })} ${m.a.tag}</span><span></span><span>${m.b.tag} ${teamBadge(m.b, { size: 20 })}</span></div>
      <div class="cmp-r"><span class="num">${A.row?.rank ?? '–'}e</span><span class="cmp-k">Rang</span><span class="num">${B.row?.rank ?? '–'}e</span></div>
      <div class="cmp-r"><span>${A.row ? formDots(A.row.form) : ''}</span><span class="cmp-k">Forme</span><span>${B.row ? formDots(B.row.form) : ''}</span></div>
      <div class="cmp-r"><span class="num">${A.s.record.wins}–${A.s.record.losses}</span><span class="cmp-k">Cartes jouées (V–D)</span><span class="num">${B.s.record.wins}–${B.s.record.losses}</span></div>
      <div class="cmp-r"><span class="num">${rate(A.s.attack.won, A.s.attack.rounds)}</span><span class="cmp-k">Rounds gagnés en attaque</span><span class="num">${rate(B.s.attack.won, B.s.attack.rounds)}</span></div>
      <div class="cmp-r"><span class="num">${rate(A.s.defence.won, A.s.defence.rounds)}</span><span class="cmp-k">Rounds gagnés en défense</span><span class="num">${rate(B.s.defence.won, B.s.defence.rounds)}</span></div>
      <div class="cmp-r"><span>${A.t.firstBans.slice(0, 2).map(([mp]) => mp).join(', ') || '–'}</span><span class="cmp-k">Premier ban habituel</span><span>${B.t.firstBans.slice(0, 2).map(([mp]) => mp).join(', ') || '–'}</span></div>
    </div>
    <h3 class="sub-h">Bilan par carte (officiel, cette saison)</h3>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th scope="col">Carte</th><th scope="col" class="num">${m.a.tag}</th><th scope="col" class="num">${m.b.tag}</th></tr></thead>
      <tbody>${maps.map((mp) => html`<tr><th scope="row">${mp}</th><td class="num">${rec(A, mp)}</td><td class="num">${rec(B, mp)}</td></tr>`)}</tbody>
    </table></div>
    <p class="sm muted">Couverture : ${m.a.tag} ${A.t.coverage.replay}/${A.t.coverage.maps} cartes avec replay, ${m.b.tag} ${B.t.coverage.replay}/${B.t.coverage.maps}. Matchs officiels validés uniquement. <a href="${href(`/teams/${m.a.slug}/tendances`)}">Tendances complètes</a></p>
    <h3 class="sub-h">Confrontations</h3>
    ${meetings.length ? html`<ul class="list">${meetings.map((x) => html`<li class="meet"><span class="muted sm">${x.season} · ${x.stage} · ${D.dateYear(x.at)}</span><span>${D.team(x.a).tag} <strong>${x.score}</strong> ${D.team(x.b).tag}</span><span class="sm">${x.maps}</span></li>`)}</ul>` : html`<p class="empty-inline">Première rencontre entre ces deux équipes.</p>`}
  </section>`;
}

export function upcomingMatch(m: D.Match, variant: 'visitor' | 'official' | 'proposed'): string {
  const viewer: Viewer = variant === 'official' ? { ...D.viewers.official, team: 'greed-academy' } : null;
  const chooser = m.sideChooser === 'a' ? m.a : m.b;
  const ot = m.otSideChooser === 'a' ? m.a : m.b;
  const host = m.host ? (m.host === 'a' ? m.a : m.b) : null;
  const vetoLive = m.vetoState === 'in_progress';
  const actions = variant === 'official'
    ? html`<section class="actions" aria-labelledby="act">
        <h2 id="act" class="h-sm">${icon('shield', 16)} Actions pour GREED Academy</h2>
        <p class="sm muted">Vous êtes manager du club Greed : vous agissez pour GREED Academy comme son capitaine.</p>
        <div class="act-grid">
          <a class="btn btn-primary" href="${rel('veto-live.html')}">${icon('timer', 16)} Reprendre le veto · à vous</a>
          <a class="btn" href="#propose" aria-disabled="true">${icon('clock', 16)} Proposer un horaire</a>
          <a class="btn" href="#report">${icon('check', 16)} Déclarer le résultat</a>
          <a class="btn" href="${rel('upload.html')}">${icon('upload', 16)} Envoyer replays et MOSS</a>
        </div>
        <p class="sm muted">L’horaire est déjà convenu ; une nouvelle proposition remplacerait l’accord. La déclaration du résultat s’ouvre au début du match.</p>
      </section>`
    : '';
  const timeBlock =
    variant === 'proposed' && m.proposal
      ? html`<div class="callout">${icon('clock', 16)} <div><strong>${(m.proposal.by === 'a' ? m.a : m.b).name}</strong> propose le <strong>${D.when(m.proposal.at)}</strong>, depuis ${D.relative(m.proposal.madeAt)}. ${(m.proposal.by === 'a' ? m.b : m.a).name} n’a pas encore répondu. Sans accord à la fin de la semaine, le match passe en prolongation et se joue d’office le dimanche suivant à 21:00.</div></div>`
      : html`<div class="callout callout-ok">${icon('check', 16)} <div>Horaire convenu : <strong>${D.when(m.scheduledAt as number)}</strong>. ${vetoLive ? 'Le veto a commencé : 4 bans sur 8.' : ''}</div></div>`;
  const body = html`${leagueHead(m, vetoLive ? html`<a class="live-link" href="${rel('veto-live.html')}"><span class="dot-live" aria-hidden="true"></span>Veto en direct : ${m.veto.length} bans sur 8 ${icon('chevronRight', 14)}</a>` : html`<span>Fenêtre : ${D.dateShort(D.weekRange(m.week).start)} – ${D.dateShort(D.weekRange(m.week).end)}</span>`)}
  ${sectionNav([
    ['Infos', 'infos'],
    ['Avant-match', 'apercu'],
    ['Compos', 'compos'],
  ])}
  <div class="page split">
    <div class="col-main">
      ${actions}
      <section id="infos">
        ${sectionHead('Horaire et côtés')}
        ${timeBlock}
        ${facts([
          ['Fenêtre de jeu', `${t('week')} ${m.week} : ${D.dateShort(D.weekRange(m.week).start)} – ${D.dateShort(D.weekRange(m.week).end)}`],
          ['Date limite', `${D.when(D.weekRange(m.week).end)} ; prolongation d’une semaine sinon`],
          ['Hôte', host ? html`${teamBadge(host, { size: 16 })} ${host.name} <span class="muted sm">(mieux classée)</span>` : 'À convenir entre les équipes'],
          ['Choix du côté et premier ban', m.coinToss ? html`${icon('coin', 14)} Tirage au sort` : html`${teamBadge(chooser, { size: 16 })} ${chooser.name} <span class="muted sm">(moins bien classée)</span>`],
          ['Côté en prolongation', html`${teamBadge(ot, { size: 16 })} ${ot.name}`],
          ['Format', 'BO1 : 8 bans alternés, la dernière carte est jouée'],
          ['Diffusion', m.stream ? html`<a href="${m.stream}">${icon('play', 14)} ${m.stream.replace('https://', '')}</a>` : 'Aucune annoncée'],
        ])}
      </section>
      ${preview(m)}
    </div>
    <aside class="col-side">
      <section>${sectionHead('Capitaines')}
        <ul class="list">${[m.a, m.b].map((x) => {
          const cap = (D.rosters.get(x.slug) ?? []).find((e) => e.captain);
          return html`<li class="li-team">${teamBadge(x, { size: 18 })}<span>${x.tag}</span>${cap ? playerLink(cap.player) : ''}</li>`;
        })}</ul>
      </section>
      ${vetoLive ? html`<section>${sectionHead('Veto', ['Suivre', `/matches/${m.id}/veto`])}${vetoSummary(m.veto, m.a, m.b)}<p class="sm muted">${(m.sideChooser === 'a' ? m.a : m.b).tag} doit bannir (étape 5 sur 9).</p></section>` : ''}
    </aside>
  </div>
  <div class="page" id="compos">${sectionHead('Compositions annoncées')}${lineups(m)}</div>`;
  return doc({ title: `${m.a.name} – ${m.b.name}`, comp: 'lfr', body, viewer, nav: 'matches' });
}
