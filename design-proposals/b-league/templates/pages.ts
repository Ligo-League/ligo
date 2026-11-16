// Proposal B entry point: every page of _build/pagelist.ts mapped to its renderer.

import * as D from '../../_data/index.ts';
import { html, type Page, type Raw } from '../../_build/lib.ts';
import { PAGES } from '../../_build/pagelist.ts';
import { page } from './layout.ts';
import { home, org, hub } from './pages-home.ts';
import { standingsPage, frflStandings, calendar } from './pages-standings.ts';
import { matchPlayed, matchToPlay, matchForfeit, matchDisputed, cupMatch, vetoPage, vetoBo3, upload } from './pages-match.ts';
import * as more from './more.ts';

const F = D.featured;

const RENDER: Record<string, () => Raw> = {
  'home.html': home,
  'standings-ligue-1.html': () => standingsPage('ligue-1'),
  'match-played.html': () => matchPlayed(F.played),
  'org.html': org,
  'lfr-s3.html': () => hub('lfr'),
  'lfrl-s1.html': () => hub('lfrl'),
  'lfv-s2.html': () => hub('lfv'),
  'standings-ligue-2.html': () => standingsPage('ligue-2'),
  'standings-ligue-1-de.html': () => standingsPage('ligue-1'),
  'standings-ligue-1-nl.html': () => standingsPage('ligue-1'),
  'standings-frfl.html': frflStandings,
  'calendar.html': () => calendar(),
  'calendar-team.html': () => calendar('greed-esport'),
  'match-upcoming.html': () => matchToPlay(F.toPlay),
  'match-upcoming-official.html': () => matchToPlay(F.toPlay, D.viewers.official),
  'match-proposed.html': () => matchToPlay(F.proposed),
  'veto-live.html': () => vetoPage('live'),
  'veto-done.html': () => vetoPage('done'),
  'veto-bo3.html': vetoBo3,
  'match-cup-bo3.html': () => cupMatch(1),
  'match-cup-bo3-g2.html': () => cupMatch(2),
  'match-cup-bo3-g3.html': () => cupMatch(3),
  'match-forfeit.html': () => matchForfeit(F.forfeit),
  'match-disputed.html': () => matchDisputed(F.disputed),
  'match-overtime.html': () => matchPlayed(F.overtime87),
  'match-manual.html': () => matchPlayed(F.manual),
  'match-unverified.html': () => matchPlayed(F.unverified),
  'upload.html': upload,
  ...more.RENDER,
};

function todo(title: string): Raw {
  return page({ title, body: html`<div class="wrap"><div class="empty section"><strong>${title}</strong>À venir.</div></div>` });
}

export const pages = (): Page[] =>
  PAGES.map((p) => ({ ...p, render: RENDER[p.file] ?? (() => todo(p.title)) }));

export function indexPage(list: Page[]): string {
  const groups = [...new Set(list.map((p) => p.group))];
  return page({
    title: 'Proposition B · pages',
    body: html`<div class="wrap">
      <header class="page-title"><p class="kicker">Ligo · proposition de design</p><h1>B · Ligue officielle</h1>
      <p>Sombre et neutre, typographie condensée en capitales, couleurs d’équipes en grands aplats, la journée de match au centre. Toutes les pages et tous les états, sur les données fictives du jeudi 26 novembre 2026, 20:40 CET.</p>
      <p style="margin-top:var(--s2)"><a href="README.md">README</a> · <a href="tokens.css">tokens.css</a> · <a href="styles.css">styles.css</a> · <a href="../index.html">Les trois propositions</a></p></header>
      ${groups.map((g) => html`<section class="idx-group"><div class="section-head"><h2>${g}</h2></div><div class="idx">${list.filter((p) => p.group === g).map((p) => html`<a href="${p.file}"><span><b>${p.title}</b>${p.note ? html`<small>${p.note}</small>` : ''}</span><code>${p.route}</code></a>`)}</div></section>`)}
    </div>`,
  }).value;
}
