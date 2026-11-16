// Veto (BO1 live and done, BO3), the Coupe de France bracket, a BO3 cup match with one tab per
// map, and the replay upload page.

import * as D from '../../_data/index.ts';
import { href, html, icon, raw, rel, teamBadge, teamRoute, type Raw } from '../../_build/lib.ts';
import { t } from '../../_build/i18n.ts';
import { doc, tabs, type Viewer } from './layout.ts';
import { facts, pill, playerLink, sectionHead, sideLabel, sourceBadge } from './ui.ts';
import { lineups, matchHead, roundStrip, scoreboard, vetoSummary } from './p-match.ts';

const mapThumb = (map: string) => {
  // Flat colour placeholder where a map thumbnail would sit; no game art.
  const hue = [...map].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
  return html`<span class="map-th" style="background:hsl(${hue} 18% 86%)" aria-hidden="true">${map.slice(0, 2).toUpperCase()}</span>`;
};

// ---------------------------------------------------------------------------------------------
// BO1 veto, live (seen by GREED Academy, whose turn it is) and done.

export function vetoPage(state: 'live' | 'done'): string {
  const m = D.featured.toPlay;
  const steps = state === 'live' ? m.veto : D.finishedVetoOf(m);
  const teamA = m.sideChooser === 'a' ? m.a : m.b; // bans first and has side selection
  const teamB = teamA === m.a ? m.b : m.a;
  const sideOf = (s: 'a' | 'b' | null) => (s === 'a' ? m.a : s === 'b' ? m.b : null);
  const viewer: Viewer = state === 'live' ? { ...D.viewers.official } : null;
  const banned = new Map(steps.filter((s) => s.action === 'ban').map((s) => [s.map as string, s]));
  const played = steps.find((s) => s.action === 'decider')?.map ?? null;
  const nextSeq = steps.length + 1;
  const remaining = D.MAP_POOL.filter((mp) => !banned.has(mp) && mp !== played);
  // The nine BO1 steps: A ban, B ban, …, then the map left is played; then the two side steps.
  const plan = [
    ...Array.from({ length: 8 }, (_, i) => ({ seq: i + 1, team: i % 2 === 0 ? teamA : teamB, label: 'Ban' })),
    { seq: 9, team: null as D.Team | null, label: 'Carte jouée' },
    { seq: 10, team: teamA, label: 'Côté de départ' },
    { seq: 11, team: teamB, label: 'Côté en prolongation' },
  ];
  const turnBox =
    state === 'live'
      ? html`<section class="turn" aria-live="polite">
        <div class="turn-main">
          <p class="turn-k">Étape ${nextSeq} sur 9 · à vous</p>
          <p class="turn-t">${teamBadge(teamA, { size: 28 })} <strong>${teamA.name}</strong> bannit une carte</p>
        </div>
        <div class="timer" role="timer" aria-label="Temps restant : 3 minutes 12">
          <span class="timer-v">3:12</span><span class="timer-k">sur 4:00</span>
          <span class="timer-bar"><span style="width:80%"></span></span>
        </div>
        <p class="sm muted turn-note">Sans choix à 0:00, une carte restante est bannie au hasard et l’étape est marquée « temps écoulé ». La page se met à jour seule toutes les 3 secondes.</p>
      </section>`
      : html`<section class="turn turn-done"><p class="turn-k">Veto terminé à ${D.time(D.NOW - 6 * 60_000)}</p><p class="turn-t">Carte jouée : <strong>${played}</strong> · ${teamA.tag} commence en ${sideLabel(steps.find((s) => s.action === 'side')?.side as 'atk' | 'def').toLowerCase()} · ${teamB.tag} choisit ${sideLabel(steps.find((s) => s.action === 'ot_side')?.side as 'atk' | 'def').toLowerCase()} en prolongation</p></section>`;
  const body = html`${matchHead({
    a: { team: m.a, note: 'Hôte' },
    b: { team: m.b, note: 'Choix du côté, 1er ban' },
    score: null,
    status: state === 'live' ? pill('live', t('stVeto')) : pill('done', 'Veto terminé'),
    context: 'BO1 · veto',
    crumbs: [
      ['LFR', '/c/lfr/s3'],
      ['Ligue 1', '/c/lfr/s3/standings/ligue-1'],
      [`${t('week')} 6`, '/c/lfr/s3/calendar'],
      ['Veto', null],
    ],
    when: html`${icon('calendar', 14)} ${D.day(m.scheduledAt as number)} ${icon('clock', 14)} ${D.timeZ(m.scheduledAt as number)}`,
    under: html`<a href="${href(`/matches/${m.id}`)}">${icon('chevronRight', 14)} Page du match</a>`,
  })}
  <div class="page split">
    <div class="col-main">
      ${turnBox}
      <section>
        ${sectionHead('Pool de cartes · 9 cartes')}
        <ul class="list pool">${D.MAP_POOL.map((mp) => {
          const b = banned.get(mp);
          const by = b ? sideOf(b.team) : null;
          const isPlayed = mp === played;
          return html`<li class="pool-r ${b ? 'is-banned' : ''} ${isPlayed ? 'is-played' : ''}">
            ${mapThumb(mp)}<span class="pool-n">${mp}</span>
            ${
              b
                ? html`<span class="pool-s">${by ? html`${teamBadge(by, { size: 16 })} ${by.tag}` : ''} ban ${b.seq}${b.timedOut ? html` ${pill('warn', 'temps écoulé', 'pill-xs')}` : ''}</span>`
                : isPlayed
                  ? pill('done', 'Carte jouée')
                  : state === 'live'
                    ? html`<form method="post" action="#veto-ban" class="pool-f"><input type="hidden" name="map" value="${mp}"><button class="btn btn-ban" type="submit">${icon('x', 14)} Bannir</button></form>`
                    : ''
            }
          </li>`;
        })}</ul>
        ${state === 'live' ? html`<p class="sm muted">${remaining.length} cartes restantes. Un clic bannit sans confirmation, comme le bouton du message Discord ; la même étape s’y affiche.</p>` : ''}
      </section>
      ${state === 'done' ? html`<section>${sectionHead('Côtés')}${facts([
        ['Côté de départ', html`${teamBadge(teamA, { size: 16 })} ${teamA.name} : ${sideLabel(steps.find((s) => s.action === 'side')?.side as 'atk' | 'def')}`],
        ['Côté en prolongation', html`${teamBadge(teamB, { size: 16 })} ${teamB.name} : ${sideLabel(steps.find((s) => s.action === 'ot_side')?.side as 'atk' | 'def')}`],
        ['Hôte', html`${teamBadge(m.a, { size: 16 })} ${m.a.name}`],
      ])}</section>` : ''}
    </div>
    <aside class="col-side">
      <section>
        ${sectionHead('Ordre du veto')}
        <ol class="seq">${plan.map((p) => {
          const done = steps.find((s) => s.seq === p.seq);
          const isNow = state === 'live' && p.seq === nextSeq;
          const value = done ? (done.action === 'side' || done.action === 'ot_side' ? sideLabel(done.side as 'atk' | 'def') : done.map) : isNow ? 'en cours' : '';
          return html`<li class="${done ? 'seq-done' : ''} ${isNow ? 'seq-now' : ''} ${done?.timedOut ? 'seq-to' : ''}">
            <span class="seq-n">${p.seq}</span>
            <span class="seq-team">${p.team ? html`${teamBadge(p.team, { size: 16 })} ${p.team.tag}` : html`<span class="muted">—</span>`}</span>
            <span class="seq-l">${p.label}</span>
            <span class="seq-v">${value}${done?.timedOut ? html` ${pill('warn', 'temps écoulé', 'pill-xs')}` : ''}${done?.took && !done.timedOut ? html`<span class="seq-took">${Math.floor(done.took / 60)}:${String(done.took % 60).padStart(2, '0')}</span>` : ''}</span>
          </li>`;
        })}</ol>
        <p class="sm muted">${teamA.tag} est moins bien classée : elle bannit en premier et choisit le côté de départ. ${teamB.tag}, mieux classée, héberge le lobby et choisit le côté en prolongation. 4 minutes par étape.</p>
      </section>
    </aside>
  </div>`;
  return doc({ title: `Veto · ${m.a.name} – ${m.b.name}`, comp: 'lfr', body, viewer, nav: 'matches' });
}

