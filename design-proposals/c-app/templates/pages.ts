// Entry point for the build: every page of _build/pagelist.ts mapped to a renderer.

import * as D from '../../_data/index.ts';
import { html, type Page } from '../../_build/lib.ts';
import { PAGES } from '../../_build/pagelist.ts';
import { doc } from './layout.ts';
import { home, org, lfrHub, lfrlHub, lfvHub } from './p-home.ts';
import { standingsPage, frflStandings, calendar } from './p-standings.ts';
import { playedMatch, forfeitMatch, disputedMatch, upcomingMatch } from './p-match.ts';
import * as M2 from './p-match2.ts';
import * as E from './p-entities.ts';
import * as L from './p-league.ts';

const F = D.featured;

const RENDER: Record<string, () => string> = {
  'home.html': () => home(),
  'standings-ligue-1.html': () => standingsPage('ligue-1'),
  'match-played.html': () => playedMatch(F.played),
  'org.html': org,
  'lfr-s3.html': lfrHub,
  'lfrl-s1.html': lfrlHub,
  'lfv-s2.html': lfvHub,
  'standings-ligue-2.html': () => standingsPage('ligue-2'),
  'standings-ligue-1-de.html': () => standingsPage('ligue-1'),
  'standings-ligue-1-nl.html': () => standingsPage('ligue-1'),
  'standings-frfl.html': frflStandings,
  'calendar.html': () => calendar(),
  'calendar-team.html': () => calendar('greed-esport'),
  'match-upcoming.html': () => upcomingMatch(F.toPlay, 'visitor'),
  'match-upcoming-official.html': () => upcomingMatch(F.toPlay, 'official'),
  'match-proposed.html': () => upcomingMatch(F.proposed, 'proposed'),
  'veto-live.html': () => M2.vetoPage('live'),
  'veto-done.html': () => M2.vetoPage('done'),
  'veto-bo3.html': () => M2.vetoBo3(),
  'match-cup-bo3.html': () => M2.cupMatch(1),
  'match-cup-bo3-g2.html': () => M2.cupMatch(2),
  'match-cup-bo3-g3.html': () => M2.cupMatch(3),
  'match-forfeit.html': () => forfeitMatch(F.forfeit),
  'match-disputed.html': () => disputedMatch(F.disputed),
  'match-overtime.html': () => playedMatch(F.overtime87),
  'match-manual.html': () => playedMatch(F.manual),
  'match-unverified.html': () => playedMatch(F.unverified),
  'upload.html': () => M2.uploadPage(),
  'cup.html': () => M2.cupPage(),
  'club.html': () => E.clubPage('w-mates'),
  'club-greed.html': () => E.clubPage('greed'),
  'team.html': () => E.teamPage('overview'),
  'team-tendances.html': () => E.teamPage('tendances'),
  'team-palmares.html': () => E.teamPage('palmares'),
  'player.html': () => E.playerPage('vexo'),
  'player-noconsent.html': () => E.playerPage('pyro'),
  'leaders.html': L.leadersPage,
  'awards.html': L.awardsPage,
  'rules.html': L.rulesPage,
  'recruitment.html': L.recruitmentPage,
  'workspace.html': L.workspacePage,
  'staff.html': L.staffPage,
};

export function pages(): Page[] {
  return PAGES.map((spec) => ({
    ...spec,
    render: RENDER[spec.file] ?? (() => doc({ title: spec.title, body: html`<div class="page"><p>À venir</p></div>` })),
  }));
}

export function indexPage(list: Page[]): string {
  const groups = [...new Set(list.map((p) => p.group))];
  return html`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proposition C · Application sportive · pages</title>
<link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="styles.css"></head>
<body><main class="page index-page">
<p class="muted sm"><a href="../index.html">Les trois propositions</a></p>
<h1 class="h-page">Proposition C · Application sportive</h1>
<p>Clair, pensé pour le téléphone : listes à filets, points de forme, une même barre d’onglets sur chaque fiche. Données fictives au jeudi 26 novembre 2026, 20:40 CET. <a href="README.md">README</a> · <a href="tokens.css">tokens.css</a> · <a href="styles.css">styles.css</a></p>
${groups.map(
  (g) => html`<h2 class="h-sec">${g}</h2><ul class="list idx">${list
    .filter((p) => p.group === g)
    .map((p) => html`<li><a href="${p.file}"><strong>${p.title}</strong></a><code class="sm">${p.route}</code>${p.note ? html`<span class="muted sm">${p.note}</span>` : ''}</li>`)}</ul>`,
)}
</main></body></html>`.value;
}
