// Private pages: the team workspace report (section 17) and the staff queue.

import * as D from '../../_data/index.ts';
import { html, href, icon, teamBadge, type Raw } from '../../_build/lib.ts';
import { focusTeam, qStandings, qUpcoming, qResults, qTonight } from './quick.ts';
import { page } from './layout.ts';
import { team, panel, pill, playerLink, kv, tabs, matchHref } from './parts.ts';
import { mapArt, opIcon, photo } from './art.ts';

const MIN = 10;

/** A percentage with its sample, hidden under the minimum, next to the division's average. */
function fig(won: number, n: number, avg?: { won: number; n: number }): Raw {
  const val = n >= MIN ? html`<b>${D.pct(won / n)}</b>` : html`<span class="faint" title="Moins de ${MIN} rounds : pourcentage masqué">masqué</span>`;
  const dv = avg && avg.n >= MIN ? avg.won / avg.n : null;
  const delta = n >= MIN && dv !== null ? won / n - dv : null;
  return html`<span class="fig">${val}<span class="fig-n">${n} r.</span>${dv !== null ? html`<span class="fig-d">div. ${D.pct(dv)}${delta !== null ? html` <span class="${delta >= 0 ? 'pos' : 'neg'}">${delta >= 0 ? '+' : '−'}${Math.round(Math.abs(delta) * 100)}</span>` : ''}</span>` : ''}</span>`;
}

