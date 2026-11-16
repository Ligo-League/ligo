// Proposal E entry point: A's frame and density with C's components, on Ligo's platform routes
// (/:org/:comp/:season, design doc section 7, 16 November 2026). Its own page list: the pages
// that test the merge first; the rest follows once these are reviewed.

import * as D from '../../_data/index.ts';
import type { Page } from '../../_build/lib.ts';
import { ligoHome, r6Home } from './platform.ts';
import { org, lfrHub } from './home.ts';
import { standings, calendar, frfl } from './standings.ts';
import { lfrlHub, lfvHub } from './home.ts';
import { cupMatch, forfeit, disputed } from './match.ts';
import * as more from './more.ts';
import { PAGES } from '../../_build/pagelist.ts';
import { playedResume, playedScoreboard, playedRounds, roundPage, upcomingPage, vetoPage } from './matchpage.ts';
import { RENDER as ENTITY } from './entity.ts';
import { workspace, staff } from './private.ts';
import { playerTitlePage, rlSeriesPage, mePage } from './games.ts';
import { practiceList, practiceMatch, practiceUpload } from './practice.ts';

const F = D.featured;
const P = F.played.id;
const U = F.toPlay.id;
const ROUND = 9;
const vexo = { name: 'Vexo', role: 'Joueur · Greed Esport', team: 'greed-esport', player: 'vexo' };

type Spec = Omit<Page, 'render'> & { render: () => string };

