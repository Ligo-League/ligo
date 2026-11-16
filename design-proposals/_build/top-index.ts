// Writes design-proposals/index.html: the three proposals with links to their page indexes and
// thumbnails of their anchor pages (first screen at 1440 and 390 px, from screenshots/_thumbs).
//
//   node _build/top-index.ts            (after screenshots exist)
//   node _build/top-index.ts --thumbs   also (re)takes the thumbnails with Playwright

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { html } from './lib.ts';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const PROPOSALS = [
  {
    dir: 'e-merged',
    name: 'E · A et C réunis (après revue)',
    line: 'Le cadre et la densité de A, les composants de C, Ligo comme plateforme ; cartes, opérateurs, rounds et photos.',
    lineage: 'A et C, revue du mainteneur du 16 novembre 2026',
  },
  {
    dir: 'a-reference',
    name: 'A · Site de référence',
    line: 'Dense, tables partout, barres latérales de matchs et de classement ; une seule couleur de ligue sur des gris neutres.',
    lineage: 'HLTV, Liquipedia, VLR.gg, siege.gg',
  },
  {
    dir: 'b-league',
    name: 'B · Ligue officielle',
    line: 'Typographie condensée en capitales, grands aplats aux couleurs des équipes, la journée de match au centre ; sombre.',
    lineage: 'LoL Esports et LEC, BLAST.tv, ligue1.com, les visuels de la LFR',
  },
  {
    dir: 'c-app',
    name: 'C · Application sportive',
    line: 'Clair et pensé pour le mobile : listes à filets, points de forme, une même barre d’onglets sur chaque fiche.',
    lineage: 'Sofascore, FotMob, BBC Sport, L’Équipe, FACEIT',
  },
];

const ANCHORS = [
  { file: 'home.html', label: 'Accueil' },
  { file: 'standings-ligue-1.html', label: 'Classement Ligue 1' },
  { file: 'match-played.html', label: 'Match joué' },
];

if (process.argv.includes('--thumbs')) {
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(ROOT, '_tools', 'browsers');
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  mkdirSync(join(ROOT, 'screenshots', '_thumbs'), { recursive: true });
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    for (const p of PROPOSALS) {
      for (const a of ANCHORS) {
        const file = join(ROOT, p.dir, a.file);
        if (!existsSync(file)) continue;
        await page.goto(pathToFileURL(file).href);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: join(ROOT, 'screenshots', '_thumbs', `${p.dir}-${a.file.replace('.html', '')}-${w}.png`) });
      }
    }
    await page.close();
  }
  await browser.close();
}

const page = html`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ligo · propositions de design</title>
<style>
  :root { --bg: #f3f3f1; --fg: #1b1b1b; --muted: #5e5e5a; --line: #d6d5d0; --link: #1a4fb4; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
  header, main { max-width: 1280px; margin: 0 auto; padding: 0 16px; }
  header { padding-top: 28px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
  h1 { font-size: 22px; margin: 0 0 4px; }
  header p { margin: 0; color: var(--muted); max-width: 70ch; }
  section { padding: 28px 0; border-bottom: 1px solid var(--line); }
  h2 { font-size: 19px; margin: 0; }
  h2 a { color: inherit; }
  .meta { color: var(--muted); margin: 2px 0 14px; }
  .links a { color: var(--link); margin-right: 14px; }
  .thumbs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 14px; }
  figure { margin: 0; }
  figcaption { font-size: 13px; color: var(--muted); margin-bottom: 6px; }
  .pair { display: grid; grid-template-columns: 1fr 96px; gap: 8px; align-items: start; }
  .pair img { width: 100%; height: auto; border: 1px solid var(--line); background: #fff; display: block; }
  a:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
  @media (max-width: 760px) { .thumbs { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>Ligo · propositions de design</h1>
  <p>Maquettes statiques du site public et des principales pages connectées, sur un même jeu de données (LFR Saison 3, maintenant fictif : jeudi 26 novembre 2026, 20:40 CET). Lire la comparaison et la recommandation dans <a href="README.md">README.md</a>.</p>
</header>
<main>
${PROPOSALS.map(
  (p) => html`<section>
  <h2><a href="${p.dir}/index.html">${p.name}</a></h2>
  <p class="meta">${p.line} Lignée : ${p.lineage}.</p>
  <p class="links"><a href="${p.dir}/index.html">Toutes les pages et états</a><a href="${p.dir}/README.md">README</a><a href="${p.dir}/tokens.css">tokens.css</a></p>
  <div class="thumbs">
    ${ANCHORS.map(
      (a) => html`<figure>
      <figcaption>${a.label}</figcaption>
      <a class="pair" href="${p.dir}/${a.file}">
        <img src="screenshots/_thumbs/${p.dir}-${a.file.replace('.html', '')}-1440.png" alt="${p.name}, ${a.label}, 1440 px" loading="lazy">
        <img src="screenshots/_thumbs/${p.dir}-${a.file.replace('.html', '')}-390.png" alt="${p.name}, ${a.label}, 390 px" loading="lazy">
      </a>
    </figure>`,
    )}
  </div>
</section>`,
)}
</main>
</body>
</html>`;

writeFileSync(join(ROOT, 'index.html'), page.value);
console.log('index.html written');
