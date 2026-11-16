// The practice book (design doc section 17): scrims, friendlies and cross-league matches a team
// records for itself. Private to the team: never in standings, public stats, scouting or images.

import * as D from '../../_data/index.ts';
import { html, href, icon, teamBadge, type Raw } from '../../_build/lib.ts';
import { winConditionLabel } from '../../_build/shared.ts';
import { page } from './layout.ts';
import { team, panel, pill, playerLink, kv, tabs } from './parts.ts';
import { mapArt } from './art.ts';

const TM = () => D.team('greed-esport');
const vexo = { name: 'Vexo', role: 'Joueur · Greed Esport', team: 'greed-esport', player: 'vexo' };
const KIND: Record<D.PracticeGame['kind'], string> = { scrim: 'Scrim', friendly: 'Amical', cross_league: 'Inter-ligue' };

function wsHead(active: 'matches' | 'upload'): Raw {
  const tm = TM();
  return html`<div class="head" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">${teamBadge(tm, { size: 40 })}<div style="flex:1"><h1>Espace équipe · ${tm.name}</h1><div class="sub">${icon('lock', 12)} Privé : l’effectif, les remplaçants, le coach et les responsables. Rien d’ici n’apparaît sur les pages publiques.</div></div></div>
  ${tabs([
    { label: 'Rapport', route: `/teams/${tm.slug}/workspace` },
    { label: 'Entraînements', route: `/teams/${tm.slug}/workspace/matches`, active: active === 'matches', count: D.practiceGames(tm.slug).length },
    { label: 'Envoyer des replays', route: `/teams/${tm.slug}/workspace/upload`, active: active === 'upload' },
    { label: 'Playbook', route: `/teams/${tm.slug}/workspace/playbook` },
  ], 'boxed')}`;
}

const opp = (g: D.PracticeGame) => (g.opponentTeam ? team(D.team(g.opponentTeam), { size: 14 }) : html`<span>${g.opponent}</span> <span class="faint small">hors Ligo</span>`);

export function practiceList(): string {
  const games = D.practiceGames(TM().slug).slice().reverse();
  const w = games.filter((g) => g.score[0] > g.score[1]).length;
  const main = html`
  ${wsHead('matches')}
  <form class="filters" action="#"><label class="f">Type<select><option>Tous</option><option>Scrims</option><option>Amicaux</option><option>Inter-ligue</option></select></label><label class="f">Carte<select><option>Toutes</option>${D.MAP_POOL.map((m) => html`<option>${m}</option>`)}</select></label><label class="f">Adversaire<select><option>Tous</option></select></label><a class="btn btn-p" href="${href(`/teams/${TM().slug}/workspace/upload`)}" style="margin-left:auto">${icon('upload', 12)} Envoyer des replays</a><a class="btn" href="#manual">Saisir à la main</a></form>
  ${panel(
    `Entraînements · ${games.length} cartes`,
    html`<table class="data tagm"><caption class="vh">Entraînements</caption><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Adversaire</th><th scope="col">Carte</th><th scope="col" class="num">Score</th><th scope="col" class="num opt">Rounds</th><th scope="col" class="opt">Source</th></tr></thead><tbody>
    ${games.map((g) => {
      const won = g.score[0] > g.score[1];
      return html`<tr><td class="faint">${D.dateShort(g.date)}</td><td>${KIND[g.kind]}</td><td>${opp(g)}</td><td>${mapArt(g.map, { ratio: 'thumb', label: false })} ${g.map}</td><td class="num"><a href="${href(`/teams/${TM().slug}/workspace/matches/${g.id}`)}" class="${won ? 'pos' : 'neg'}">${won ? 'V' : 'D'} ${g.score[0]}–${g.score[1]}</a></td><td class="num opt">${g.rounds.length}</td><td class="opt">${g.source === 'replay' ? 'replay' : 'saisie manuelle'}</td></tr>`;
    })}</tbody></table>`,
    { extra: html`<span class="faint">${w} V – ${games.length - w} D</span>` },
  )}
  <p class="note info">${icon('lock', 12)} Les entraînements comptent dans le rapport de l’équipe (filtre « Entraînements »), jamais dans le classement, les stats publiques, les leaders, les récompenses ni le scouting des autres équipes.</p>`;
  return page({ title: 'Entraînements', crumbs: [['Ligo', '/'], [TM().name, `/teams/${TM().slug}`], ['Espace équipe', `/teams/${TM().slug}/workspace`], ['Entraînements', null]], main, game: 'r6', cols: 'right', right: quota(), viewer: vexo });
}

