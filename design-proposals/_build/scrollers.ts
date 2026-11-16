// Lists the boxes that scroll sideways inside a page (overflow-x: auto with content wider than
// the box), so a table that hides columns behind a scroll shows up in review.
//   node _build/scrollers.ts e-merged [--widths=390,1440]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(ROOT, '_tools', 'browsers');
const { chromium } = await import('playwright');
const args = process.argv.slice(2);
const widthsArg = args.find((a) => a.startsWith('--widths='));
const widths = widthsArg ? widthsArg.slice(9).split(',').map(Number) : [390, 1440];
const [proposal] = args.filter((a) => !a.startsWith('--')) as [string];
const pages = JSON.parse(readFileSync(join(ROOT, proposal, 'pages.json'), 'utf8')) as { file: string }[];
const browser = await chromium.launch();
for (const w of widths) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  for (const p of pages) {
    await page.goto(pathToFileURL(join(ROOT, proposal, p.file)).href);
    const out = await page.evaluate(() =>
      Array.from(document.querySelectorAll('body *'))
        .filter((el) => {
          const s = getComputedStyle(el);
          return (s.overflowX === 'auto' || s.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0;
        })
        .map((el) => `${el.tagName.toLowerCase()}.${(typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).join('.')} ${el.clientWidth}/${el.scrollWidth}px`),
    );
    if (out.length) console.log(`${w} ${p.file}\n  ${out.join('\n  ')}`);
  }
  await page.close();
}
await browser.close();
