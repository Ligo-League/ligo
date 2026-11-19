import { slugify } from '@ligo/core';

// Website addresses that the bot and the pages both build. A competition lives under its
// organisation, `/:org/:comp`, since two organisations may pick the same competition slug
// (design doc section 7, maintainer, 16 November 2026).

/**
 * First segments the website's own routes use, today or in the mockups (game homes, recruitment,
 * search): an organisation cannot take one as its slug, since its pages would be hidden behind
 * those routes. Checked when organisations are created (phase 3h).
 */
export const RESERVED_ORG_SLUGS: readonly string[] = [
  'admin',
  'auth',
  'c',
  'clubs',
  'evidence',
  'invite',
  'join',
  'logos',
  'matches',
  // MLB Group's address before its name's typo was fixed: it redirects (migration 0026).
  'mbl-group',
  'me',
  'orgs',
  'players',
  'r6',
  'recruitment',
  'registrations',
  'rocket-league',
  'search',
  'static',
  'staff',
  'teams',
  'valorant',
];

/** A season's URL part: its name as a slug, or its ID for a name with no Latin letter. */
export function seasonSlug(row: { id: number; name: string }): string {
  const slug = slugify(row.name);
  return slug.ok ? slug.slug : `season-${String(row.id)}`;
}

/** A competition's pages: its rulebook, registration and Discord page hang under it. */
export const competitionPath = (orgSlug: string, competitionSlug: string) =>
  `/${orgSlug}/${competitionSlug}`;

/** The season's page: standings, fixtures and latest results. */
export const seasonPath = (
  orgSlug: string,
  competitionSlug: string,
  row: { id: number; name: string },
) => `${competitionPath(orgSlug, competitionSlug)}/${seasonSlug(row)}`;
