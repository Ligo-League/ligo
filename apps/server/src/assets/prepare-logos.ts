import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { extname, join, parse } from 'node:path';
import { LOGO_SIZE, LOGO_NAME } from './store.ts';

// `pnpm assets:logos`: turns the logos the maintainer collected, in any common format and size,
// into the square PNGs the images use. The originals are left as they are. Uses ImageMagick,
// a tool on the maintainer's machine only: the server itself reads the PNGs and nothing else.
// Logos uploaded by teams on the website will be prepared on upload instead (phase 3).

const [source = 'data/assets/logos', target = 'data/assets/render/logos'] = process.argv.slice(2);
const FORMATS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

mkdirSync(target, { recursive: true });
const seen = new Map<string, string>();
let prepared = 0;
for (const file of readdirSync(source).sort()) {
  if (!FORMATS.has(extname(file).toLowerCase())) continue;
  const name = parse(file).name.toLowerCase();
  if (!LOGO_NAME.test(name)) {
    console.warn(`Skipped ${file}: use lowercase letters, digits, _ or - in the name.`);
    continue;
  }
  const earlier = seen.get(name);
  if (earlier) {
    console.warn(`Skipped ${file}: ${earlier} already gives the logo "${name}".`);
    continue;
  }
  seen.set(name, file);
  try {
    // Fit inside the square, centre it on a transparent background, drop metadata.
    execFileSync('magick', [
      join(source, file),
      '-resize',
      `${LOGO_SIZE}x${LOGO_SIZE}`,
      '-background',
      'none',
      '-gravity',
      'center',
      '-extent',
      `${LOGO_SIZE}x${LOGO_SIZE}`,
      '-strip',
      `PNG32:${join(target, `${name}.png`)}`,
    ]);
    prepared += 1;
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    console.error(
      missing
        ? 'ImageMagick ("magick") is not installed: install it, then run this again.'
        : `Could not convert ${file}.`,
    );
    process.exitCode = 1;
    if (missing) break;
  }
}
console.log(`Prepared ${prepared} logos in ${target}.`);