// ---------------------------------------------------------------------------------------------
// The cup's QF 1 (BO3).

const qf = () => D.featured.cupBo3;
const seedNote = (s: D.CupSeed | null) => (s ? `${s.division} · ${s.finalRank}${s.finalRank === 1 ? 'er' : 'e'} · tête de série ${s.seed}` : '');

export function vetoBo3(): string {
  const m = qf();
  const a = (m.a as D.CupSeed).team;
  const b = (m.b as D.CupSeed).team;
  const tm = (s: 'a' | 'b' | null) => (s === 'a' ? a : s === 'b' ? b : null);
  const steps = D.cupVetoQf1;
  const mapsPlayed = steps.filter((s) => s.action === 'pick' || s.action === 'decider');
  const body = html`${matchHead({
    a: { team: a, note: seedNote(m.a) },
    b: { team: b, note: seedNote(m.b) },
    score: m.series ? [m.series[0], m.series[1]] : null,
    winner: m.winner,
    status: pill('done', 'Veto terminé'),
    context: 'BO3 · veto',
    crumbs: [
      ['LFR', '/c/lfr/s3'],
      ['Coupe de France', '/c/lfr/s3/bracket'],
      ['Quart de finale 1', null],
    ],
    when: html`${icon('calendar', 14)} ${D.day(m.at as number)} ${icon('clock', 14)} ${D.timeZ(m.at as number)}`,
  })}
  <div class="page split">
    <div class="col-main">
      <section>
        ${sectionHead('Cartes et côtés')}
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th scope="col">Carte</th><th scope="col">Choisie par</th><th scope="col">Côté de départ</th><th scope="col" class="hide-s">Prolongation</th></tr></thead>
          <tbody>${mapsPlayed.map((p, i) => {
            const side = steps.find((s) => s.action === 'side' && s.map === p.map);
            const ot = steps.find((s) => s.action === 'ot_side' && s.map === p.map);
            return html`<tr><th scope="row">${mapThumb(p.map as string)} <span>Carte ${i + 1} · ${p.map}</span></th>
              <td>${p.action === 'decider' ? html`<span class="muted">Décisive</span>` : html`${teamBadge(tm(p.team) as D.Team, { size: 16 })} ${tm(p.team)?.tag}`}</td>
              <td>${side ? html`${tm(side.team)?.tag} : ${sideLabel(side.side as 'atk' | 'def')}${'coin' in side ? html` <span class="muted sm">(${icon('coin', 12)} tirage)</span>` : ''}` : ''}</td>
              <td class="hide-s">${ot ? html`${tm(ot.team)?.tag} : ${sideLabel(ot.side as 'atk' | 'def')}` : ''}</td></tr>`;
          })}</tbody>
        </table></div>
        <p class="sm muted">BO3 : A ban, B ban, A ban, B ban, A pick, B pick, A ban, B ban, la carte restante est décisive. L’adversaire de celui qui choisit une carte prend le côté de départ ; un nouveau tirage au sort donne le choix du côté sur la décisive.</p>
      </section>
    </div>
    <aside class="col-side">
      <section>${sectionHead('Ordre du veto')}${vetoSummary(steps as unknown as D.VetoStep[], a, b)}</section>
    </aside>
  </div>`;
  return doc({ title: `Veto · ${a.name} – ${b.name}`, comp: 'lfr', body, nav: 'matches' });
}

