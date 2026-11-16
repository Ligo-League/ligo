// Screenshots every page of a proposal at 1440 and 390 px with Playwright's Chromium.
//
//   node _build/screenshots.ts b-league                 every page, full height
//   node _build/screenshots.ts b-league --anchor        anchor pages only
//   node _build/screenshots.ts b-league --only veto     pages whose file contains "veto"
//   node _build/screenshots.ts b-league --fold          first screen only, into screenshots/_fold
//
// Chromium lives in _tools/browsers (PLAYWRIGHT_BROWSERS_PATH), installed by
//   PLAYWRIGHT_BROWSERS_PATH=_tools/browsers npx playwright install chromium

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(ROOT, '_tools', 'browsers');
const { chromium } = await import('playwright');

const proposal = process.argv[2];
if (!proposal) throw new Error('usage: node _build/screenshots.ts <proposal> [--anchor] [--only text] [--fold]');
const args = process.argv.slice(3);
const anchorOnly = args.includes('--anchor');
const fold = args.includes('--fold');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;

type Entry = { file: string; anchor: boolean };
const pages = (JSON.parse(readFileSync(join(ROOT, proposal, 'pages.json'), 'utf8')) as Entry[]).filter(
  (p) => (!anchorOnly || p.anchor) && (!only || p.file.includes(only)),
);

const outDir = join(ROOT, 'screenshots', fold ? `_fold/${proposal}` : proposal);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const widths = [
  { w: 1440, h: 900 },
  { w: 390, h: 844 },
];
for (const { w, h } of widths) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: 'light', locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  const page = await context.newPage();
  for (const p of pages) {
    await page.goto(pathToFileURL(join(ROOT, proposal, p.file)).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const name = p.file.replace(/\.html$/, '').replace(/\//g, '__');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) console.log(`  ! ${p.file} @${w}: horizontal overflow ${overflow}px`);
    await page.screenshot({ path: join(outDir, `${name}-${w}.png`), fullPage: !fold });
  }
  await context.close();
}
await browser.close();
console.log(`${proposal}: ${pages.length} pages × 2 widths → ${outDir}`);