function quota(): Raw {
  return panel('Stockage', html`${kv([['Utilisé', '3,1 Mo sur 50 Mo'], ['Cartes', String(D.practiceGames(TM().slug).length)], ['Par round', '6 à 8 Ko de JSON']])}<p class="pad faint small">Seul le JSON des rounds est gardé, pas le fichier de replay.</p>`);
}

export function practiceMatch(): string {
  const g = D.practiceGames(TM().slug).find((x) => x.source === 'replay' && x.opponentTeam) as D.PracticeGame;
  const won = g.score[0] > g.score[1];
  const starters = (D.rosters.get(TM().slug) ?? []).filter((e) => e.role === 'player').map((e) => e.player);
  const STRATS = ['—', 'Rush B', 'Défaut lent', 'Fake A → B', 'Retake', 'Split 3-2'];
  const main = html`
  ${wsHead('matches')}
  <section class="panel rhead">
    <div class="rh-l">${mapArt(g.map, { ratio: 'thumb', label: false })}<div><h2 class="rh-t">${KIND[g.kind]} contre ${g.opponent} · ${g.map}</h2><div class="faint">${D.when(g.date)} · ${g.rounds.length} rounds, tous comptés (pas de règle de victoire en scrim) · ${pill('muted', 'Privé', 'lock')}</div></div></div>
    <div class="rh-r"><span class="rh-w ${won ? 'pos' : 'neg'}" style="font-size:22px;font-weight:700">${g.score[0]}–${g.score[1]}</span><span>${won ? 'gagné' : 'perdu'}</span></div>
  </section>
  ${panel(
    'Rounds et stratégies',
    html`<table class="data dense"><caption class="vh">Rounds</caption><thead><tr><th scope="col" class="num">#</th><th scope="col">Gagné par</th><th scope="col">${TM().tag}</th><th scope="col" class="opt">Site</th><th scope="col" class="opt">Fin</th><th scope="col">Stratégie</th></tr></thead><tbody>
    ${g.rounds.filter((r) => r.kind === 'replay').map((r, i) => html`<tr><td class="num">${i + 1}</td><td>${r.winner === 'a' ? html`<b>${TM().tag}</b>` : g.opponent}</td><td>${r.attacker === 'a' ? 'attaque' : 'défense'}</td><td class="opt">${r.site}</td><td class="opt faint">${r.condition ? winConditionLabel[r.condition] : ''}</td><td><select aria-label="Stratégie du round ${i + 1}">${STRATS.map((s, k) => html`<option ${k === (i * 7) % STRATS.length ? 'selected' : ''}>${s}</option>`)}</select></td></tr>`)}</tbody></table>
    <p class="pad faint small">Une stratégie et une note par round, pour le playbook et le rapport ; visibles par l’équipe seulement.</p>`,
  )}
  ${panel(
    `Joueurs de ${TM().name}`,
    html`<table class="data dense"><caption class="vh">Joueurs</caption><thead><tr><th scope="col">Joueur</th><th scope="col" class="num">K</th><th scope="col" class="num">D</th><th scope="col" class="num">A</th><th scope="col" class="num">K/D</th><th scope="col" class="num">KOST</th></tr></thead><tbody>
    ${starters.map((p) => {
      if (!D.player(p).consent) return html`<tr><th scope="row">${playerLink(p)} <span class="faint small">stats masquées</span></th><td class="num faint">–</td><td class="num faint">–</td><td class="num faint">–</td><td class="num faint">–</td><td class="num faint">–</td></tr>`;
      const t = D.addRounds(D.emptyTotals(), g.rounds, p, true);
      const d = D.derived(t);
      return html`<tr><th scope="row">${playerLink(p)}</th><td class="num">${t.kills}</td><td class="num">${t.deaths}</td><td class="num">${t.assists}</td><td class="num">${D.ratio(d.kd)}</td><td class="num">${D.pct(d.kost)}</td></tr>`;
    })}</tbody></table>
    <p class="pad faint small">Les joueurs adverses restent anonymes hors de ce match : leurs comptes ne sont liés à aucun profil public.</p>`,
  )}`;
  return page({ title: `Entraînement · ${g.opponent}`, crumbs: [['Ligo', '/'], [TM().name, `/teams/${TM().slug}`], ['Entraînements', `/teams/${TM().slug}/workspace/matches`], [`${g.opponent} · ${g.map}`, null]], main, game: 'r6', cols: 'right', right: html`${panel('Ce match', kv([['Type', KIND[g.kind]], ['Adversaire', opp(g)], ['Source', 'replay de Vexo'], ['Compte dans', 'le rapport de l’équipe seulement']]))}${quota()}`, viewer: vexo });
}