const LIST: Spec[] = [
  { file: 'home.html', route: '/', title: 'Accueil Ligo', group: 'Ancres', note: 'Ligo, pas MBL : onglets par jeu, matchs du jour, compétitions de 3 organisations', anchor: true, render: () => ligoHome(null) },
  { file: 'standings-ligue-1.html', route: '/mbl-group/lfr/s3/standings/ligue-1', title: 'Classement Ligue 1', group: 'Ancres', note: 'Rang partagé, exclues, sanction, zones', anchor: true, render: () => standings('ligue-1') },
  { file: 'match-played.html', route: `/matches/${P}`, title: 'Match joué : Résumé', group: 'Ancres', note: 'Ordre de A : en-tête et faits, veto et données, tableau, round par round ; accès rapide à droite', anchor: true, render: () => playedResume(F.played) },

  { file: 'home-in.html', route: '/?as=vexo', title: 'Accueil connecté (Vexo)', group: 'Plateforme', note: 'Mes équipes et mes matchs en tête', render: () => ligoHome(vexo) },
  { file: 'r6.html', route: '/r6', title: 'Accueil Rainbow Six Siege', group: 'Plateforme', note: 'Compétitions R6 de toutes les organisations, matchs du jour, recrutement', render: r6Home },
  { file: 'org.html', route: '/mbl-group', title: 'Organisation MBL Group', group: 'Plateforme', render: org },

  { file: 'lfr-s3.html', route: '/mbl-group/lfr/s3', title: 'LFR Saison 3', group: 'Ligue', render: lfrHub },
  { file: 'calendar.html', route: '/mbl-group/lfr/s3/calendar', title: 'Calendrier', group: 'Ligue', render: () => calendar() },

  { file: 'match-upcoming.html', route: `/matches/${U}`, title: 'Match à jouer : Aperçu', group: 'Matchs', note: 'Veto en direct, compositions et données, avant-match', render: () => upcomingPage(F.toPlay) },
  { file: 'veto-live.html', route: `/matches/${U}/veto`, title: 'Veto en cours', group: 'Matchs', note: 'Cartes en images, au tour de GREED Academy, minuteur', render: () => vetoPage(F.toPlay, false) },
  { file: 'veto-done.html', route: `/matches/${U}/veto?state=done`, title: 'Veto terminé', group: 'Matchs', note: 'Carte jouée, côtés, ban expiré', render: () => vetoPage(F.toPlay, true) },
  { file: 'match-played-scoreboard.html', route: `/matches/${P}/scoreboard`, title: 'Match joué : Tableau', group: 'Matchs', note: 'Scores et opérateurs joués, échanges', render: () => playedScoreboard(F.played) },
  { file: 'match-played-rounds.html', route: `/matches/${P}/rounds`, title: 'Match joué : Rounds', group: 'Matchs', note: 'Chaque round : vainqueur, fin, site, opérateurs, MVP', render: () => playedRounds(F.played) },
  { file: 'round.html', route: `/matches/${P}/rounds/${ROUND}`, title: `Round ${ROUND}`, group: 'Matchs', note: 'Kill feed dans l’ordre, opérateurs et échanges, MVP', render: () => roundPage(F.played, ROUND) },

  { file: 'team.html', route: '/teams/greed-esport', title: 'Équipe Greed Esport', group: 'Équipes et joueurs', note: 'Photos dans l’effectif ; accès rapide centré sur la division de l’équipe', render: ENTITY['team.html'] as () => string },
  { file: 'player.html', route: '/players/vexo', title: 'Joueur Vexo', group: 'Équipes et joueurs', note: 'Photo, opérateurs habituels, cartes', render: ENTITY['player.html'] as () => string },
  { file: 'player-noconsent.html', route: '/players/pyro', title: 'Joueur sans politique acceptée', group: 'Équipes et joueurs', note: 'Image par défaut, stats masquées', render: ENTITY['player-noconsent.html'] as () => string },

  { file: 'player-valorant.html', route: '/players/vexo/valorant', title: 'Joueur Vexo : onglet Valorant', group: 'Plusieurs jeux', note: 'Même personne, autre jeu et autre club ; page tirée du schéma de stats de Valorant', render: () => playerTitlePage('vexo', 'valorant') },
  { file: 'player-rl.html', route: '/players/turbine', title: 'Joueur Rocket League (Turbine)', group: 'Plusieurs jeux', note: 'Buts et passes ; pas de carte, de côté ni de personnage', render: () => playerTitlePage('turbine', 'rocket_league') },
  { file: 'match-rl.html', route: `/matches/${D.featuredRl.id}`, title: 'Série Rocket League (BO5)', group: 'Plusieurs jeux', note: 'Pas de veto ni de cartes ; un match saisi à la main (console)', render: () => rlSeriesPage(D.featuredRl) },
  { file: 'me.html', route: '/me', title: 'Mon profil (/me)', group: 'Plusieurs jeux', note: 'Un compte par jeu, un rang par file classée, le rang affiché au choix', render: mePage },

  { file: 'practice.html', route: '/teams/greed-esport/workspace/matches', title: 'Entraînements (practice book)', group: 'Pages privées', note: 'Scrims, amicaux, inter-ligue ; privé', render: practiceList },
  { file: 'practice-match.html', route: '/teams/greed-esport/workspace/matches/practice', title: 'Un entraînement', group: 'Pages privées', note: 'Rounds avec stratégie, joueurs de l’équipe, adversaires anonymes', render: practiceMatch },
  { file: 'practice-upload.html', route: '/teams/greed-esport/workspace/upload', title: 'Envoi de replays d’entraînement', group: 'Pages privées', note: 'Regroupement par adversaire et par jour, quota', render: practiceUpload },
  { file: 'workspace.html', route: '/teams/greed-esport/workspace', title: 'Espace équipe : rapport', group: 'Pages privées', note: 'Connecté : Vexo', render: workspace },
  { file: 'staff.html', route: '/staff', title: 'File du staff', group: 'Pages privées', note: 'Connecté : Mistral', render: staff },
];

