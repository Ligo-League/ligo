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

const digest = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/** The standings table of one division as a PNG, 1200 px wide. */
export async function renderStandingsPng(input: StandingsImageInput): Promise<Uint8Array> {
  // Logos are hashed on their own: as JSON, their bytes would make a huge key to hash.
  const rows = input.rows.map((row) => ({ ...row, logo: row.logo && digest(row.logo.data) }));
  const key = digest(JSON.stringify(['standings', STANDINGS_TEMPLATE_VERSION, { ...input, rows }]));
  const cached = cache.get(key);
  if (cached) return cached;

  const png = await renderPng(standingsImage(input), STANDINGS_IMAGE_WIDTH);
  cache.set(key, png);
  // A Map iterates in insertion order, so its first key is the oldest image.
  const [oldest] = cache.keys();
  if (cache.size > CACHE_SIZE && oldest !== undefined) cache.delete(oldest);
  return png;
}