export function workspace(): string {
  const tm = D.team('greed-esport');
  const rep = D.teamReport(tm.slug, 'both');
  const own = rep.own;
  const div = rep.division;
  const dmap = new Map(div.maps.map((x) => [x.map, x]));
  const site = (list: typeof own.defSites, s: string, m: string) => list.find((x) => x.site === s && x.map === m);
  const filters = html`<form class="filters" action="#report"><fieldset><legend class="vh">Filtres du rapport</legend>
    <label class="f">Matchs<select><option>Officiels et entraînements</option><option>Officiels</option><option>Entraînements</option></select></label>
    <label class="f">Du<input type="date" value="2026-10-12"></label><label class="f">Au<input type="date" value="2026-11-26"></label>
    <label class="f">Carte<select><option>Toutes</option>${D.MAP_POOL.map((m) => html`<option>${m}</option>`)}</select></label>
    <label class="f">Adversaire<select><option>Tous</option><option>RPV Esport</option><option>Civitas Esport</option><option>Team Brume (BE)</option></select></label>
    <label class="f">Cinq joueurs<select><option>Tous les rounds</option><option>Kyzo, Vexo, Mazzi, Ikaru, Pyrø</option><option>avec Tchoupi</option></select></label>
    <button class="btn" type="submit">Appliquer</button></fieldset></form>`;
  const main = html`
  <div class="head" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">${teamBadge(tm, { size: 40 })}<div style="flex:1"><h1>Espace équipe · ${tm.name}</h1><div class="sub">${icon('lock', 12)} Privé : l’effectif, les remplaçants, le coach et les responsables. Le staff de la ligue n’y a pas accès.</div></div></div>
  ${tabs([
    { label: 'Rapport', route: `/teams/${tm.slug}/workspace`, active: true },
    { label: 'Entraînements', route: `/teams/${tm.slug}/workspace/matches`, count: rep.practice.length },
    { label: 'Playbook', route: `/teams/${tm.slug}/workspace/playbook` },
  ], 'boxed')}
  ${filters}
  <p class="note info">${own.rounds} rounds analysés : ${rep.officialMaps} cartes officielles avec replays et ${rep.practice.filter((p) => p.source === 'replay').length} cartes d’entraînement. La moyenne de la division vient des seuls matchs officiels de Ligue 1 (${div.rounds} rounds). Un pourcentage sous ${MIN} rounds est masqué.</p>
  ${panel(
    'Cartes',
    html`<div class="tw"><table class="data rep"><caption class="vh">Cartes</caption><thead><tr><th scope="col">Carte</th><th scope="col" class="num">Rounds</th><th scope="col">Rounds gagnés</th><th scope="col">Attaque</th><th scope="col">Défense</th></tr></thead><tbody>
    ${own.maps.map((x) => {
      const d = dmap.get(x.map);
      return html`<tr><th scope="row">${mapArt(x.map, { ratio: 'thumb', label: false })} ${x.map}</th><td class="num">${x.rounds}</td><td>${fig(x.won, x.rounds, d ? { won: d.won, n: d.rounds } : undefined)}</td><td>${fig(x.atk.won, x.atk.n, d?.atk)}</td><td>${fig(x.def.won, x.def.n, d?.def)}</td></tr>`;
    })}</tbody></table></div>`,
    { extra: html`<span class="faint">r. = rounds · div. = moyenne Ligue 1 · écart en points</span>` },
  )}
  <div class="grid2">
    ${panel(
      'Sites en défense',
      html`<table class="data dense rep"><caption class="vh">Sites en défense</caption><thead><tr><th scope="col">Site</th><th scope="col" class="num">Choisi</th><th scope="col">Gagnés</th></tr></thead><tbody>
      ${own.defSites.filter((s) => s.map === 'Lair' || s.map === 'Clubhouse').sort((a, b) => b.n - a.n).map((s) => html`<tr><th scope="row">${s.site} <span class="faint">${s.map}</span></th><td class="num">${s.n}</td><td>${fig(s.won, s.n, site(div.defSites, s.site, s.map))}</td></tr>`)}
      </tbody></table>`,
    )}
    ${panel(
      'Attaque contre chaque site',
      html`<table class="data dense rep"><caption class="vh">Attaque par site</caption><thead><tr><th scope="col">Site</th><th scope="col" class="num">Rounds</th><th scope="col">Gagnés</th></tr></thead><tbody>
      ${own.atkSites.filter((s) => s.map === 'Lair' || s.map === 'Clubhouse').sort((a, b) => b.n - a.n).map((s) => html`<tr><th scope="row">${s.site} <span class="faint">${s.map}</span></th><td class="num">${s.n}</td><td>${fig(s.won, s.n, site(div.atkSites, s.site, s.map))}</td></tr>`)}
      </tbody></table>`,
    )}
  </div>
  <div class="grid3">
    ${panel('Duel d’ouverture', kv([
      ['Ouverture prise', fig(own.opening.ok, own.opening.rounds, { won: div.opening.ok, n: div.opening.rounds })],
      ['Gagnés après l’ouverture', fig(own.opening.okWon, own.opening.ok, { won: div.opening.okWon, n: div.opening.ok })],
      ['Gagnés après la 1re mort', fig(own.opening.odWon, own.opening.od, { won: div.opening.odWon, n: div.opening.od })],
    ]))}
    ${panel('Échanges et clutchs', kv([
      ['Morts échangées', fig(own.trades.traded, own.trades.deaths, { won: div.trades.traded, n: div.trades.deaths })],
      ['Échanges donnés', html`<b>${own.trades.tradeKills}</b>`],
      ['Clutchs gagnés', fig(own.clutch.wins, own.clutch.attempts, { won: div.clutch.wins, n: div.clutch.attempts })],
    ]))}
    ${panel('Désamorceur', kv([
      ['Posé en attaque', fig(own.plants.planted, own.plants.atkRounds, { won: div.plants.planted, n: div.plants.atkRounds })],
      ['Gagnés après pose', fig(own.plants.wonAfterPlant, own.plants.planted, { won: div.plants.wonAfterPlant, n: div.plants.planted })],
      ['Défense après pose adverse', fig(own.plants.defWonAfterPlant, own.plants.defFacedPlant, { won: div.plants.defWonAfterPlant, n: div.plants.defFacedPlant })],
    ]))}
  </div>
  <div class="grid2">
    ${panel(
      'Fins de round',
      html`<table class="data dense"><caption class="vh">Fins de round</caption><thead><tr><th scope="col">Comment</th><th scope="col" class="num">Gagnés</th><th scope="col" class="num">Perdus</th></tr></thead><tbody>
      ${(['elimination', 'defuser', 'time', 'disable'] as const).map((c) => html`<tr><th scope="row">${{ elimination: 'Élimination', defuser: 'Désamorceur', time: 'Temps écoulé', disable: 'Désamorceur coupé' }[c]}</th><td class="num">${own.endings.won[c]}</td><td class="num">${own.endings.lost[c]}</td></tr>`)}
      </tbody></table>`,
    )}
    ${panel(
      'Opérateurs',
      html`<table class="data dense rep"><caption class="vh">Opérateurs</caption><thead><tr><th scope="col">Opérateur</th><th scope="col" class="num">Choisi</th><th scope="col">Rounds gagnés</th></tr></thead><tbody>
      ${own.operators.slice(0, 8).map((o) => html`<tr><th scope="row">${opIcon(o.operator, 18)} ${o.operator} <span class="faint">${o.side === 'atk' ? 'att.' : 'déf.'}</span></th><td class="num">${o.picks}</td><td>${fig(o.won, o.picks)}</td></tr>`)}
      </tbody></table>`,
    )}
  </div>
  ${panel(
    'Joueurs',
    html`<div class="tw"><table class="data"><caption class="vh">Joueurs</caption><thead><tr><th scope="col">Joueur</th><th scope="col" class="num">Rounds</th><th scope="col" class="num">K–D</th><th scope="col" class="num">K/D</th><th scope="col" class="num">KOST</th><th scope="col" class="num opt">Entry</th><th scope="col" class="num opt">Clutchs</th><th scope="col" class="opt">Opérateurs</th></tr></thead><tbody>
    ${rep.players.filter((x) => x.totals.rounds > 0).map((x) => {
      const d = D.derived(x.totals);
      return html`<tr><th scope="row"><span class="rph">${photo(x.player, 24)}</span>${playerLink(x.player)}</th><td class="num">${x.totals.rounds}</td><td class="num">${x.totals.kills}–${x.totals.deaths}</td><td class="num">${D.ratio(d.kd)}</td><td class="num">${D.pct(d.kost)}</td><td class="num opt">${d.entry === null ? '–' : D.signed(d.entry)}</td><td class="num opt">${x.totals.clutchWins}/${x.totals.clutchAttempts}</td><td class="opt"><span class="opl">${Object.entries(x.totals.operators).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([op]) => opIcon(op, 18))}</span></td></tr>`;
    })}</tbody></table></div>
    <p class="pad faint small">Entre coéquipiers, chacun voit les chiffres de tous, y compris ceux de Pyrø ; ses pages publiques restent sans stats tant qu’il n’a pas accepté la politique de confidentialité.</p>`,
  )}`;
  const right = html`${panel(
    'Derniers entraînements',
    html`<ul class="wl">${[...rep.practice].reverse().slice(0, 7).map((g) => html`<li><span class="faint">${D.dateShort(g.date)}</span> ${g.kind === 'scrim' ? 'Scrim' : g.kind === 'friendly' ? 'Amical' : 'Inter-ligues'} · ${g.opponent} <span class="${g.score[0] > g.score[1] ? 'pos' : 'neg'}">${g.score[0]}–${g.score[1]}</span> <span class="faint">${g.map}${g.source === 'manual' ? ' · manuel' : ''}</span></li>`)}</ul>`,
    { extra: html`<a href="#upload">${icon('upload', 12)} Envoyer</a>` },
  )}${panel(
    'Confidentialité',
    html`<p class="pad small">Les entraînements n’apparaissent nulle part ailleurs : ni classement, ni stats publiques, ni leaders, ni récompenses, ni scouting. Un joueur qui quitte l’effectif perd l’accès le jour même ; les données restent à l’équipe.</p>`,
  )}`;
  return page({
    title: `Espace équipe ${tm.name}`,
    crumbs: [['Ligo', '/'], [tm.name, `/teams/${tm.slug}`], ['Espace équipe', null]],
    main,
    game: 'r6',
    cols: 'right',
    right: html`${right}${qStandings(tm.division, { teams: [tm], why: 'votre division' })}${qUpcoming(focusTeam(tm, 'votre équipe'), 6)}`,
    viewer: { name: 'Vexo', role: 'Joueur · Greed Esport', team: 'greed-esport', player: 'vexo' },
  });
}

