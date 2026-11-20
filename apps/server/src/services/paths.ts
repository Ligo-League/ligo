import { slugify } from '@ligo/core';
import { TITLES, type Title } from '@ligo/titles';

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
  // Docker's health check on the VPS (design doc section 13).
  'healthz',
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

/** The word for each game in addresses: `/players/vexo/rocket-league`. */
export const TITLE_WORDS: Readonly<Record<Title, string>> = {
  r6: 'r6',
  valorant: 'valorant',
  rocket_league: 'rocket-league',
  lol: 'lol',
  cs: 'cs',
};

/** The game an address word names, or null. */
export const titleOfWord = (word: string): Title | null =>
  TITLES.find((title) => TITLE_WORDS[title] === word) ?? null;

/** A player's page, or one game's tab of it (M-42). */
export const playerPath = (slug: string, title?: Title) =>
  title === undefined ? `/players/${slug}` : `/players/${slug}/${TITLE_WORDS[title]}`;