export function cupMatch(n: number): string {
  const m = qf();
  const a = (m.a as D.CupSeed).team;
  const b = (m.b as D.CupSeed).team;
  const game = m.games[n - 1] as D.CupGame;
  const sim = game.sim as D.GameSim;
  const files = ['match-cup-bo3.html', 'match-cup-bo3-g2.html', 'match-cup-bo3-g3.html'];
  const gameTabs = html`<nav class="tabs" aria-label="Cartes"><div class="tabs-in">${m.games.map(
    (g, i) => html`<a href="${rel(files[i] as string)}" ${i + 1 === n ? raw('aria-current="page"') : ''}>Carte ${g.n}<span class="tab-count">${g.map.split(' ')[0]} ${g.score?.[0]}–${g.score?.[1]}</span></a>`,
  )}<a href="${rel('veto-bo3.html')}">Veto</a></div></nav>`;
  const body = html`${matchHead({
    a: { team: a, note: seedNote(m.a) },
    b: { team: b, note: seedNote(m.b) },
    score: m.series ? [m.series[0], m.series[1]] : null,
    winner: m.winner,
    status: pill('done', t('stValidated')),
    context: 'BO3',
    crumbs: [
      ['LFR', '/c/lfr/s3'],
      ['Coupe de France', '/c/lfr/s3/bracket'],
      ['Quart de finale 1', null],
    ],
    when: html`${icon('calendar', 14)} ${D.day(m.at as number)} ${icon('clock', 14)} ${D.timeZ(m.at as number)}`,
    under: html`<span>${m.games.map((g) => `${g.map} ${g.score?.[0]}–${g.score?.[1]}`).join(' · ')}</span>`,
  })}
  ${gameTabs}
  <div class="page split">
    <div class="col-main">
      <section>
        ${sectionHead(`Carte ${n} · ${game.map} · ${game.score?.[0]}–${game.score?.[1]}`)}
        <p class="sm muted">${game.pickedBy ? `Choisie par ${(game.pickedBy === 'a' ? a : b).name}` : 'Carte décisive'}${game.startSide ? ` · ${(game.startSide.team === 'a' ? a : b).tag} commence en ${sideLabel(game.startSide.side).toLowerCase()}` : ''}${sim.overtime ? ' · prolongation' : ''}</p>
        ${roundStrip(sim, a, b)}
        <div class="src-line">${sourceBadge(game.stats)}</div>
      </section>
      <section>${sectionHead('Tableau des joueurs')}${scoreboard(a, 'a', sim, game.stats)}${scoreboard(b, 'b', sim, game.stats)}</section>
    </div>
    <aside class="col-side">
      <section>${sectionHead('Série')}
        <ol class="list games">${m.games.map((g, i) => {
          const wa = (g.score?.[0] ?? 0) > (g.score?.[1] ?? 0);
          return html`<li class="${i + 1 === n ? 'cur' : ''}"><a href="${rel(files[i] as string)}"><span class="muted sm">Carte ${g.n}</span><span>${g.map}</span><span class="num"><span class="${wa ? 'b' : ''}">${g.score?.[0]}</span>–<span class="${wa ? '' : 'b'}">${g.score?.[1]}</span></span></a></li>`;
        })}</ol>
      </section>
      <section>${sectionHead('Infos du match')}${facts([
        ['Tour', 'Quart de finale · BO3'],
        ['Côté de départ (carte 1)', 'Désigné par le staff : Panaria Lair'],
        ['Hôte', 'Convenu entre les équipes : Greed Esport'],
        ['Validé', 'Confirmation de Panaria Lair, 22:58'],
      ])}</section>
    </aside>
  </div>
  <div class="page">${sectionHead('Compositions')}${lineups({ a, b })}</div>`;
  return doc({ title: `${a.name} – ${b.name} · carte ${n}`, comp: 'lfr', body, nav: 'matches' });
}