// The rest of the shared list (_build/pagelist.ts): reference pages, built from the templates E
// inherited from A, in E's frame. They exist to be looked at, not polished yet.
const official = { name: D.viewers.official.name, role: D.viewers.official.role, team: D.viewers.official.team };
const REST: Record<string, () => string> = {
  'lfrl-s1.html': lfrlHub,
  'lfv-s2.html': lfvHub,
  'standings-ligue-2.html': () => standings('ligue-2'),
  'standings-ligue-1-de.html': () => standings('ligue-1'),
  'standings-ligue-1-nl.html': () => standings('ligue-1'),
  'standings-frfl.html': frfl,
  'calendar-team.html': () => calendar('greed-esport'),
  'match-upcoming-official.html': () => upcomingPage(F.toPlay, official),
  'match-proposed.html': () => upcomingPage(F.proposed),
  'veto-bo3.html': more.RENDER['veto-bo3.html'] as () => string,
  'match-cup-bo3.html': () => cupMatch(F.cupBo3, 1),
  'match-cup-bo3-g2.html': () => cupMatch(F.cupBo3, 2),
  'match-cup-bo3-g3.html': () => cupMatch(F.cupBo3, 3),
  'match-forfeit.html': () => forfeit(F.forfeit),
  'match-disputed.html': () => disputed(F.disputed),
  'match-overtime.html': () => playedResume(F.overtime87),
  'match-manual.html': () => playedResume(F.manual),
  'match-unverified.html': () => playedResume(F.unverified),
  'upload.html': more.RENDER['upload.html'] as () => string,
  'cup.html': more.RENDER['cup.html'] as () => string,
  'club.html': ENTITY['club.html'] as () => string,
  'club-greed.html': ENTITY['club-greed.html'] as () => string,
  'team-tendances.html': ENTITY['team-tendances.html'] as () => string,
  'team-palmares.html': ENTITY['team-palmares.html'] as () => string,
  'leaders.html': more.RENDER['leaders.html'] as () => string,
  'awards.html': more.RENDER['awards.html'] as () => string,
  'rules.html': more.RENDER['rules.html'] as () => string,
  'recruitment.html': more.RENDER['recruitment.html'] as () => string,
};

/** A route of the shared list in E's platform form (/:org/:comp/...). */
const eRoute = (r: string) =>
  r === '/c/lfr/recruitment' ? '/recruitment?comp=lfr' : r.replace(/^\/o\/mbl-group/, '/mbl-group').replace(/^\/c\/([a-z0-9-]+)/, '/mbl-group/$1');

const GROUP: Record<string, string> = {
  'Groupe et compétitions': 'Ligue', 'Classement et calendrier': 'Ligue', Coupe: 'Ligue', 'Pages de ligue': 'Ligue',
  Matchs: 'Matchs', 'Clubs, équipes, joueurs': 'Équipes et joueurs', 'Pages privées': 'Pages privées',
};

const extra: Spec[] = PAGES.filter((x) => !LIST.some((l) => l.file === x.file)).map((x) => {
  const render = REST[x.file];
  if (!render) throw new Error(`no renderer for ${x.file}`);
  return { ...x, route: eRoute(x.route), group: x.file === 'recruitment.html' ? 'Plateforme' : (GROUP[x.group] ?? x.group), render };
});

/** E's pages first in each group, then the reference pages. */
const ALL: Spec[] = (() => {
  const groups = [...new Set([...LIST, ...extra].map((x) => x.group))];
  return groups.flatMap((g) => [...LIST.filter((x) => x.group === g), ...extra.filter((x) => x.group === g)]);
})();

export const pages = (): Page[] => ALL;

