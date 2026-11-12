// One folder per title. No I/O: see "Dependency rules" in CLAUDE.md.

/**
 * The games the platform knows (design doc section 1, "Title").
 * `lol` and `cs` are listed ahead of support: no league, metric schema or parser exists for them yet.
 */
export const TITLES = ['r6', 'valorant', 'rocket_league', 'lol', 'cs'] as const;
export type Title = (typeof TITLES)[number];
