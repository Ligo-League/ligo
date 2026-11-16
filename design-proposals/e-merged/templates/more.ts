// Veto (BO1 live and done, BO3), replay upload, the cup bracket; and the RENDER map of every
// page not built in pages.ts.

import * as D from '../../_data/index.ts';
import { html, href, icon, raw, teamBadge, type Raw } from '../../_build/lib.ts';
import { sideTeam, otherSide } from '../../_build/shared.ts';
import { page, type Viewer } from './layout.ts';
import { team, panel, pill, kv, mapThumb, playerLink, tabs } from './parts.ts';
import * as entity from './entity.ts';
import * as league from './league.ts';
import * as priv from './private.ts';

type Side = 'a' | 'b';
const V = D.viewers;
const official: Viewer = { name: V.official.name, role: V.official.role, team: V.official.team };

function vetoHeader(a: D.Team, b: D.Team, ctx: string, when: string, right: Raw): Raw {
  return html`<section class="mh"><div class="mh-top"><span>${ctx}</span><span class="grow">${right}</span></div>
    <div class="mh-body" style="padding:10px 12px">
      <a class="mh-team a" href="${href(`/teams/${a.slug}`)}">${teamBadge(a, { size: 32 })}<span class="nm">${a.name}</span></a>
      <div class="mh-mid"><div class="mh-when" style="font-size:13px">${when}</div></div>
      <a class="mh-team b" href="${href(`/teams/${b.slug}`)}">${teamBadge(b, { size: 32 })}<span class="nm">${b.name}</span></a>
    </div></section>`;
}

const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function stepTable(m: { a: D.Team; b: D.Team }, steps: D.VetoStep[], total: { team: Side | null; action: D.VetoStep['action'] }[], current: number | null): Raw {
  const actionLabel = (a: D.VetoStep['action']) => ({ ban: 'Ban', pick: 'Choix', decider: 'Décisive', side: 'Côté de départ', ot_side: 'Côté en prolongation' })[a];
  return html`<table class="data dense"><caption class="vh">Séquence du veto</caption>
    <thead><tr><th scope="col" class="num">#</th><th scope="col">Équipe</th><th scope="col">Action</th><th scope="col">Carte / côté</th><th scope="col" class="num opt">Temps</th></tr></thead>
    <tbody>${total.map((tt, i) => {
      const s = steps[i];
      const who = tt.team ? sideTeam(m as D.Match, tt.team) : null;
      const cur = current === i;
      return html`<tr class="${cur ? 'hl-row' : ''}"><td class="num">${i + 1}</td><td>${who ? team(who, { size: 14, tagOnly: true }) : html`<span class="faint">—</span>`}</td>
        <td>${actionLabel(tt.action)}</td>
        <td>${s ? html`${s.action === 'side' || s.action === 'ot_side' ? html`<b>${s.side === 'atk' ? 'Attaque' : 'Défense'}</b> <span class="faint">${s.map}</span>` : html`<b>${s.map}</b>`}${s.timedOut ? html` ${pill('warn', 'temps écoulé : carte tirée au sort', 'clock')}` : ''}` : cur ? pill('live', 'en cours', 'timer') : html`<span class="faint">en attente</span>`}</td>
        <td class="num opt">${s?.took ? fmtSec(s.took) : ''}</td></tr>`;
    })}</tbody></table>`;
}

const BO1_SEQ = (first: Side): { team: Side | null; action: D.VetoStep['action'] }[] => [
  ...Array.from({ length: 8 }, (_, i) => ({ team: (i % 2 === 0 ? first : otherSide(first)) as Side, action: 'ban' as const })),
  { team: null, action: 'decider' as const },
];