export function practiceUpload(): string {
  const rows: [string, string, string, Raw][] = [
    ['Match-2026-11-25_21-02', 'Clubhouse', 'RPV Esport (3 comptes reconnus)', pill('done', 'Analysé', 'check')],
    ['Match-2026-11-25_21-48', 'Clubhouse', 'RPV Esport · même lobby, suite', pill('done', 'Analysé', 'check')],
    ['Match-2026-11-25_22-30', 'Border', 'RPV Esport', pill('info', 'Analyse… 64 %')],
    ['Match-2026-11-24_20-15', 'Chalet', 'adversaire hors Ligo (aucun compte reconnu)', pill('warn', 'Adversaire à nommer')],
  ];
  const main = html`
  ${wsHead('upload')}
  <section class="panel"><div class="drop">${icon('upload', 20)}<p><b>Déposez le dossier de replays</b> (MatchReplay) ou choisissez-le. L’analyse se fait dans votre navigateur ; le serveur refait l’analyse avant d’enregistrer.</p><a class="btn btn-p" href="#pick">Choisir un dossier</a></div></section>
  ${panel(
    'Fichiers détectés',
    html`<table class="data dense"><caption class="vh">Fichiers</caption><thead><tr><th scope="col">Enregistrement</th><th scope="col">Carte</th><th scope="col">Adversaire</th><th scope="col">État</th></tr></thead><tbody>
    ${rows.map(([f, m, o, st]) => html`<tr><td><code>${f}</code></td><td>${m}</td><td class="wrapcell">${o}</td><td>${st}</td></tr>`)}</tbody></table>
    <p class="pad faint small">Les lobbys contre un même adversaire le même jour forment un seul entraînement ; vous pouvez les séparer ou les fusionner ensuite. Votre équipe est reconnue par au moins 3 comptes de l’effectif.</p>`,
  )}
  ${panel('Classer', html`<form class="filters" action="#save"><label class="f">Type<select><option>Scrim</option><option>Amical</option><option>Inter-ligue</option></select></label><label class="f">Adversaire<select><option>RPV Esport</option><option>Autre (nom libre)</option></select></label><button class="btn btn-p" type="submit">Enregistrer 2 cartes</button></form>`)}`;
  return page({ title: 'Envoyer des replays d’entraînement', crumbs: [['Ligo', '/'], [TM().name, `/teams/${TM().slug}`], ['Espace équipe', `/teams/${TM().slug}/workspace`], ['Envoi', null]], main, game: 'r6', cols: 'right', right: quota(), viewer: vexo });
}
