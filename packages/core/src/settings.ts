import { z } from 'zod';

// Rule settings a league may change, stored as JSON on the competition, season or stage
// (design doc sections 4 and 5). Every schema is strict and holds only the keys the design doc
// names: a phase that needs a new setting adds it here with its tests.

/** `competition.points_json`: standings points per match outcome. */
export const pointsSchema = z.strictObject({
  outcomes: z.strictObject({ win: z.int(), loss: z.int() }),
  forfeit: z.strictObject({
    winner: z.int(),
    loser: z.int(),
    /** Whether a forfeit shows in the played, won and lost columns of both teams. */
    counts_as_played: z.boolean().default(true),
  }),
});
export type PointsSettings = z.infer<typeof pointsSchema>;

export const TIEBREAK_CRITERIA = [
  'points',
  'diff',
  'h2h_points',
  'h2h_diff',
  'score_for',
  'wins',
  'staff_decision',
] as const;
export type TiebreakCriterion = (typeof TIEBREAK_CRITERIA)[number];

export const UNRESOLVED_TIE_MODES = ['shared', 'tiebreak_match', 'staff_decision'] as const;
export type UnresolvedTieMode = (typeof UNRESOLVED_TIE_MODES)[number];

const hasNoDuplicates = (values: readonly string[]) => new Set(values).size === values.length;

/** `competition.tiebreak_json`: ranking criteria in order, then what to do when they all tie. */
export const tiebreakSchema = z.strictObject({
  criteria: z
    .array(z.enum(TIEBREAK_CRITERIA))
    .min(1)
    .refine(hasNoDuplicates, { error: 'A criterion can appear only once.' }),
  unresolved_tie: z.enum(UNRESOLVED_TIE_MODES),
});
export type TiebreakSettings = z.infer<typeof tiebreakSchema>;

export const RESULT_VALIDATION_MODES = ['staff', 'opponent'] as const;
export type ResultValidationMode = (typeof RESULT_VALIDATION_MODES)[number];

/**
 * How one game (a map) is won, in rounds. Overtime starts when both teams are one round short of
 * `win_at`; see `isPossibleGameScore` for the scores this allows.
 */
export const gameScoreSchema = z.strictObject({
  /** Rounds that win the game in regulation: 7 in R6, 13 in Valorant and CS2. */
  win_at: z.int().min(2),
  /** Rounds in one overtime period: 3 in R6, 2 in Valorant (win by two), 6 in CS2. */
  overtime_rounds: z.int().min(1),
});
export type GameScoreSettings = z.infer<typeof gameScoreSchema>;

/** `competition.ruleset_json`. */
export const rulesetSchema = z.strictObject({
  result_validation: z.enum(RESULT_VALIDATION_MODES),
  /** Null when any score with a winner is acceptable, as with Rocket League goals. */
  game_score: gameScoreSchema.nullable().default(null),
});
export type RulesetSettings = z.infer<typeof rulesetSchema>;

/** `competition.scheduling_json`. */
export const schedulingSchema = z.strictObject({
  rounds_per_week: z.int().min(1),
});
export type SchedulingSettings = z.infer<typeof schedulingSchema>;

/** `season.settings_json`. */
export const seasonSettingsSchema = z.strictObject({
  /** Rounds credited to the winner and to the loser of a forfeit; feeds F, C and D. */
  forfeit_score: z.tuple([z.int().min(0), z.int().min(0)]),
  map_pool: z
    .array(z.string().min(1))
    .refine(hasNoDuplicates, { error: 'A map can appear only once.' }),
});
export type SeasonSettings = z.infer<typeof seasonSettingsSchema>;

/** `stage.config_json`. `seed` is the stored shuffle seed of a round robin. */
export const stageConfigSchema = z.strictObject({
  seed: z.int().optional(),
});
export type StageConfig = z.infer<typeof stageConfigSchema>;