function mapGrid(steps: D.VetoStep[], m: { a: D.Team; b: D.Team }, live: boolean): Raw {
  return html`<div class="veto-grid">${D.MAP_POOL.map((mp) => {
    const s = steps.find((x) => x.map === mp && (x.action === 'ban' || x.action === 'pick' || x.action === 'decider'));
    const by = s?.team ? sideTeam(m as D.Match, s.team).tag : '';
    const cls = !s ? '' : s.action === 'ban' ? 'banned' : 'played';
    const sub = !s ? (live ? 'disponible' : '') : s.action === 'ban' ? `banni par ${by}, étape ${s.seq}${s.timedOut ? ' (tirage)' : ''}` : s.action === 'pick' ? `choisie par ${by}` : 'carte jouée';
    const inner = html`<span class="ph2" style="background:hsl(${[...mp].reduce((a, c) => a + c.charCodeAt(0), 0) % 360} 18% 72%)"></span><span class="vm-n">${mp}</span><span class="vm-s">${sub}</span>`;
    return !s && live
      ? html`<button class="vmap" type="submit" name="map" value="${mp}" aria-label="Bannir ${mp}">${inner}</button>`
      : html`<div class="vmap ${cls}">${inner}</div>`;
  })}</div>`;
}

function vetoBo1(done: boolean): string {
  const m = D.featured.toPlay;
  const steps = done ? D.finishedVetoOf(m) : m.veto;
  const first = (m.sideChooser ?? 'b') as Side;
  const seq = [...BO1_SEQ(first), { team: first, action: 'side' as const }, { team: otherSide(first), action: 'ot_side' as const }];
  const map = steps.find((s) => s.action === 'decider')?.map;
  const side = steps.find((s) => s.action === 'side');
  const ot = steps.find((s) => s.action === 'ot_side');
  const main = html`
  ${vetoHeader(m.a, m.b, `LFR · Ligue 1 · Semaine 6 · BO1 · veto`, `jeu. 26 nov. · 21:00 CET`, done ? pill('done', 'Veto terminé', 'check') : pill('live', 'Veto en cours', 'timer'))}
  ${done
    ? html`<p class="note ok">${icon('check', 12)} Carte jouée : <b>${map}</b>. ${side?.team ? sideTeam(m, side.team).name : ''} commence en <b>${side?.side === 'atk' ? 'attaque' : 'défense'}</b> ; ${ot?.team ? sideTeam(m, ot.team).name : ''} choisit <b>${ot?.side === 'atk' ? 'l’attaque' : 'la défense'}</b> en prolongation. Le bot a posté le résultat du veto dans le salon du match.</p>`
    : html`<section class="panel"><div class="turn">
        <div><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--warn);font-weight:700">À vous · étape 5 sur 9</div>
        <div style="font-size:15px;font-weight:600">${m.b.name} bannit une carte</div>
        <div class="faint" style="font-size:12px">Sans choix à la fin du minuteur, une carte restante est bannie au hasard.</div></div>
        <div style="text-align:right"><div class="timer" aria-live="polite">2:37</div><div class="faint" style="font-size:11px">sur 4:00</div></div>
      </div>
      <form method="post" action="#veto-step" hx-post="#veto-step" hx-swap="outerHTML">${raw('<input type="hidden" name="_csrf" value="mock">')}${mapGrid(steps, m, true)}</form></section>`}
  ${done ? panel('Cartes', mapGrid(steps, m, false)) : ''}
  <div class="grid2">
    ${panel('Séquence BO1', stepTable(m, steps, seq, done ? null : steps.length), { extra: html`<span class="faint">4 min par étape</span>` })}
    ${panel(
      'Qui choisit quoi',
      kv([
        ['1er ban et côté', html`${team(m.b, { size: 14 })} <span class="faint">moins bien classée (5e)</span>`],
        ['Côté en prolongation', team(m.a, { size: 14 })],
        ['Hôte', html`${team(m.a, { size: 14 })} <span class="faint">mieux classée (2e)</span>`],
        ['Pool', '9 cartes (pool compétitif, saison 3)'],
        ['Suivent le veto', 'les deux équipes, leurs joueurs, le staff'],
        ['Discord', 'chaque choix modifie aussi le message du bot'],
      ]),
    )}
  </div>
  ${done ? '' : html`<p class="faint" style="font-size:11px">${icon('clock', 11)} La page interroge le serveur toutes les 3 secondes et ne change que quand le veto avance.</p>`}`;
  return page({
    title: `Veto ${m.a.tag} – ${m.b.tag}`,
    crumbs: [['Accueil', '/'], ['LFR', '/c/lfr/s3'], ['Semaine 6', '/c/lfr/s3/calendar'], [`${m.a.tag} – ${m.b.tag}`, `/matches/${m.id}`], ['Veto', null]],
    main, league: { comp: 'lfr', season: 's3', tab: 'calendar' }, cols: 'right', viewer: done ? null : official,
  });
}