// ---------------------------------------------------------------------------------------------
// Coupe de France bracket (mock date: 21 January 2027).

function bracketBox(m: D.CupMatch | null): Raw {
  if (!m) return html`<div class="bk-m bk-empty" aria-hidden="true"></div>`;
  const line = (s: D.CupSeed | null, from: string | undefined, side: 'a' | 'b') => {
    const won = m.winner === side;
    const score = m.series ? m.series[side === 'a' ? 0 : 1] : '';
    const dq = m.dq?.side === side;
    return html`<span class="bk-t ${won ? 'won' : ''} ${m.winner && !won ? 'lost' : ''}">
      ${s ? html`<span class="bk-seed">${s.division}·${s.finalRank}</span>${teamBadge(s.team, { size: 18 })}<a href="${href(teamRoute(s.team))}" class="bk-name">${s.team.name}</a>` : html`<span class="bk-seed"></span><span class="bk-tbd">${from ?? 'À déterminer'}</span>`}
      <span class="bk-sc">${dq ? 'DQ' : m.status === 'dq' ? '' : score}</span></span>`;
  };
  const foot =
    m.status === 'dq'
      ? html`<span class="bk-f warn">${m.dq?.reason}</span>`
      : m.status === 'live'
        ? html`<span class="bk-f live"><span class="dot-live" aria-hidden="true"></span>En direct · carte 2</span>`
        : m.status === 'done'
          ? html`<span class="bk-f">${D.dateShort(m.at as number)} · <a href="${href(m.id === D.featured.cupBo3.id ? `/matches/${m.id}` : `/matches/${m.id}`)}">Détail</a></span>`
          : m.status === 'proposed'
            ? html`<span class="bk-f">Horaire proposé : ${D.when(m.at as number)}</span>`
            : html`<span class="bk-f">${m.at ? D.when(m.at) : ''}</span>`;
  return html`<div class="bk-m bk-${m.status}">${line(m.a, m.aFrom, 'a')}${line(m.b, m.bFrom, 'b')}${foot}</div>`;
}

