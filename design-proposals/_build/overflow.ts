// Lists the elements that stick out of the viewport (horizontal page scroll) or out of their
// panel (a table wider than its box), at one or more widths.
//   node _build/overflow.ts e-merged [file-filter] [--widths=390,1024,1280,1440]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(ROOT, '_tools', 'browsers');
const { chromium } = await import('playwright');
const args = process.argv.slice(2);
const widthsArg = args.find((a) => a.startsWith('--widths='));
const widths = widthsArg ? widthsArg.slice(9).split(',').map(Number) : [390];
const [proposal, only] = args.filter((a) => !a.startsWith('--')) as [string, string | undefined];
const pages = (JSON.parse(readFileSync(join(ROOT, proposal, 'pages.json'), 'utf8')) as { file: string }[]).filter((p) => !only || p.file.includes(only));
const browser = await chromium.launch();
let total = 0;
for (const w of widths) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  for (const p of pages) {
    await page.goto(pathToFileURL(join(ROOT, proposal, p.file)).href);
    const out = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const found: string[] = [];
      // Text can overflow without any element box doing so (a long unbroken word).
      if (document.documentElement.scrollWidth > vw + 1) found.push(`page scrolls: ${document.documentElement.scrollWidth - vw}px`);
      const name = (el: Element) => `${el.tagName.toLowerCase()}.${(typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).join('.')}`;
      const inScroller = (el: Element, stop: Element | null) => {
        for (let a = el.parentElement; a && a !== stop; a = a.parentElement) {
          const s = getComputedStyle(a);
          if (s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflowX === 'hidden') return true;
        }
        return false;
      };
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        // Past the viewport: report the outermost offender only.
        if (r.right > vw + 1) {
          const pr = el.parentElement?.getBoundingClientRect();
          if (!(pr && pr.right > vw + 1) && !inScroller(el, null)) found.push(`page: ${name(el)} → ${Math.round(r.right - vw)}px`);
          continue;
        }
        // Past its panel: tables and other blocks wider than the box they sit in.
        const box = el.parentElement?.closest('.panel, .hx, .vturn');
        if (!box) continue;
        const br = box.getBoundingClientRect();
        if (r.right > br.right + 1 && !inScroller(el, box)) {
          const pr = el.parentElement?.getBoundingClientRect();
          if (!(pr && pr.right > br.right + 1)) found.push(`panel: ${name(el)} in ${name(box)} → ${Math.round(r.right - br.right)}px`);
        }
      }
      return found.slice(0, 6);
    });
    if (out.length) {
      total += out.length;
      console.log(`${w} ${p.file}\n  ${out.join('\n  ')}`);
    }
  }
  await page.close();
}
await browser.close();
console.log(total ? `${total} overflow(s)` : 'no overflow');
