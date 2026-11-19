import type { ForfeitThresholds, PointsSettings, TiebreakSettings } from './settings.ts';

// The scoring lock (design doc section 7; M-40, maintainer, 19 November 2026). Standings,
// forfeit counts and exclusions are computed from these settings every time, so changing one
// rewrites the weeks already played. Once a result counts in a season (validated or forfeit),
// they stay as they are, except for the organisation's owner, who gives a reason.

/** The settings a season's standings are computed from, all in `season.settings_json`. */
export interface ScoringSettings {
  points: PointsSettings;
  tiebreak: TiebreakSettings;
  forfeit_score: readonly [number, number];
  exclusion_forfeit_score: readonly [number, number] | null;
  forfeits: ForfeitThresholds;
}

export const SCORING_KEYS = [
  'points',
  'tiebreak',
  'forfeit_score',
  'exclusion_forfeit_score',
  'forfeits',
] as const satisfies readonly (keyof ScoringSettings)[];
export type ScoringKey = (typeof SCORING_KEYS)[number];

/** Equal as data: same values, whatever the order of object keys; array order counts. */
function sameData(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  if (Array.isArray(x) || Array.isArray(y)) {
    return (
      Array.isArray(x) &&
      Array.isArray(y) &&
      x.length === y.length &&
      x.every((value, index) => sameData(value, y[index]))
    );
  }
  if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) return false;
  const xKeys = Object.keys(x);
  const yRecord = y as Record<string, unknown>;
  return (
    xKeys.length === Object.keys(y).length &&
    xKeys.every(
      (key) => Object.hasOwn(y, key) && sameData((x as Record<string, unknown>)[key], yRecord[key]),
    )
  );
}

/** The scoring settings an edit changes, in `SCORING_KEYS` order. */
export function scoringChanges(before: ScoringSettings, after: ScoringSettings): ScoringKey[] {
  return SCORING_KEYS.filter((key) => !sameData(before[key], after[key]));
}

export interface ScoringEdit {
  before: ScoringSettings;
  after: ScoringSettings;
  /** Whether a result already counts in the season: a validated match or a forfeit. */
  resultCounts: boolean;
  /** Whether the editor is the organisation's owner. */
  owner: boolean;
  reason: string | null;
}

export type ScoringEditCheck =
  | { ok: true; changes: ScoringKey[] }
  | { ok: false; error: 'scoring_locked' | 'reason_required'; changes: ScoringKey[] };

/** Whether an edit may change the season's scoring settings now. */
export function checkScoringEdit(edit: ScoringEdit): ScoringEditCheck {
  const changes = scoringChanges(edit.before, edit.after);
  if (changes.length === 0 || !edit.resultCounts) return { ok: true, changes };
  if (!edit.owner) return { ok: false, error: 'scoring_locked', changes };
  if ((edit.reason ?? '').trim() === '') return { ok: false, error: 'reason_required', changes };
  return { ok: true, changes };
}
