import { createHash } from 'node:crypto';
import { renderPng } from './png.ts';
import {
  standingsImage,
  STANDINGS_IMAGE_WIDTH,
  STANDINGS_TEMPLATE_VERSION,
  type StandingsImageInput,
} from './templates/standings.ts';

// Rendering takes a few hundred milliseconds and the same table is asked for many times between
// two results. Images are kept in memory by a hash of their input; a stored cache comes later.
const CACHE_SIZE = 32;
const cache = new Map<string, Uint8Array>();

/** The standings table of one division as a PNG, 1200 px wide. */
export async function renderStandingsPng(input: StandingsImageInput): Promise<Uint8Array> {
  const key = createHash('sha256')
    .update(JSON.stringify(['standings', STANDINGS_TEMPLATE_VERSION, input]))
    .digest('hex');
  const cached = cache.get(key);
  if (cached) return cached;

  const png = await renderPng(standingsImage(input), STANDINGS_IMAGE_WIDTH);
  cache.set(key, png);
  // A Map iterates in insertion order, so its first key is the oldest image.
  const [oldest] = cache.keys();
  if (cache.size > CACHE_SIZE && oldest !== undefined) cache.delete(oldest);
  return png;
}