export function cupPage(): string {
  const byRound = (r: string) => D.cupMatches.filter((m) => m.round === r).sort((x, y) => x.slot - y.slot);
  // Preliminary matches sit next to the round-of-16 slot they feed.
  const prelimFor: Record<number, number> = { 1: 3, 5: 1, 8: 2 };
  const prelimCol = Array.from({ length: 8 }, (_, i) => {
    const slot = prelimFor[i + 1];
    return slot ? (byRound('prelim').find((m) => m.slot === slot) ?? null) : null;
  });
  const cols: [string, string, (D.CupMatch | null)[]][] = [
    ['Tour préliminaire', 'BO1', prelimCol],
    ['Huitièmes', 'BO3', byRound('r16')],
    ['Quarts', 'BO3', byRound('qf')],
    ['Demi-finales', 'BO5', byRound('sf')],
    ['Finale', 'BO5', byRound('final')],
  ];
  const bar = D.barrage;
  const body = html`${tabsHead()}
  <div class="page">
    <div class="bar"><h2 class="h-sec">Coupe de France · Saison 3</h2><p class="muted sm">Maquette au ${D.when(D.CUP_NOW)}</p></div>
    <div class="cup-sum">
      ${facts([
        ['Format', '19 équipes de Ligue 1 et Ligue 2, élimination directe'],
        ['Têtes de série', 'Par division puis rang final : Ligue 1 de 1 à 8, Ligue 2 de 9 à 19'],
        ['Exemptés', 'Têtes de série 1 à 13 : directement en huitièmes'],
        ['Matchs', 'BO1 au tour préliminaire, BO3 en huitièmes et quarts, BO5 en demies et finale'],
        ['Absence', 'Une équipe absente est disqualifiée ; si les deux le sont, l’adversaire suivant est exempté'],
      ])}
    </div>
    <p class="sm muted bk-hint">${icon('swap', 14)} Le tableau défile horizontalement sur téléphone.</p>
    <div class="bk-scroll" tabindex="0" role="region" aria-label="Tableau de la Coupe de France">
      <div class="bk">${cols.map(
        ([label, bo, ms]) => html`<div class="bk-col"><h3 class="bk-h">${label} <span class="muted">${bo}</span></h3><div class="bk-ms" style="--rows:${ms.length}">${ms.map(bracketBox)}</div></div>`,
      )}</div>
    </div>
    <div class="split">
      <section class="col-main">
        ${sectionHead('Barrage de montée / maintien')}
        <ul class="mlist"><li class="mr"><a href="#barrage">
          <span class="mr-when"><span class="mr-t">${D.dateShort(bar.at)}</span><span class="mr-s">Fin</span></span>
          <span class="mr-teams">
            <span class="mr-team lost">${teamBadge(bar.a.team, { size: 20 })}<span class="tn-long">${bar.a.team.name}</span><span class="tn-short">${bar.a.team.tag}</span><span class="muted sm">${bar.a.note}</span><span class="mr-score">${bar.score[0]}</span></span>
            <span class="mr-team won">${teamBadge(bar.b.team, { size: 20 })}<span class="tn-long">${bar.b.team.name}</span><span class="tn-short">${bar.b.team.tag}</span><span class="muted sm">${bar.b.note}</span><span class="mr-score">${bar.score[1]}</span></span>
          </span>
          <span class="mr-info"><span class="mr-meta"><span>BO1</span><span>${bar.map}</span></span></span>
        </a></li></ul>
        <p class="sm">${bar.outcome}</p>
      </section>
      <section class="col-side">
        ${sectionHead('Exemptés du tour préliminaire')}
        <ul class="list seeds">${D.cupByes.map((s) => html`<li><span class="num seed-n">${s.seed}</span>${teamBadge(s.team, { size: 16 })} <span>${s.team.name}</span><span class="muted sm">${s.division} · ${s.finalRank}e</span></li>`)}</ul>
      </section>
    </div>
  </div>`;
  return doc({ title: 'Coupe de France', comp: 'lfr', body, nav: 'matches' });
}

