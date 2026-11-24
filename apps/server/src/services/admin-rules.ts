import {
  DECIDER_SIDE_RULES,
  INTRA_CLUB_MOVES,
  MERCATO_MODES,
  pointsSchema,
  rulesetSchema,
  tiebreakSchema,
  UNRESOLVED_TIE_MODES,
  MOSS_PLAYERS_FROM,
} from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { openCompetition } from './admin-competitions.ts';
import type { OrgUser } from './orgs.ts';
import {
  dropEmptyOvertime,
  readSettingsForm,
  settingsFormValues,
  type SettingErrors,
  type SettingField,
} from './settings-form.ts';

// A competition's rules in the admin panel (phase 3h; design doc section 7): the points and
// tie-breakers a new season copies (a season's own come with its page, under the scoring lock,
// M-40), how a map is won, the veto, promotion, registration, the mercato, stats and dispute
// reasons. The organisation's owner and the competition's staff change them, audited.

const { auditLog, competition } = schema;
type Reader = Pick<Db, 'select'>;

/**
 * The tie-breakers the standings engine computes. Head-to-head and staff decisions are not
 * computed yet; choosing one would make the table fail, so the form does not offer them.
 */
export const COMPUTED_TIEBREAKS = ['points', 'diff', 'score_for', 'wins'] as const;
/** Up to 24 dispute reasons (Discord lists 25 entries, the last being "other"). */
const REASONS_MAX = 24;
/** Blank rows the form adds to the current reasons, to add new ones. */
const BLANK_REASONS = 3;

/** Tie-breakers the admin panel accepts: only those the standings compute. */
export const computedTiebreakSchema = tiebreakSchema.refine(
  (tiebreak) =>
    tiebreak.criteria.every((criterion) =>
      (COMPUTED_TIEBREAKS as readonly string[]).includes(criterion),
    ),
  { error: 'The standings do not compute this criterion yet.' },
);

const rulesSchema = z.strictObject({
  points: pointsSchema,
  tiebreak: computedTiebreakSchema,
  ruleset: rulesetSchema,
});
type Rules = z.infer<typeof rulesSchema>;

const int = { type: 'int' as const };
const optionalInt = { type: 'optionalInt' as const };
const choice = (options: readonly string[]) => ({ type: 'choice' as const, options });

/** The rules form for these rules: one sequence per veto format, the reasons and blank rows. */
export function rulesFields(rules: Rules): SettingField[] {
  const formats = Object.keys(rules.ruleset.veto.formats).sort();
  return [
    { path: 'points.outcomes.win', kind: int },
    { path: 'points.outcomes.loss', kind: int },
    { path: 'points.outcomes.overtime_win', kind: optionalInt },
    { path: 'points.outcomes.overtime_loss', kind: optionalInt },
    { path: 'points.forfeit.winner', kind: int },
    { path: 'points.forfeit.loser', kind: int },
    { path: 'points.forfeit.counts_as_played', kind: { type: 'bool' } },
    {
      path: 'tiebreak.criteria',
      kind: { type: 'choiceList', options: COMPUTED_TIEBREAKS, size: COMPUTED_TIEBREAKS.length },
    },
    { path: 'tiebreak.unresolved_tie', kind: choice(UNRESOLVED_TIE_MODES) },
    { path: 'ruleset.game_score.win_at', kind: optionalInt },
    { path: 'ruleset.game_score.overtime_rounds', kind: optionalInt },
    { path: 'ruleset.veto.step_seconds', kind: int },
    ...formats.flatMap((format): SettingField[] => [
      { path: `ruleset.veto.formats.${format}.sequence`, kind: { type: 'words' } },
      { path: `ruleset.veto.formats.${format}.decider_side`, kind: choice(DECIDER_SIDE_RULES) },
    ]),
    { path: 'ruleset.promotion.relegated', kind: int },
    { path: 'ruleset.promotion.relegation_barrage', kind: int },
    { path: 'ruleset.promotion.barrage_opponent_place', kind: int },
    { path: 'ruleset.registration.starters', kind: int },
    { path: 'ruleset.registration.subs_max', kind: int },
    { path: 'ruleset.registration.stats_consent_required', kind: { type: 'bool' } },
    { path: 'ruleset.registration.invite_days', kind: int },
    { path: 'ruleset.registration.min_age', kind: optionalInt },
    { path: 'ruleset.registration.lineup_lock_days', kind: int },
    { path: 'ruleset.registration.division_max', kind: int },
    { path: 'ruleset.mercato.mode', kind: choice(MERCATO_MODES) },
    { path: 'ruleset.mercato.max_moves_per_team', kind: optionalInt },
    { path: 'ruleset.mercato.lock_hours', kind: int },
    { path: 'ruleset.mercato.intra_club_moves', kind: choice(INTRA_CLUB_MOVES) },
    { path: 'ruleset.stats.entry_days', kind: optionalInt },
    { path: 'ruleset.stats.kills_deaths_tolerance', kind: int },
    { path: 'ruleset.replays.required', kind: { type: 'bool' } },
    { path: 'ruleset.replays.deadline_hours', kind: int },
    { path: 'ruleset.replays.rehosts_per_team', kind: int },
    { path: 'ruleset.replays.min_known_players', kind: int },
    { path: 'ruleset.replays.trade_window_s', kind: int },
    { path: 'ruleset.moss.required', kind: { type: 'bool' } },
    { path: 'ruleset.moss.players_from', kind: choice(MOSS_PLAYERS_FROM) },
    { path: 'ruleset.moss.retention_days', kind: optionalInt },
    {
      path: 'ruleset.dispute_reasons',
      kind: {
        type: 'rows',
        size: reasonRows(rules),
        columns: [{ name: 'key' }, { name: 'label.fr' }, { name: 'label.en', optional: true }],
      },
    },
  ];
}

