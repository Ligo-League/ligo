// What every title's normaliser makes of one replay file (design doc section 10, "Shared
// output"): an R6 round, later a Rocket League game. The same TypeScript runs in the uploader's
// browser and in the server's worker, so both produce the same unit from the same file.

/** The version of this shape, stored with each unit. */
export const PARSED_UNIT_SCHEMA = 1;

/** The fields every title's unit has. */
export interface ParsedUnitBase<Title extends string, Stats extends string> {
  schema: typeof PARSED_UNIT_SCHEMA;
  title: Title;
  /** The parser build that read the file (its content hash, design doc section 8). */
  parser: string;
  file_sha256: string;
  /** The game lobby the file belongs to: r6-dissect's `matchID` for R6. */
  lobby_id: string;
  unit: { kind: 'round'; number: number };
  /** When the file's unit started, as the replay states it. */
  started_at: string;
  map: string;
  mode: string;
  /** A side won: a round cut short by a re-host has no winner, and stitching voids it. */
  complete: boolean;
  players: ParsedUnitPlayer<Stats>[];
  /** What the normaliser noticed but could still read; shown to staff, never fatal. */
  warnings: UnitWarning[];
}

export interface ParsedUnitPlayer<Stats extends string> {
  /** The game account's ID (Ubisoft profileID for R6), or null when the file hides it. */
  account: string | null;
  /** The in-game name in this file; never an identity. */
  name: string;
  side: 0 | 1;
  /** The title's metric keys (section 9): level-1 stat rows come straight from them. */
  stats: Record<Stats, number>;
}

export interface UnitWarning {
  code: string;
  name?: string;
}
