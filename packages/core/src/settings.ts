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

/** The key of the reason every dispute form offers last, with details required. */
export const OTHER_DISPUTE_REASON = 'other';

/** A reason a team can give when it disputes a reported result. */
export const disputeReasonSchema = z.strictObject({
  /** Stored with the dispute, so a label can be reworded without losing the history. */
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,31}$/)
    .refine((key) => key !== OTHER_DISPUTE_REASON, { error: '"other" is always offered.' }),
  // Discord shows at most 100 characters per entry of a list.
  label: z.strictObject({
    fr: z.string().min(1).max(100),
    en: z.string().min(1).max(100).optional(),
  }),
});
export type DisputeReason = z.infer<typeof disputeReasonSchema>;

/** The reasons offered until a league sets its own; agreed with the maintainer, 13 Nov 2026. */
export const DEFAULT_DISPUTE_REASONS: readonly DisputeReason[] = [
  { key: 'wrong_score', label: { fr: 'Score incorrect', en: 'Wrong score' } },
  {
    key: 'screenshot',
    label: { fr: 'Capture manquante ou illisible', en: 'Screenshot missing or unreadable' },
  },
  {
    key: 'ineligible_player',
    label: { fr: 'Joueur non inscrit ou non éligible', en: 'Unregistered or ineligible player' },
  },
  { key: 'not_played', label: { fr: 'Match non joué', en: 'Match not played' } },
  {
    key: 'technical',
    label: { fr: 'Problème technique ou re-host', en: 'Technical problem or re-host' },
  },
];

/** One step of a veto sequence: which team (A starts, section 5) bans or picks a map. */
export const VETO_SEQUENCE_STEPS = ['A_ban', 'B_ban', 'A_pick', 'B_pick'] as const;
export type VetoSequenceStep = (typeof VETO_SEQUENCE_STEPS)[number];

/**
 * Who picks the decider's sides: team A, as in a BO1, or the team with the better round
 * difference on the earlier maps, decided after they are played (BO3, BO5).
 */
export const DECIDER_SIDE_RULES = ['team_a', 'round_difference'] as const;

export const vetoFormatSchema = z.strictObject({
  /** Bans and picks in order; the map left after the last one is the decider. */
  sequence: z.array(z.enum(VETO_SEQUENCE_STEPS)),
  decider_side: z.enum(DECIDER_SIDE_RULES),
});
export type VetoFormat = z.infer<typeof vetoFormatSchema>;

const alternateBans = (count: number): VetoSequenceStep[] =>
  Array.from({ length: count }, (_step, index) => (index % 2 === 0 ? 'A_ban' : 'B_ban'));

/**
 * The sequences of design doc section 5 for a 9-map pool (O-11 asks whether LFR follows BLAST's
 * 2026 order instead), and the Six Invitational's 4 minutes per step.
 */
export const DEFAULT_VETO = {
  formats: {
    bo1: { sequence: alternateBans(8), decider_side: 'team_a' },
    bo3: {
      sequence: [...alternateBans(4), 'A_pick', 'B_pick', ...alternateBans(2)],
      decider_side: 'round_difference',
    },
    bo5: {
      sequence: [...alternateBans(2), 'A_pick', 'B_pick', ...alternateBans(2), 'A_pick', 'B_pick'],
      decider_side: 'round_difference',
    },
  } as Record<string, VetoFormat>,
  step_seconds: 240,
};

export const vetoSchema = z.strictObject({
  /** By format, `bo1` to `bo9`. A best-of-N sequence picks N − 1 maps; the decider is the last. */
  formats: z
    .record(z.string().regex(/^bo[1-9]$/), vetoFormatSchema)
    .refine(
      (formats) =>
        Object.entries(formats).every(
          ([key, format]) =>
            format.sequence.filter((step) => step.endsWith('_pick')).length ===
            Number(key.slice(2)) - 1,
        ),
      { error: 'A best-of-N sequence picks N − 1 maps.' },
    )
    .default(() =>
      Object.fromEntries(
        Object.entries(DEFAULT_VETO.formats).map(([key, format]) => [
          key,
          { ...format, sequence: [...format.sequence] },
        ]),
      ),
    ),
  /** Time for each step; a step not taken in time is chosen at random. */
  step_seconds: z.int().min(30).max(3600).default(DEFAULT_VETO.step_seconds),
});
export type VetoSettings = z.infer<typeof vetoSchema>;

/**
 * Moves between divisions at the end of the regular season, the maintainer's rule
 * (13 November 2026): the last `relegated` teams of a division that has a lower one go down, and
 * that lower division's first `relegated` go up; the `relegation_barrage` teams just above the
 * relegated ones play a barrage against the lower division's teams from `barrage_opponent_place`.
 */
export const promotionSchema = z
  .strictObject({
    relegated: z.int().min(0).default(2),
    relegation_barrage: z.int().min(0).default(1),
    barrage_opponent_place: z.int().min(1).default(3),
  })
  .refine((rules) => rules.barrage_opponent_place > rules.relegated, {
    error: 'A barrage opponent comes after the teams that go up.',
  });
export type PromotionSettings = z.infer<typeof promotionSchema>;