function vetoBo3(): string {
  const cm = D.featured.cupBo3;
  const a = (cm.a as D.CupSeed).team;
  const b = (cm.b as D.CupSeed).team;
  const m = { a, b };
  const steps: D.VetoStep[] = D.cupVetoQf1.map((s) => ({ seq: s.seq, team: s.team, action: s.action, map: s.map as D.MapName, ...('side' in s ? { side: s.side } : {}), ...('timedOut' in s ? { timedOut: true } : {}), took: 30 + ((s.seq * 37) % 150) }));
  const seqBo3 = steps.map((s) => ({ team: s.team, action: s.action }));
  const games = [1, 2, 3].map((n) => {
    const mapStep = n === 3 ? steps.find((s) => s.action === 'decider') : steps.filter((s) => s.action === 'pick')[n - 1];
    const side = steps.find((s) => s.action === 'side' && (s as { game?: number }).map === mapStep?.map);
    const ot = steps.find((s) => s.action === 'ot_side' && s.map === mapStep?.map);
    return { n, map: mapStep?.map, by: mapStep?.team, side, ot };
  });
  const main = html`
  ${vetoHeader(a, b, 'Coupe de France · Quarts de finale · BO3 · veto', 'mar. 19 janv. · 21:00 CET', pill('done', 'Veto terminé', 'check'))}
  ${panel(
    'Cartes et côtés',
    html`<table class="data"><caption class="vh">Cartes de la série</caption><thead><tr><th scope="col">Carte</th><th scope="col">Choisie par</th><th scope="col">Côté de départ</th><th scope="col" class="opt">Côté en prolongation</th><th scope="col" class="num">Score</th></tr></thead><tbody>
    ${games.map((g) => html`<tr><th scope="row">${mapThumb(g.map ?? '', 34)} ${g.n}. ${g.map}</th><td>${g.by ? team(sideTeam(m as D.Match, g.by), { size: 14 }) : html`<span class="faint">décisive</span>`}</td>
      <td>${g.side?.team ? html`${sideTeam(m as D.Match, g.side.team).tag} en ${g.side.side === 'atk' ? 'attaque' : 'défense'}${g.n === 3 ? html` <span class="faint">(tirage au sort)</span>` : ''}` : ''}</td>
      <td class="opt">${g.ot?.team ? `${sideTeam(m as D.Match, g.ot.team).tag} en ${g.ot.side === 'atk' ? 'attaque' : 'défense'}` : ''}</td>
      <td class="num"><a href="${href(`/matches/${cm.id}${g.n === 1 ? '' : `/games/${g.n}`}`)}">${cm.games[g.n - 1]?.score?.join('–')}</a></td></tr>`)}</tbody></table>`,
  )}
  ${panel('Pool', mapGrid(steps, m, false))}
  ${panel('Séquence BO3 : ban, ban, ban, ban, choix, choix, ban, ban, décisive', stepTable(m, steps, seqBo3, null), { extra: html`<span class="faint">${a.tag} bannit en premier (désignée par le staff)</span>` })}
  <p class="faint" style="font-size:11px">Après chaque choix, l’adversaire de l’équipe qui a choisi prend le côté de départ et l’équipe qui a choisi le côté en prolongation. La décisive a son propre tirage au sort pour le côté.</p>`;
  return page({
    title: `Veto ${a.tag} – ${b.tag} (BO3)`,
    crumbs: [['Accueil', '/'], ['LFR', '/c/lfr/s3'], ['Coupe de France', '/c/lfr/s3/bracket'], [`${a.tag} – ${b.tag}`, `/matches/${cm.id}`], ['Veto', null]],
    main, league: { comp: 'lfr', season: 's3', tab: 'cup' }, cols: 'right',
  });
}

