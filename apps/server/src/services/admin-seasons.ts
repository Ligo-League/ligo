import {
  checkScoringEdit,
  mirroredForfeitScore,
  seasonSettingsSchema,
  slugify,
  UNRESOLVED_TIE_MODES,
  type SeasonSettings,
  zonedMidnight,
} from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { and, asc, desc, eq, inArray, ne, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { openCompetition } from './admin-competitions.ts';
import { COMPUTED_TIEBREAKS, computedTiebreakSchema } from './admin-rules.ts';
import type { OrgUser } from './orgs.ts';
import { seasonSlug } from './paths.ts';
import {
  readSettingsForm,
  settingsFormValues,
  type SettingErrors,
  type SettingField,
} from './settings-form.ts';

// Seasons in the admin panel (phase 3h; design doc section 7, M-40, maintainer, 19 November 2026).
// The organisation's owner and the competition's staff create a season, without a schedule
// (phase 4), and change its name, dates, settings and status. A new season takes the
// competition's points and tie-breakers, and the rest of its settings from the competition's
// latest season. Standings are computed from the scoring settings every time, so once a result
// counts in the season they change only through the organisation's owner, with a reason.

const { auditLog, division, match, season, stage } = schema;
type Reader = Pick<Db, 'select'>;
type SeasonStatus = (typeof schema.SEASON_STATUSES)[number];
type SeasonRow = typeof season.$inferSelect;

/** Words the competition's own pages use where a season's slug goes (`/:org/:comp/rules`). */
export const RESERVED_SEASON_SLUGS: readonly string[] = ['discord', 'register', 'rules'];

const isoDate = z.iso.date();
const NAME = z.string().min(1).max(60);

/** Compared only once both are dates: a date typed wrong is its own field's problem. */
const datesInOrder = (value: { starts_on: string; ends_on: string }) =>
  !isoDate.safeParse(value.starts_on).success ||
  !isoDate.safeParse(value.ends_on).success ||
  value.starts_on <= value.ends_on;
const DATES_ERROR = { error: 'A season ends on or after its first day.', path: ['ends_on'] };

const createSchema = z
  .strictObject({ name: NAME, starts_on: isoDate, ends_on: isoDate })
  .refine(datesInOrder, DATES_ERROR);

const seasonFormSchema = z
  .strictObject({
    name: NAME,
    starts_on: isoDate,
    ends_on: isoDate,
    settings: seasonSettingsSchema.extend({ tiebreak: computedTiebreakSchema }),
  })
  .refine(datesInOrder, DATES_ERROR);
type SeasonForm = z.infer<typeof seasonFormSchema>;

const int = { type: 'int' as const };
const optionalInt = { type: 'optionalInt' as const };
const text = { type: 'text' as const };

const CREATE_FIELDS: readonly SettingField[] = [
  { path: 'name', kind: text },
  { path: 'starts_on', kind: text },
  { path: 'ends_on', kind: text },
];

/** Both sides of a forfeit score, rounds for and against: `…winner.0`, `…winner.1`… */
const forfeitScoreFields = (path: string, kind: typeof int | typeof optionalInt) =>
  ['winner', 'loser'].flatMap((side) =>
    ['0', '1'].map((place): SettingField => ({ path: `${path}.${side}.${place}`, kind })),
  );

export const SEASON_FIELDS: readonly SettingField[] = [
  ...CREATE_FIELDS,
  { path: 'settings.points.outcomes.win', kind: int },
  { path: 'settings.points.outcomes.loss', kind: int },
  { path: 'settings.points.forfeit.winner', kind: int },
  { path: 'settings.points.forfeit.loser', kind: int },
  { path: 'settings.points.forfeit.counts_as_played', kind: { type: 'bool' } },
  {
    path: 'settings.tiebreak.criteria',
    kind: { type: 'choiceList', options: COMPUTED_TIEBREAKS, size: COMPUTED_TIEBREAKS.length },
  },
  {
    path: 'settings.tiebreak.unresolved_tie',
    kind: { type: 'choice', options: UNRESOLVED_TIE_MODES },
  },
  ...forfeitScoreFields('settings.forfeit_score', int),
  ...forfeitScoreFields('settings.exclusion_forfeit_score', optionalInt),
  { path: 'settings.forfeits.warning_at', kind: optionalInt },
  { path: 'settings.forfeits.exclusion_at', kind: optionalInt },
  { path: 'settings.map_pool', kind: { type: 'lines' } },
];

/** Four empty places for the 50% rule's forfeit score: the usual forfeit score applies. */
function shapeExclusionScore(draft: Record<string, unknown>): void {
  const settings = draft.settings as Record<string, unknown> | undefined;
  const score = settings?.exclusion_forfeit_score as
    { winner?: unknown[]; loser?: unknown[] } | null | undefined;
  if (!settings || !score) return;
  const places = [...(score.winner ?? []), ...(score.loser ?? [])];
  if (places.every((place) => place === null)) settings.exclusion_forfeit_score = null;
}

const formOf = (row: SeasonRow): SeasonForm => ({
  name: row.name,
  starts_on: row.startsOn,
  ends_on: row.endsOn,
  settings: row.settingsJson,
});

/** Whether a result counts in the season: a validated match or a forfeit (M-40). */
function resultCounts(db: Reader, seasonId: number): boolean {
  return (
    db
      .select({ id: match.id })
      .from(match)
      .innerJoin(stage, eq(match.stageId, stage.id))
      .where(and(eq(stage.seasonId, seasonId), inArray(match.status, ['validated', 'forfeit'])))
      .get() !== undefined
  );
}

/**
 * What is wrong with a season's name in its competition: a word the competition's pages use, or
 * an address another season has (`Saison 4` and `saison-4` share `/:org/:comp/saison-4`).
 */
function nameProblem(
  db: Reader,
  competitionId: number,
  name: string,
  seasonId: number | null,
): 'taken' | 'reserved' | null {
  const slug = slugify(name);
  if (slug.ok && RESERVED_SEASON_SLUGS.includes(slug.slug)) return 'reserved';
  const others = db
    .select({ id: season.id, name: season.name })
    .from(season)
    .where(
      seasonId === null
        ? eq(season.competitionId, competitionId)
        : and(eq(season.competitionId, competitionId), ne(season.id, seasonId)),
    )
    .all();
  const taken = others.some(
    (other) =>
      other.name.toLowerCase() === name.toLowerCase() ||
      (slug.ok && seasonSlug(other) === slug.slug),
  );
  return taken ? 'taken' : null;
}

type Key = { orgSlug: string; compSlug: string; staffIds: readonly number[] };

export type CreateSeasonReply =
  | { ok: true; id: number }
  | { ok: false; error: 'not_found' | 'not_allowed' }
  | { ok: false; error: 'invalid'; errors: SettingErrors };

/**
 * Creates a season taking registrations, without divisions or a schedule. It takes the
 * competition's points and tie-breakers, and the latest season's other settings; a competition's
 * first season scores a forfeit as a map won without a round lost, with no maps in its pool yet.
 */
export function createSeason(
  db: Db,
  user: OrgUser,
  key: Key,
  form: Readonly<Record<string, string>>,
  now: number,
): CreateSeasonReply {
  const access = openCompetition(db, user, key.orgSlug, key.compSlug, key.staffIds);
  if (!access.ok) return access;
  const { row: competition } = access;
  const empty = { name: '', starts_on: '', ends_on: '' };
  const read = readSettingsForm(createSchema, empty, CREATE_FIELDS, form);
  const errors: SettingErrors = read.ok ? {} : { ...read.errors };
  const name = (form.name ?? '').trim();
  const problem = name === '' ? null : nameProblem(db, competition.id, name, null);
  if (problem) errors.name = problem;
  if (!read.ok || problem) return { ok: false, error: 'invalid', errors };

  const latest = db
    .select({ settings: season.settingsJson })
    .from(season)
    .where(eq(season.competitionId, competition.id))
    .orderBy(desc(season.startsOn), desc(season.id))
    .get();
  const rounds = competition.rulesetJson.game_score?.win_at ?? 1;
  const settings: SeasonSettings = seasonSettingsSchema.parse({
    forfeit_score: mirroredForfeitScore(rounds, 0),
    map_pool: [],
    ...latest?.settings,
    points: competition.pointsJson,
    tiebreak: competition.tiebreakJson,
  });
  const values = read.value;
  const created = db.transaction((tx) => {
    const inserted = tx
      .insert(season)
      .values({
        competitionId: competition.id,
        name: values.name,
        startsOn: values.starts_on,
        endsOn: values.ends_on,
        status: 'registration',
        settingsJson: settings,
      })
      .returning()
      .get();
    tx.insert(auditLog)
      .values({
        actorPlayerId: user.playerId,
        actorKind: 'user',
        action: 'season.create',
        entity: 'season',
        entityId: String(inserted.id),
        beforeJson: null,
        afterJson: { ...formOf(inserted), status: inserted.status },
        at: now,
      })
      .run();
    return inserted;
  });
  return { ok: true, id: created.id };
}

/** The season of this competition, for its owner and staff. */
export function openSeason(db: Reader, user: OrgUser, key: Key & { seasonId: number }) {
  const access = openCompetition(db, user, key.orgSlug, key.compSlug, key.staffIds);
  if (!access.ok) return access;
  const row = db
    .select()
    .from(season)
    .where(and(eq(season.id, key.seasonId), eq(season.competitionId, access.row.id)))
    .get();
  if (!row) return { ok: false as const, error: 'not_found' as const };
  return { ...access, seasonRow: row };
}

const statusesAfter = (status: SeasonStatus): SeasonStatus[] =>
  schema.SEASON_STATUSES.slice(schema.SEASON_STATUSES.indexOf(status) + 1);

export type SeasonAdminView =
  | {
      ok: true;
      owner: boolean;
      org: { name: string; slug: string };
      competition: { id: number; name: string; slug: string };
      season: { id: number; name: string; slug: string; status: SeasonStatus };
      values: Record<string, string>;
      /** A result counts in the season: its scoring settings are locked (M-40). */
      locked: boolean;
      /** The statuses the season may still take, in order. */
      nextStatuses: SeasonStatus[];
      /** Its divisions, top level first. */
      divisions: { id: number; name: string; level: number; categoryPrefix: string }[];
    }
  | { ok: false; error: 'not_found' | 'not_allowed' };

/** A season's admin page. */
export function seasonAdmin(
  db: Reader,
  user: OrgUser,
  orgSlug: string,
  compSlug: string,
  seasonId: number,
  staffIds: readonly number[],
): SeasonAdminView {
  const access = openSeason(db, user, { orgSlug, compSlug, staffIds, seasonId });
  if (!access.ok) return access;
  const { orgRow, row, owner, seasonRow } = access;
  return {
    ok: true,
    owner,
    org: { name: orgRow.name, slug: orgRow.slug },
    competition: { id: row.id, name: row.name, slug: row.slug },
    season: {
      id: seasonRow.id,
      name: seasonRow.name,
      slug: seasonSlug(seasonRow),
      status: seasonRow.status,
    },
    values: settingsFormValues(formOf(seasonRow), SEASON_FIELDS),
    locked: resultCounts(db, seasonRow.id),
    nextStatuses: statusesAfter(seasonRow.status),
    divisions: db
      .select({
        id: division.id,
        name: division.name,
        level: division.level,
        categoryPrefix: division.categoryPrefix,
      })
      .from(division)
      .where(eq(division.seasonId, seasonRow.id))
      .orderBy(asc(division.level), asc(division.name))
      .all(),
  };
}

export type UpdateSeasonReply =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'not_allowed' }
  | { ok: false; error: 'invalid'; errors: SettingErrors };