const reasonRows = (rules: Rules) =>
  Math.min(REASONS_MAX, rules.ruleset.dispute_reasons.length + BLANK_REASONS);

/** No rounds to win a map: any score with a winner is accepted. Empty overtime points: none. */
function shapeGameScore(draft: Record<string, unknown>): void {
  dropEmptyOvertime(draft.points);
  const ruleset = draft.ruleset as { game_score?: { win_at?: unknown } | null } | undefined;
  if (ruleset?.game_score?.win_at === null) ruleset.game_score = null;
}

const rulesOf = (row: typeof competition.$inferSelect): Rules => ({
  points: row.pointsJson,
  tiebreak: row.tiebreakJson,
  ruleset: row.rulesetJson,
});

export type CompetitionRulesView =
  | {
      ok: true;
      owner: boolean;
      org: { name: string; slug: string };
      competition: { id: number; name: string; slug: string };
      values: Record<string, string>;
      /** The veto formats the competition has, each with its own sequence. */
      vetoFormats: string[];
      /** How many rows of dispute reasons the form shows. */
      reasonRows: number;
    }
  | { ok: false; error: 'not_found' | 'not_allowed' };

/** The rules page, for the organisation's owner and the competition's staff. */
export function competitionRules(
  db: Reader,
  user: OrgUser,
  orgSlug: string,
  compSlug: string,
  staffIds: readonly number[],
): CompetitionRulesView {
  const access = openCompetition(db, user, orgSlug, compSlug, staffIds);
  if (!access.ok) return access;
  const { orgRow, row, owner } = access;
  const rules = rulesOf(row);
  return {
    ok: true,
    owner,
    org: { name: orgRow.name, slug: orgRow.slug },
    competition: { id: row.id, name: row.name, slug: row.slug },
    values: settingsFormValues(rules, rulesFields(rules)),
    vetoFormats: Object.keys(rules.ruleset.veto.formats).sort(),
    reasonRows: reasonRows(rules),
  };
}

export type UpdateRulesReply =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'not_allowed' }
  | { ok: false; error: 'invalid'; errors: SettingErrors };

/** Saves the rules form; settings not on it keep their value. Audited, before and after. */
export function updateCompetitionRules(
  db: Db,
  user: OrgUser,
  key: { orgSlug: string; compSlug: string; staffIds: readonly number[] },
  form: Readonly<Record<string, string>>,
  now: number,
): UpdateRulesReply {
  const access = openCompetition(db, user, key.orgSlug, key.compSlug, key.staffIds);
  if (!access.ok) return access;
  const { row } = access;
  const current = rulesOf(row);
  const read = readSettingsForm(rulesSchema, current, rulesFields(current), form, shapeGameScore);
  if (!read.ok) return { ok: false, error: 'invalid', errors: read.errors };
  const next = read.value;
  // The replays can say who played only where every team must send them (M-47).
  if (next.ruleset.moss.players_from === 'replays' && !next.ruleset.replays.required) {
    return { ok: false, error: 'invalid', errors: { 'ruleset.moss.players_from': 'invalid' } };
  }
  db.transaction((tx) => {
    tx.update(competition)
      .set({ pointsJson: next.points, tiebreakJson: next.tiebreak, rulesetJson: next.ruleset })
      .where(eq(competition.id, row.id))
      .run();
    tx.insert(auditLog)
      .values({
        actorPlayerId: user.playerId,
        actorKind: 'user',
        action: 'competition.rules',
        entity: 'competition',
        entityId: String(row.id),
        beforeJson: current,
        afterJson: next,
        at: now,
      })
      .run();
  });
  return { ok: true };
}
