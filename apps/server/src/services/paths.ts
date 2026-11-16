import { slugify } from '@ligo/core';

// Website addresses that the bot and the pages both build.

/** A season's URL part: its name as a slug, or its ID for a name with no Latin letter. */
export function seasonSlug(row: { id: number; name: string }): string {
  const slug = slugify(row.name);
  return slug.ok ? slug.slug : `season-${String(row.id)}`;
}

/** The season's page: standings, fixtures and latest results. */
export const seasonPath = (competitionSlug: string, row: { id: number; name: string }) =>
  `/c/${competitionSlug}/${seasonSlug(row)}`;
