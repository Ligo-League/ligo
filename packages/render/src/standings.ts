import { cachedPng, digest } from './cache.ts';
import { renderPng } from './png.ts';
import {
  standingsImage,
  STANDINGS_IMAGE_WIDTH,
  STANDINGS_TEMPLATE_VERSION,
  type StandingsImageInput,
} from './templates/standings.ts';

/** The standings table of one division as a PNG, 1200 px wide. */
export async function renderStandingsPng(input: StandingsImageInput): Promise<Uint8Array> {
  const rows = input.rows.map((row) => ({ ...row, logo: row.logo && digest(row.logo.data) }));
  return cachedPng('standings', STANDINGS_TEMPLATE_VERSION, { ...input, rows }, () =>
    renderPng(standingsImage(input), STANDINGS_IMAGE_WIDTH),
  );
}