/** Old and other routes land on the nearest page E builds. */
const esc = (r: string) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const fallbacks: [RegExp, string][] = [
  // The old /c/... routes of the shared list, exactly, onto their E page.
  ...PAGES.map((x): [RegExp, string] => [new RegExp(`^${esc(x.route)}$`), (ALL.find((a) => a.file === x.file) as Spec).route]),
  [/^\/c\/lfr\/recruitment/, '/recruitment?comp=lfr'],
  [/^\/players\/vexo\/r6/, '/players/vexo'],
  [/^\/players\/turbine/, '/players/turbine'],
  [/^\/players\/(kaz|orbite|gaufre|mosa|lio|zenith|pako|rivet|flux|nebula|grizz|boulon|sprint|celeste|moka|vortex|pepite|axel|brindille|kami|tornade|nougat|echo)/, '/players/turbine'],
  [/^\/teams\/greed-esport\/workspace\/matches\/\d+/, '/teams/greed-esport/workspace/matches/practice'],
  [/^\/matches\/81\d\d/, `/matches/${D.featuredRl.id}`],
  [/^\/me$/, '/me'],
  // Pages not drawn: the nearest one that is.
  [/^\/matches$/, '/'],
  [/^\/matches\/\d+\/lineups/, `/matches/${U}`],
  [/^\/matches\/\d+\/upload/, `/matches/${F.reported.id}/upload`],
  [/^\/teams\/[^/]+\/tendances/, '/teams/greed-esport/tendances'],
  [/^\/teams\/[^/]+\/palmares/, '/teams/greed-esport/palmares'],
  [/^\/mbl-group\/lfrl/, '/mbl-group/lfrl/s1'],
  [/^\/mbl-group\/lfv/, '/mbl-group/lfv/s2'],
  [/^\/mbl-group\/frfl/, '/mbl-group/frfl/s1/standings'],
  [/^\/mbl-group\/lfr\/s3\/leaders/, '/mbl-group/lfr/s3/leaders'],
  [/^\/recruitment/, '/recruitment?comp=lfr'],
  [/^\/c\/lfr\/s3$/, '/mbl-group/lfr/s3'],
  [/^\/c\/lfr\/s3\/standings/, '/mbl-group/lfr/s3/standings/ligue-1'],
  [/^\/mbl-group\/lfr\/s3\/standings/, '/mbl-group/lfr/s3/standings/ligue-1'],
  [/^\/c\/lfr\/s3\/calendar/, '/mbl-group/lfr/s3/calendar'],
  [/^\/mbl-group\/lfr\/s3\/calendar/, '/mbl-group/lfr/s3/calendar'],
  [/^\/o\/mbl-group/, '/mbl-group'],
  [/^\/matches\/\d+\/veto\?state=done/, `/matches/${U}/veto?state=done`],
  [/^\/matches\/\d+\/scoreboard/, `/matches/${P}/scoreboard`],
  [/^\/matches\/\d+\/rounds\/\d+/, `/matches/${P}/rounds/${ROUND}`],
  [/^\/matches\/\d+\/rounds/, `/matches/${P}/rounds`],
  [/^\/rocket-league|^\/valorant/, '/r6'],
];

export function indexPage(list: Page[]): string {
  const groups = [...new Set(list.map((p) => p.group))];
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proposition E · A et C réunis · pages</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="styles.css"></head>
<body><header class="top"><div class="top-in"><span class="brand">Proposition E · A et C réunis</span><div class="top-r"><a class="login" href="../index.html">Toutes les propositions</a></div></div></header>
<div class="wrap" style="padding-top:12px"><div class="cols cols-right"><main class="main">
<div class="head"><h1>Pages et états</h1><div class="sub">Le cadre et la densité de A, les composants de C, Ligo comme plateforme. Données fictives au jeudi 26 novembre 2026, 20:40 CET. Captures dans <a href="../screenshots/e-merged/">screenshots/e-merged</a> (1440 et 390 px).</div></div>
${groups
  .map(
    (g) => `<section class="panel"><div class="ph"><h2>${g}</h2></div><table class="data"><tbody>${list
      .filter((p) => p.group === g)
      .map((p) => `<tr><th scope="row"><a href="${p.file}">${p.title}</a></th><td><code>${p.route}</code></td><td class="wrapcell faint">${p.note ?? ''}</td><td><a href="../screenshots/e-merged/${p.file.replace('.html', '')}-1440.png">1440</a> · <a href="../screenshots/e-merged/${p.file.replace('.html', '')}-390.png">390</a></td></tr>`)
      .join('')}</tbody></table></section>`,
  )
  .join('')}
</main><aside class="side-r"><section class="panel"><div class="ph"><h2>Fichiers</h2></div><ul class="wl"><li><a href="README.md">README.md</a></li><li><a href="tokens.css">tokens.css</a></li><li><a href="styles.css">styles.css</a></li><li><a href="templates/pages.ts">templates/</a></li></ul></section></aside></div></div></body></html>`;
}