export function staff(): string {
  const q = D.staffQueue;
  const late = q.requests.filter((r) => r.late).length;
  const main = html`
  <div class="head"><h1>File du staff · LFR</h1><div class="sub">${q.reports.length} résultat à confirmer · ${q.disputes.length} contestation · ${q.requests.length} demandes dont <b class="neg">${late} en retard</b> · ${q.mismatches.length} écart de replay · ${q.unknownPlayers.length} joueur inconnu · ${q.external.length} résultat externe</div></div>
  ${tabs([{ label: 'Tout', route: '/staff', active: true, count: 10 }, { label: 'Résultats', route: '/staff#results', count: 2 }, { label: 'Demandes', route: '/staff#requests', count: q.requests.length }, { label: 'Replays', route: '/staff#replays', count: 2 }, { label: 'Sanctions', route: '/staff#sanctions' }], 'boxed')}
  ${panel(
    'Contestations',
    html`<table class="data"><caption class="vh">Contestations</caption><thead><tr><th scope="col">Match</th><th scope="col">Déclaré</th><th scope="col">Motif (staff uniquement)</th><th scope="col" class="opt">Depuis</th><th scope="col">Action</th></tr></thead><tbody>
    ${q.disputes.map((d) => html`<tr><th scope="row"><a href="${matchHref(d.match)}">${d.match.a.tag}–${d.match.b.tag}</a> <span class="faint">L2 · S${d.match.week}</span></th><td>${d.match.reported?.score.join('–')} par ${d.match.a.tag}</td><td class="wrapcell"><b>${d.reason}</b> · ${d.details} <span class="faint">${d.evidence} pièces</span></td><td class="opt faint">${D.relative(d.raisedAt)}</td><td class="acts"><a class="btn btn-p" href="#validate">Valider</a><a class="btn" href="#reject">Rejeter</a><a class="btn" href="#result">Saisir</a></td></tr>`)}
    </tbody></table><p class="pad faint small">${icon('lock', 11)} Le motif d’une contestation n’est jamais public : il peut mettre en cause un joueur.</p>`,
    { extra: pill('danger', 'à trancher', 'alert') },
  )}
  ${panel(
    'Résultats en attente de confirmation',
    html`<table class="data"><caption class="vh">Résultats déclarés</caption><thead><tr><th scope="col">Match</th><th scope="col">Score</th><th scope="col">Attend</th><th scope="col" class="opt">Déclaré</th><th scope="col">Action</th></tr></thead><tbody>
    ${q.reports.map((r) => html`<tr><th scope="row"><a href="${matchHref(r.match)}">${r.match.a.tag}–${r.match.b.tag}</a> <span class="faint">L2 · S${r.match.week}</span></th><td>${r.score.join('–')}</td><td>${r.waitingFor}</td><td class="opt faint">${D.relative(r.reportedAt)}</td><td class="acts"><a class="btn" href="#validate">Valider sans attendre</a></td></tr>`)}
    </tbody></table><p class="pad faint small">En LFR, la confirmation de l’adversaire valide le résultat (<code>result_validation: opponent</code>) ; rien à faire sauf contestation.</p>`,
  )}
  ${panel(
    'Demandes des équipes',
    html`<table class="data"><caption class="vh">Demandes</caption><thead><tr><th scope="col">Demande</th><th scope="col">Équipe</th><th scope="col" class="opt">Par</th><th scope="col">Échéance</th><th scope="col">Action</th></tr></thead><tbody>
    ${q.requests.map((r) => html`<tr class="${r.late ? 'late' : ''}"><th scope="row">${r.kind} <span class="faint">· ${r.who}</span></th><td>${team(D.team(r.team), { size: 14 })}</td><td class="opt">${r.by}</td><td>${r.late ? pill('danger', `en retard de ${D.relative(r.due).replace('il y a ', '')}`, 'alert') : html`<span class="faint">${D.relative(r.due)}</span>`}</td><td class="acts"><a class="btn btn-p" href="#approve">Accepter</a><a class="btn" href="#refuse">Refuser</a></td></tr>`)}
    </tbody></table><p class="pad faint small">Réponse attendue sous 24 h ; rappel au rôle staff 6 h avant. Rien ne se fait seul à l’échéance.</p>`,
  )}
  <div class="grid2">
    ${panel(
      'Replays : écarts',
      html`<ul class="wl">${q.mismatches.map((x) => html`<li>${pill('danger', 'écart', 'alert')} <a href="${matchHref(x.match)}">${x.match.a.tag}–${x.match.b.tag}</a> · <code>${x.file}</code><br><span class="faint">${x.detail} · envoyé par ${x.uploader}</span></li>`)}</ul>`,
      { extra: html`<a href="#reparse">Re-parser</a>` },
    )}
    ${panel(
      'Joueurs inconnus dans les replays',
      html`<ul class="wl">${q.unknownPlayers.map((x) => html`<li><code>${x.account}</code> <span class="faint">${x.profile}</span> côté ${x.side}<br><a href="${matchHref(x.match)}">${x.match.a.tag}–${x.match.b.tag}</a> <span class="faint">${D.relative(x.at)}</span></li>`)}</ul>`,
    )}
  </div>
  ${panel(
    'Résultats externes à approuver',
    html`<table class="data dense"><caption class="vh">Résultats externes</caption><tbody>${q.external.map((x) => html`<tr><th scope="row">${team(D.team(x.team), { size: 14 })}</th><td>${x.event}</td><td><b>${x.placement}</b> / ${x.teams}</td><td class="faint">${D.relative(x.at)}</td><td class="acts"><label class="f">Tier<select><option>C</option><option>B</option><option>D</option></select></label><a class="btn btn-p" href="#approve">Approuver</a></td></tr>`)}</tbody></table>`,
  )}`;
  return page({
    title: 'File du staff',
    crumbs: [['Ligo', '/'], ['LFR', '/mbl-group/lfr/s3'], ['Staff', null]],
    main,
    league: { comp: 'lfr', season: 's3' },
    game: 'r6',
    cols: 'right',
    right: html`${panel('Aujourd’hui', kv([['Matchs ce soir', '3 (veto en cours : WM–GRDA)'], ['Résultats validés', '4'], ['Forfaits enregistrés', '1 (NTS, 2e : avertissement)'], ['Staff connecté', D.lfrStaff.join(', ')]]))}${panel('Dernières actions (journal)', html`<ul class="wl"><li><span class="faint">20:12</span> Bot · rapport WMS–MNC posté</li><li><span class="faint">19:40</span> Sigma · forfait NTS–RCK enregistré</li><li><span class="faint">18:05</span> Cobalt · demande de Shade lue</li></ul>`)}${qTonight()}${qStandings('ligue-1')}${qStandings('ligue-2')}${qResults()}`,
    viewer: { name: 'Mistral', role: 'Staff LFR', team: null },
  });
}
