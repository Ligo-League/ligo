// Proposal A entry point: every page of _build/pagelist.ts, mapped to its renderer.

import * as D from '../../_data/index.ts';
import { html, type Page } from '../../_build/lib.ts';
import { PAGES } from '../../_build/pagelist.ts';
import { page } from './layout.ts';
import { home, org, lfrHub, lfrlHub, lfvHub } from './home.ts';
import { standings, frfl, calendar } from './standings.ts';
import { played, upcoming, forfeit, disputed, cupMatch } from './match.ts';
import * as more from './more.ts';

const F = D.featured;
const V = D.viewers;
const official = { name: V.official.name, role: V.official.role, team: V.official.team };

const RENDER: Record<string, () => string> = {
  'home.html': home,
  'standings-ligue-1.html': () => standings('ligue-1'),
  'match-played.html': () => played(F.played),
  'org.html': org,
  'lfr-s3.html': lfrHub,
  'lfrl-s1.html': lfrlHub,
  'lfv-s2.html': lfvHub,
  'standings-ligue-2.html': () => standings('ligue-2'),
  'standings-ligue-1-de.html': () => standings('ligue-1'),
  'standings-ligue-1-nl.html': () => standings('ligue-1'),
  'standings-frfl.html': frfl,
  'calendar.html': () => calendar(),
  'calendar-team.html': () => calendar('greed-esport'),
  'match-upcoming.html': () => upcoming(F.toPlay),
  'match-upcoming-official.html': () => upcoming(F.toPlay, official),
  'match-proposed.html': () => upcoming(F.proposed),
  'match-cup-bo3.html': () => cupMatch(F.cupBo3, 1),
  'match-cup-bo3-g2.html': () => cupMatch(F.cupBo3, 2),
  'match-cup-bo3-g3.html': () => cupMatch(F.cupBo3, 3),
  'match-forfeit.html': () => forfeit(F.forfeit),
  'match-disputed.html': () => disputed(F.disputed),
  'match-overtime.html': () => played(F.overtime87),
  'match-manual.html': () => played(F.manual),
  'match-unverified.html': () => played(F.unverified),
  ...more.RENDER,
};

export const pages = (): Page[] =>
  PAGES.map((p) => ({
    ...p,
    render: RENDER[p.file] ?? (() => page({ title: p.title, crumbs: [['Accueil', '/'], [p.title, null]], main: html`<div class="head"><h1>${p.title}</h1><p>À venir.</p></div>` })),
  }));

export function indexPage(list: Page[]): string {
  const groups = [...new Set(list.map((p) => p.group))];
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proposition A · Site de référence · pages</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="styles.css"></head>
<body><header class="top"><div class="top-in"><span class="brand">Proposition A · Site de référence</span><div class="top-r"><a class="login" href="../index.html">Les trois propositions</a></div></div></header>
<div class="wrap" style="padding-top:12px"><div class="cols cols-right"><main class="main">
<div class="head"><h1>Toutes les pages et tous les états</h1><div class="sub">Dense, en tables, barres latérales de matchs et de classements. Données fictives au jeudi 26 novembre 2026, 20:40 CET. Captures dans <a href="../screenshots/a-reference/">screenshots/a-reference</a> (1440 et 390 px).</div></div>
${groups
  .map(
    (g) => `<section class="panel"><div class="ph"><h2>${g}</h2></div><table class="data"><tbody>${list
      .filter((p) => p.group === g)
      .map((p) => `<tr><th scope="row"><a href="${p.file}">${p.title}</a></th><td><code>${p.route}</code></td><td class="wrapcell faint">${p.note ?? ''}</td><td><a href="../screenshots/a-reference/${p.file.replace('.html', '')}-1440.png">1440</a> · <a href="../screenshots/a-reference/${p.file.replace('.html', '')}-390.png">390</a></td></tr>`)
      .join('')}</tbody></table></section>`,
  )
  .join('')}
</main><aside class="side-r"><section class="panel"><div class="ph"><h2>Fichiers</h2></div><ul class="wl"><li><a href="README.md">README.md</a></li><li><a href="tokens.css">tokens.css</a></li><li><a href="styles.css">styles.css</a></li><li><a href="templates/pages.ts">templates/</a></li></ul></section></aside></div></div></body></html>`;
}