/**
 * How many people a team may have in each role besides its one owner (maintainer,
 * 13 November 2026): 3 managers, as the rulebook's 3 staff, and 1 coach, as R6 lobbies have one
 * coach slot per team.
 */
export const teamRolesSchema = z.strictObject({
  managers_max: z.int().min(0).default(3),
  coaches_max: z.int().min(0).default(1),
});
export type TeamRolesSettings = z.infer<typeof teamRolesSchema>;

/** What a team can ask of the league (design doc section 5, "Team requests"). */
export const REQUEST_KINDS = ['team_owner', 'team_member_add', 'team_member_remove'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** `auto`: applied at once and recorded; `staff`: waits for league staff to approve or refuse. */
export const APPROVAL_MODES = ['auto', 'staff'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

/**
 * Who answers each kind of request, and how fast. The defaults are the maintainer's
 * (13 November 2026): staff approve additions and handovers within 24 hours; the owner removes
 * people without asking, since the league restricts only what its rules restrict.
 */
export const requestsSchema = z
  .strictObject({
    approval: z
      .strictObject({
        team_owner: z.enum(APPROVAL_MODES).default('staff'),
        team_member_add: z.enum(APPROVAL_MODES).default('staff'),
        team_member_remove: z.enum(APPROVAL_MODES).default('auto'),
      })
      .default({ team_owner: 'staff', team_member_add: 'staff', team_member_remove: 'auto' }),
    answer_within_hours: z.int().min(1).max(720).default(24),
    /** Staff are reminded this long before the deadline; null: no reminder. */
    remind_before_hours: z.int().min(0).nullable().default(6),
  })
  .refine(
    (rules) =>
      rules.remind_before_hours === null || rules.remind_before_hours < rules.answer_within_hours,
    { error: 'The reminder comes after the request is filed.' },
  );
export type RequestsSettings = z.infer<typeof requestsSchema>;

/** `competition.ruleset_json`. */
export const rulesetSchema = z.strictObject({
  result_validation: z.enum(RESULT_VALIDATION_MODES),
  /** Null when any score with a winner is acceptable, as with Rocket League goals. */
  game_score: gameScoreSchema.nullable().default(null),
  team_roles: teamRolesSchema.default(() => teamRolesSchema.parse({})),
  requests: requestsSchema.default(() => requestsSchema.parse({})),
  /** Offered when a team disputes a result, before "other"; Discord lists 25 entries at most. */
  dispute_reasons: z
    .array(disputeReasonSchema)
    .max(24)
    .refine((reasons) => hasNoDuplicates(reasons.map((reason) => reason.key)), {
      error: 'A dispute reason key can appear only once.',
    })
    .default(() => DEFAULT_DISPUTE_REASONS.map((reason) => ({ ...reason }))),
  veto: vetoSchema.default(() => vetoSchema.parse({})),
  promotion: promotionSchema.default(() => promotionSchema.parse({})),
});
export type RulesetSettings = z.infer<typeof rulesetSchema>;

/** `competition.scheduling_json`. */
const isTimeZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

export const schedulingSchema = z.strictObject({
  rounds_per_week: z.int().min(1),
  /** Where weeks start at midnight and match times are typed; an IANA zone. */
  time_zone: z.string().refine(isTimeZone, { error: 'Unknown time zone.' }).default('Europe/Paris'),
  /** Weeks added when the teams agree no time during their week; LFR's rulebook gives one. */
  extension_weeks: z.int().min(1).max(4).default(1),
  /**
   * The time the match is set to when the extension starts without an agreed time, on the last
   * such weekday of the extension (1 = Monday, 7 = Sunday). Null: no automatic time.
   */
  auto_slot: z
    .strictObject({
      weekday: z.int().min(1).max(7),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    })
    .nullable()
    .default({ weekday: 7, time: '21:00' }),
});
export type SchedulingSettings = z.infer<typeof schedulingSchema>;

/**
 * The forfeit counts that call for a warning and for exclusion; null switches one off. The
 * rulebook warns at the 2nd forfeit and excludes at the 3rd.
 */
export const forfeitThresholdsSchema = z.strictObject({
  warning_at: z.int().min(1).nullable(),
  exclusion_at: z.int().min(1).nullable(),
});
export type ForfeitThresholds = z.infer<typeof forfeitThresholdsSchema>;

/** `season.settings_json`. */
export const seasonSettingsSchema = z.strictObject({
  /** Rounds credited to the winner and to the loser of a forfeit; feeds F, C and D. */
  forfeit_score: z.tuple([z.int().min(0), z.int().min(0)]),
  map_pool: z
    .array(z.string().min(1))
    .refine(hasNoDuplicates, { error: 'A map can appear only once.' }),
  forfeits: forfeitThresholdsSchema.default({ warning_at: 2, exclusion_at: 3 }),
});
export type SeasonSettings = z.infer<typeof seasonSettingsSchema>;

/** `stage.config_json`. `seed` is the stored shuffle seed of a round robin. */
export const stageConfigSchema = z.strictObject({
  seed: z.int().optional(),
});
export type StageConfig = z.infer<typeof stageConfigSchema>;