function upload(): string {
  const u = D.upload;
  const m = u.match;
  const up = D.player(u.uploader);
  const lineA = D.starters(m.a);
  const lineB = D.starters(m.b);
  const lobbyRow = (l: (typeof u.lobbies)[number]) => {
    const winners = l.rounds[0] as string[];
    return html`<tr><th scope="row">Lobby ${l.n}</th><td><span style="display:inline-flex;gap:2px">${winners.map((w, i) => html`<span class="rt-cell w" style="width:20px;height:20px;background:${w === 'a' ? '#555b61' : '#245a86'};border-color:transparent" title="Manche ${i + 1} : ${w === 'a' ? m.a.tag : m.b.tag}">${w === 'a' ? m.a.tag.slice(0, 1) : m.b.tag.slice(0, 1)}</span>`)}${l.rounds[1] === 'interrupted' ? html`<span class="rt-cell void" title="Manche interrompue" style="width:20px;height:20px">×</span>` : ''}</span></td><td class="num">${l.scoreA}–${l.scoreB}</td></tr>`;
  };
  const main = html`
  <div class="head"><h1>Envoyer les replays et le MOSS</h1><div class="sub">${m.a.name} 5–7 ${m.b.name} · Ligue 2 · semaine 6 · joué ${m.scheduledAt ? D.when(m.scheduledAt) : ''} · résultat déclaré, en attente de confirmation</div></div>
  ${panel(
    '1 · Dossiers de replays',
    html`<div class="drop">${icon('upload', 16)} Choisissez votre dossier <code>MatchReplay</code> ou glissez-y des dossiers <code>Match-*</code>. L’analyse se fait dans votre navigateur ; rien n’est envoyé avant votre confirmation.</div>
    <table class="data dense"><caption class="vh">Dossiers trouvés</caption><thead><tr><th scope="col"><span class="vh">Inclure</span></th><th scope="col">Dossier</th><th scope="col" class="num">Fichiers</th><th scope="col" class="num">Taille</th><th scope="col">Lobby</th><th scope="col" class="opt">Fenêtre du match</th></tr></thead><tbody>
    ${u.folders.map((f) => html`<tr><td><input type="checkbox" ${f.inWindow ? raw('checked') : ''} aria-label="Inclure ${f.name}"></td><td><code>${f.name}</code></td><td class="num">${f.files}</td><td class="num">${D.dec1(f.size)} Mo</td><td><code>${f.lobby}</code></td><td class="opt">${f.inWindow ? pill('done', 'dans la fenêtre', 'check') : html`${pill('muted', 'hors fenêtre')} <span class="faint">${f.note ?? ''}</span>`}</td></tr>`)}
    </tbody></table>`,
  )}
  ${panel(
    '2 · Ce que les replays contiennent',
    html`${kv([['Carte', html`${mapThumb(u.map, 30)} ${u.map}`], ['Mode', 'Bombe, partie personnalisée'], ['Lobbys', '2 (re-host après la manche 6)'], ['Score reconstitué', html`<b>${m.a.tag} 5–7 ${m.b.tag}</b> ${pill('done', 'égal au score déclaré', 'check')}`]])}
    <table class="data dense"><caption class="vh">Vainqueurs par manche</caption><thead><tr><th scope="col">Lobby</th><th scope="col">Vainqueur de chaque manche</th><th scope="col" class="num">Score</th></tr></thead><tbody>${u.lobbies.map(lobbyRow)}</tbody></table>`,
  )}
  ${panel(
    '3 · Joueurs reconnus',
    html`<div class="lineups">${[[m.a, lineA, 'a'], [m.b, lineB, 'b']].map(
      ([tm, line, s]) => html`<div><div class="lu-h">${team(tm as D.Team, { size: 16 })}<span class="faint" style="margin-left:auto;font-weight:400;font-size:11px">${(line as string[]).length - (s === 'a' ? 1 : 0)}/5 reconnus</span></div><ul class="lu">
        ${(line as string[]).slice(0, s === 'a' ? 4 : 5).map((p) => html`<li><span>${playerLink(p)}</span><span class="role">${icon('check', 11)} profileID connu</span></li>`)}
        ${s === 'a' ? u.unknown.map((x) => html`<li style="background:var(--warn-bg)"><span>${icon('alert', 12)} <code>${x.name}</code></span><span class="role">inconnu · <code>${x.profile}</code></span></li>`) : ''}
      </ul></div>`,
    )}</div>
    <p class="note">${icon('alert', 12)} <code>ShadowFox.LUN</code> n’est sur aucune composition de ce match. Le staff en est averti à l’envoi : jouer avec un joueur non inscrit est une irrégularité. Les équipes restent identifiées : au moins 3 joueurs connus de chaque côté.</p>`,
  )}
  ${panel(
    '4 · Envoi des fichiers bruts',
    html`<table class="data dense"><caption class="vh">Progression</caption><thead><tr><th scope="col">Fichier</th><th scope="col" class="num">Taille</th><th scope="col" style="width:40%">Progression</th><th scope="col">État</th></tr></thead><tbody>
    ${u.files.map((f) => html`<tr><td><code>${f.name}</code></td><td class="num">${D.dec1(f.size)} Mo</td><td><span class="prog ${f.progress < 1 && f.progress > 0 ? 'run' : ''}"><span style="width:${Math.round(f.progress * 100)}%"></span></span></td><td>${f.progress === 1 ? pill('done', 'envoyé', 'check') : f.progress > 0 ? html`<span class="faint">${D.pct(f.progress)}</span>` : html`<span class="faint">en file</span>`}</td></tr>`)}
    </tbody></table>
    <p class="pad faint" style="font-size:11px;margin:0">3 fichiers à la fois, directement vers le stockage. Ne fermez pas l’onglet : les stats s’affichent déjà, le serveur les vérifiera quand les fichiers seront arrivés.</p>`,
    { extra: html`<span class="faint">3/8 · 48,1 Mo sur 85,0</span>` },
  )}
  <div class="grid2">
    ${panel('MOSS', html`<div class="pad">${pill('done', 'reçu', 'check')} <code>moss_MNC_2026-11-26.zip</code> · 2,4 Mo · ${D.time(D.NOW - 9 * 60_000)}<p class="faint" style="font-size:11px;margin-top:6px">${icon('lock', 11)} Visible du staff seulement. Un reçu est posté dans <code>#moss-mnc</code>.</p></div>`)}
    ${panel('Capture du score', html`<div class="pad">${pill('done', 'jointe au résultat', 'check')} <code>score-final.png</code> · 1,1 Mo<p class="faint" style="font-size:11px;margin-top:6px">${icon('lock', 11)} Jamais publique : staff et les deux équipes.</p><a class="btn btn-s" href="#replace">Remplacer</a></div>`)}
  </div>`;
  return page({
    title: 'Envoi des replays',
    crumbs: [['Accueil', '/'], ['LFR', '/c/lfr/s3'], ['Semaine 6', '/c/lfr/s3/calendar'], [`${m.a.tag} – ${m.b.tag}`, `/matches/${m.id}`], ['Replays et MOSS', null]],
    main, league: { comp: 'lfr', season: 's3', tab: 'calendar' }, cols: 'wide',
    viewer: { name: up.tag, role: `Joueur · ${m.b.tag}` },
  });
}

// ---------------------------------------------------------------------------------------------
// Coupe de France

function cup(): string {
  const seedTag = (s: D.CupSeed) => html`<span class="dv">${s.division}·${s.finalRank}</span>`;
  const box = (cm: D.CupMatch) => {
    const row = (s: Side) => {
      const seed = s === 'a' ? cm.a : cm.b;
      const from = s === 'a' ? cm.aFrom : cm.bFrom;
      const win = cm.winner === s;
      const lose = cm.winner !== null && !win;
      const score = cm.series ? cm.series[s === 'a' ? 0 : 1] : cm.status === 'dq' ? (win ? 'V' : 'DQ') : '';
      return html`<div class="bm-r ${win ? 'win' : ''} ${lose ? 'lose' : ''}"><span class="sd">${seed?.seed ?? ''}</span>${seed ? html`<span style="min-width:0;display:flex;align-items:center">${team(seed.team, { size: 14 })}${seedTag(seed)}</span>` : html`<span class="faint" style="font-size:11px">${from ?? 'à déterminer'}</span>`}<span class="s">${score}</span></div>`;
    };
    const foot =
      cm.status === 'dq' ? html`<span>${cm.dq?.reason}</span>`
      : cm.status === 'live' ? html`<span>${pill('live', 'en cours', 'timer')} carte 2 · Bank 3–2</span><span>BO${cm.bestOf}</span>`
      : cm.status === 'done' ? html`<span>${cm.at ? D.dateShort(cm.at) : ''}</span><a href="${href(`/matches/${cm.id}`)}">BO${cm.bestOf} · ${cm.games.map((g) => g.score?.join('–')).join(', ')}</a>`
      : html`<span>${cm.at ? `${D.day(cm.at)} ${D.time(cm.at)}` : ''}${cm.status === 'proposed' ? ' (proposé)' : ''}</span><span>BO${cm.bestOf}</span>`;
    return html`<div class="bm ${cm.status === 'live' ? 'live' : ''} ${cm.status === 'dq' ? 'dq' : ''}">${row('a')}${row('b')}<div class="bm-f">${foot}</div></div>`;
  };
  const cols = D.CUP_ROUNDS.map((r) => {
    const list = D.cupMatches.filter((m) => m.round === r.key).sort((x, y) => x.slot - y.slot);
    return html`<div class="brk-col"><h3>${r.label}</h3><div class="bo">BO${r.bestOf} · ${r.dates}</div><div class="brk-list">${list.map(box)}${r.key === 'prelim' ? html`<p class="faint" style="font-size:11px;margin:0">Exemptées : têtes de série 1 à 13.</p>` : ''}</div></div>`;
  });
  const main = html`
  <div class="head"><h1>Coupe de France · Saison 3</h1><div class="sub">Élimination directe, 19 équipes de Ligue 1 et Ligue 2 · têtes de série par division puis rang final · date fictive de cette page : ${D.when(D.CUP_NOW)}, quarts de finale en cours</div></div>
  <section class="panel"><div class="ph"><h2>Tableau</h2><div class="ph-x"><span class="faint">faites défiler horizontalement</span></div></div>
    <div class="brk" tabindex="0" aria-label="Tableau de la Coupe de France"><div class="brk-cols">${cols}</div></div>
    <ul class="legend"><li><b>L1·3</b> : division et rang final (tête de série à gauche)</li><li><b>DQ</b> : disqualifiée, absente à l’heure du match</li><li>${pill('live', 'en cours')} série en direct</li></ul>
  </section>
  <div class="grid2">
    ${panel(
      'Barrage de montée et de maintien',
      html`<table class="data"><caption class="vh">Barrage</caption><tbody>
        <tr><td>${team(D.barrage.a.team, { size: 16 })} <span class="faint">${D.barrage.a.note}</span></td><td class="num"><b class="neg">${D.barrage.score[0]}</b></td></tr>
        <tr><td>${team(D.barrage.b.team, { size: 16 })} <span class="faint">${D.barrage.b.note}</span></td><td class="num"><b class="pos">${D.barrage.score[1]}</b></td></tr>
      </tbody></table><p class="pad" style="font-size:12px">BO1 sur ${D.barrage.map}, ${D.when(D.barrage.at)}. ${D.barrage.outcome}</p>`,
    )}
    ${panel(
      'Format',
      kv([
        ['Équipes', '19 (exclues de la saison : non qualifiées)'],
        ['Tour préliminaire', 'BO1, têtes de série 14 à 19'],
        ['Huitièmes, quarts', 'BO3'],
        ['Demies, finale', 'BO5'],
        ['Horaires', '7 jours pour s’accorder, sinon dimanche 21:00'],
        ['Absence', 'disqualification ; si les deux, l’adversaire suivant passe'],
        ['Côtés', 'le staff désigne l’équipe qui choisit le côté'],
      ]),
    )}
  </div>`;
  return page({
    title: 'Coupe de France',
    crumbs: [['Accueil', '/'], ['LFR', '/c/lfr/s3'], ['Saison 3', '/c/lfr/s3'], ['Coupe de France', null]],
    main, league: { comp: 'lfr', season: 's3', tab: 'cup' }, cols: 'wide',
  });
}

export const RENDER: Record<string, () => string> = {
  'veto-live.html': () => vetoBo1(false),
  'veto-done.html': () => vetoBo1(true),
  'veto-bo3.html': vetoBo3,
  'upload.html': upload,
  'cup.html': cup,
  ...entity.RENDER,
  ...league.RENDER,
  ...priv.RENDER,
};
export { tabs };