/**
 * Saves a season's form. Its scoring settings follow the lock (M-40): once a result counts, only
 * the organisation's owner changes them, giving a reason (`form.reason`) the audit log keeps.
 */
export function updateSeason(
  db: Db,
  user: OrgUser,
  key: Key & { seasonId: number },
  form: Readonly<Record<string, string>>,
  now: number,
): UpdateSeasonReply {
  const access = openSeason(db, user, key);
  if (!access.ok) return access;
  const { owner, row: competition, seasonRow } = access;
  const current = formOf(seasonRow);
  const read = readSettingsForm(
    seasonFormSchema,
    current,
    SEASON_FIELDS,
    form,
    shapeExclusionScore,
  );
  const errors: SettingErrors = read.ok ? {} : { ...read.errors };
  const name = (form.name ?? '').trim();
  const problem =
    name === '' || name === seasonRow.name
      ? null
      : nameProblem(db, competition.id, name, seasonRow.id);
  if (problem) errors.name = problem;
  if (!read.ok || problem) return { ok: false, error: 'invalid', errors };

  const next = read.value;
  const reason = (form.reason ?? '').trim();
  const lock = checkScoringEdit({
    before: current.settings,
    after: next.settings,
    resultCounts: resultCounts(db, seasonRow.id),
    owner,
    reason,
  });
  if (!lock.ok) {
    return {
      ok: false,
      error: 'invalid',
      errors:
        lock.error === 'reason_required'
          ? { reason: 'required' }
          : Object.fromEntries(lock.changes.map((change) => [`settings.${change}`, 'locked'])),
    };
  }
  // A reason is kept only where it explains a change under the lock.
  const explained = lock.changes.length > 0 && resultCounts(db, seasonRow.id);
  db.transaction((tx) => {
    tx.update(season)
      .set({
        name: next.name,
        startsOn: next.starts_on,
        endsOn: next.ends_on,
        settingsJson: next.settings,
      })
      .where(eq(season.id, seasonRow.id))
      .run();
    tx.insert(auditLog)
      .values({
        actorPlayerId: user.playerId,
        actorKind: 'user',
        action: 'season.settings',
        entity: 'season',
        entityId: String(seasonRow.id),
        beforeJson: current,
        afterJson: explained ? { ...next, reason, scoringChanges: lock.changes } : next,
        at: now,
      })
      .run();
  });
  return { ok: true };
}

