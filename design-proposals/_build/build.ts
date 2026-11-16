// Renders each proposal's templates with the shared data into static HTML.
//
//   node _build/build.ts            all proposals
//   node _build/build.ts b-league   one proposal
//
// A proposal is a folder with templates/pages.ts exporting:
//   pages(): Page[]                         every page and state
//   indexPage?(pages: Page[]): string       its own index (a generic one otherwise)
//   fallbacks?: [RegExp, string][]          extra link fallbacks

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setCurrentFile, setRoutes, html, type Page } from './lib.ts';
import { setLang } from './i18n.ts';
import { defaultFallbacks } from './shared.ts';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const PROPOSALS = ['a-reference', 'b-league', 'c-app'] as const;

function genericIndex(name: string, pages: Page[]): string {
  const groups = [...new Set(pages.map((p) => p.group))];
  return html`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name} · pages</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px;max-width:900px}h2{margin-top:28px;font-size:15px;text-transform:uppercase;letter-spacing:.06em}li{margin:4px 0}code{color:#555}</style></head>
<body><h1>${name}</h1>${groups.map(
    (g) => html`<h2>${g}</h2><ul>${pages.filter((p) => p.group === g).map((p) => html`<li><a href="${p.file}">${p.title}</a> <code>${p.route}</code> ${p.note ?? ''}</li>`)}</ul>`,
  )}</body></html>`.value;
}

export async function buildProposal(name: string) {
  const dir = join(ROOT, name);
  const entry = join(dir, 'templates', 'pages.ts');
  if (!existsSync(entry)) {
    console.log(`${name}: no templates/pages.ts yet, skipped`);
    return;
  }
  const mod = (await import(pathToFileURL(entry).href)) as {
    pages: () => Page[];
    indexPage?: (pages: Page[]) => string;
    fallbacks?: [RegExp, string][];
  };
  const pages = mod.pages();
  setRoutes(pages, [...(mod.fallbacks ?? []), ...defaultFallbacks()]);
  for (const page of pages) {
    setCurrentFile(page.file);
    setLang(page.lang ?? 'fr');
    const out = join(dir, page.file);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, String(page.render()));
  }
  setLang('fr');
  setCurrentFile('index.html');
  writeFileSync(join(dir, 'index.html'), mod.indexPage ? mod.indexPage(pages) : genericIndex(name, pages));
  writeFileSync(
    join(dir, 'pages.json'),
    JSON.stringify(pages.map((p) => ({ file: p.file, route: p.route, title: p.title, group: p.group, note: p.note ?? null, anchor: !!p.anchor })), null, 1),
  );
  console.log(`${name}: ${pages.length} pages`);
}

const arg = process.argv[2];
const list = arg ? [arg] : [...PROPOSALS];
for (const p of list) await buildProposal(p);