function tabsHead(): Raw {
  // The cup sits in the competition's pages: same band and tabs as the hub.
  return html`${lfrHeadCup()}${compTabsCup()}`;
}
import { compTabs, lfrHead } from './layout.ts';
const lfrHeadCup = () => lfrHead();
const compTabsCup = () => compTabs('cup');

// ---------------------------------------------------------------------------------------------
// Replay, MOSS and screenshot upload (Wmates Spectrum v Mixt N' chill, by a MNC player).

export function uploadPage(): string {
  const u = D.upload;
  const m = u.match;
  const me = D.player(u.uploader);
  const viewer: Viewer = { name: me.tag, role: 'Joueur, Mixt N’ chill', team: 'mixt-n-chill' };
  const lineupA = D.starters(m.a);
  const lineupB = D.starters(m.b);
  const done = u.files.filter((f) => f.progress >= 1).length;
  const body = html`${matchHead({
    a: { team: m.a },
    b: { team: m.b },
    score: m.reported ? [m.reported.score[0], m.reported.score[1]] : null,
    winner: null,
    status: pill('pending', t('stReported')),
    context: 'BO1 · envoi des fichiers',
    crumbs: [
      ['LFR', '/c/lfr/s3'],
      ['Ligue 2', '/c/lfr/s3/standings/ligue-2'],
      [`${t('week')} 6`, '/c/lfr/s3/calendar'],
      ['Envoi', null],
    ],
    when: html`${icon('calendar', 14)} ${D.day(m.scheduledAt as number)} ${icon('clock', 14)} ${D.timeZ(m.scheduledAt as number)}`,
  })}
  <div class="page split">
    <div class="col-main">
      <ol class="steps">
        <li class="st-done"><span class="st-n">1</span><div>
          <h2 class="h-sm">Dossiers de replay</h2>
          <p class="sm muted">Dossier <code>MatchReplay</code> choisi. Les dossiers datés pendant le match sont cochés.</p>
          <ul class="list files">${u.folders.map((f) => html`<li><label class="chk"><input type="checkbox" ${f.inWindow ? raw('checked') : ''}> <code>${f.name}</code></label><span class="num sm">${f.files} fichiers · ${D.dec1(f.size)} Mo</span>${f.note ? html`<span class="muted sm full">${f.note}</span>` : ''}</li>`)}</ul>
        </div></li>
        <li class="st-done"><span class="st-n">2</span><div>
          <h2 class="h-sm">Lobbys trouvés · ${u.map}</h2>
          <p class="sm muted">Analysés dans votre navigateur ; rien n’a encore quitté votre PC.</p>
          ${u.lobbies.map((l) => {
            const [winners, tail] = l.rounds as [string[], string | undefined];
            return html`<div class="lobby"><p class="lobby-h"><strong>Lobby ${l.n}</strong> <span class="muted sm">${l.n === 1 ? u.folders[0]?.lobby : u.folders[1]?.lobby}</span><span class="num">${m.a.tag} ${l.scoreA}–${l.scoreB} ${m.b.tag}</span></p>
              <ol class="rw">${winners.map((w, i) => html`<li class="rw-${w}" title="Round ${i + 1} : ${w === 'a' ? m.a.tag : m.b.tag}">${w === 'a' ? m.a.tag : m.b.tag}</li>`)}${tail ? html`<li class="rw-void" title="Round interrompu">×</li>` : ''}</ol></div>`;
          })}
          <p class="callout callout-ok">${icon('check', 16)} Re-host reconstitué : 2–4 puis 3–3 = <strong>5–7</strong>, le score déclaré. 1 round interrompu sera annulé.</p>
        </div></li>
        <li class="st-done"><span class="st-n">3</span><div>
          <h2 class="h-sm">Joueurs reconnus</h2>
          <div class="pm">${[
            [m.a, lineupA],
            [m.b, lineupB],
          ].map(([team, list]) => html`<div><p class="pm-h">${teamBadge(team as D.Team, { size: 16 })} ${(team as D.Team).name}</p><ul class="list">${(list as string[]).map((p) => html`<li class="pm-p">${icon('check', 14)} ${playerLink(p)}</li>`)}</ul></div>`)}</div>
          ${u.unknown.map((x) => html`<p class="callout callout-warn">${icon('alert', 16)} <span><strong>${x.name}</strong> (profileID ${x.profile}) joue pour ${x.side === 'a' ? m.a.name : m.b.name} mais n’est dans aucune composition. Le staff sera prévenu ; l’envoi continue.</span></p>`)}
        </div></li>
        <li class="st-now"><span class="st-n">4</span><div>
          <h2 class="h-sm">Envoi des fichiers · ${done}/${u.files.length}</h2>
          <p class="sm muted">Les statistiques sont déjà envoyées. Les fichiers bruts partent 3 par 3 pour que le serveur vérifie ; gardez cet onglet ouvert.</p>
          <ul class="list prog">${u.files.map((f) => html`<li><span class="prog-n"><code>${f.name}</code><span class="num sm muted">${D.dec1(f.size)} Mo</span></span>
            <span class="prog-bar" role="progressbar" aria-valuenow="${Math.round(f.progress * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="${f.name}"><span style="width:${f.progress * 100}%"></span></span>
            <span class="num sm prog-v">${f.progress >= 1 ? html`${icon('check', 13)} envoyé` : f.progress > 0 ? D.pct(f.progress) : 'en attente'}</span></li>`)}</ul>
        </div></li>
        <li><span class="st-n">5</span><div>
          <h2 class="h-sm">MOSS et capture</h2>
          <div class="up-grid">
            <label class="drop">${icon('lock', 16)}<span><strong>Fichier MOSS</strong><br><span class="sm muted">Obligatoire. Visible du staff seulement. .zip, 50 Mo max.</span></span><input type="file" class="sr"><span class="btn">Choisir</span></label>
            <div class="drop drop-ok">${icon('check', 16)}<span><strong>Capture du score</strong><br><span class="sm muted">Déjà jointe à la déclaration de ${D.time(m.reported?.at as number)}. Staff et équipes du match seulement.</span></span></div>
          </div>
        </div></li>
      </ol>
    </div>
    <aside class="col-side">
      <section>${sectionHead('Ce qui se passe ensuite')}
        ${facts([
          ['Statistiques', 'Affichées tout de suite, marquées « replay non vérifié »'],
          ['Vérification', 'Le serveur relit chaque fichier ; identique → vérifié'],
          ['Résultat', 'Ne dépend pas des replays : il attend la confirmation de Wmates Spectrum'],
          ['Conservation', 'Fichiers bruts gardés une saison, statistiques pour toujours'],
        ])}
      </section>
    </aside>
  </div>`;
  return doc({ title: 'Envoi des replays', comp: 'lfr', body, viewer, nav: 'matches' });
}