/** What staff read before closing a season, which can never be undone. */
export interface ClosingNotice {
  /** The season's last day, `YYYY-MM-DD`. */
  endsOn: string;
  /** Closed before the end of its last day, in the competition's time zone. */
  early: boolean;
  /** Its matches whose result does not count yet: they stay unplayed for good. */
  unfinished: number;
}

export type AdvanceSeasonReply =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'not_allowed' | 'backward' }
  | { ok: false; error: 'needs_confirmation'; closing: ClosingNotice };

const COUNTED_STATUSES = ['validated', 'forfeit', 'void'] as const;

function closingNotice(
  db: Reader,
  seasonRow: typeof season.$inferSelect,
  timeZone: string,
  now: number,
): ClosingNotice {
  const unfinished = db
    .select({ id: match.id })
    .from(match)
    .innerJoin(stage, eq(match.stageId, stage.id))
    .where(and(eq(stage.seasonId, seasonRow.id), notInArray(match.status, [...COUNTED_STATUSES])))
    .all().length;
  return {
    endsOn: seasonRow.endsOn,
    early: now < zonedMidnight(seasonRow.endsOn, timeZone, 1),
    unfinished,
  };
}

/**
 * Moves the season to a later status (registration, active, cup, closed), skipping any it does
 * not use; it never goes back. Closing deletes the season's match channels and team roles in
 * Discord and cannot be undone, so it needs `confirmed` (maintainer, 23 November 2026): without
 * it, the reply says what staff confirm. Only the website closes a season, never Discord.
 */
export function advanceSeason(
  db: Db,
  user: OrgUser,
  key: Key & { seasonId: number },
  status: string,
  now: number,
  options: { confirmed?: boolean } = {},
): AdvanceSeasonReply {
  const access = openSeason(db, user, key);
  if (!access.ok) return access;
  const { seasonRow, row } = access;
  const next = statusesAfter(seasonRow.status).find((entry) => entry === status);
  if (!next) return { ok: false, error: 'backward' };
  if (next === 'closed' && options.confirmed !== true)
    return {
      ok: false,
      error: 'needs_confirmation',
      closing: closingNotice(db, seasonRow, row.schedulingJson.time_zone, now),
    };
  db.transaction((tx) => {
    tx.update(season).set({ status: next }).where(eq(season.id, seasonRow.id)).run();
    tx.insert(auditLog)
      .values({
        actorPlayerId: user.playerId,
        actorKind: 'user',
        action: 'season.status',
        entity: 'season',
        entityId: String(seasonRow.id),
        beforeJson: { status: seasonRow.status },
        afterJson: { status: next },
        at: now,
      })
      .run();
  });
  return { ok: true };
}
