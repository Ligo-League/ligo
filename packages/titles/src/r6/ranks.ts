// R6 Siege ranked tiers, lowest first, as a player declares theirs on their profile (maintainer,
// 14 November 2026: players keep it up to date themselves; Ligo looks nothing up). Divisions
// inside a tier (Gold III, Gold II…) are left out: the tier is what a league reads.
export const R6_RANKS = [
  'unranked',
  'copper',
  'bronze',
  'silver',
  'gold',
  'platinum',
  'emerald',
  'diamond',
  'champion',
] as const;
export type R6Rank = (typeof R6_RANKS)[number];
