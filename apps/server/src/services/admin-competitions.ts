import {
  rulesetSchema,
  schedulingSchema,
  type PointsSettings,
  type TiebreakSettings,
} from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { R6_GAME_SCORE, TITLES, type Title } from '@ligo/titles';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { OrgUser } from './orgs.ts';
import { readSettingsForm, type SettingErrors, type SettingField } from './settings-form.ts';

// Competitions in the admin panel (phase 3h; design doc section 7, M-20, maintainer,
// 19 November 2026). The organisation's owner creates them; the owner and the competition's staff
// (its server's staff role, checked by the caller) change their settings. The slug, game and
// participant mode are fixed once the competition exists: addresses and stats depend on them.
// The scoring settings (points, tie-breakers) and the rules come in their own forms (3h-5).

const { auditLog, competition, org } = schema;
type Reader = Pick<Db, 'select'>;

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
/**
 * Words the admin panel's own routes use where a competition's slug goes: `/admin/:org/new`,
 * `/admin/:org/logo`, `/admin/:org/owner`.
 */
export const RESERVED_COMPETITION_SLUGS: readonly string[] = ['logo', 'new', 'owner'];

/** What a new competition starts with: lenient defaults a league then changes. */
const DEFAULT_POINTS: PointsSettings = {
  outcomes: { win: 3, loss: 0 },
  forfeit: { winner: 3, loser: 0, counts_as_played: true },
};
const DEFAULT_TIEBREAK: TiebreakSettings = {
  criteria: ['points', 'diff'],
  unresolved_tie: 'shared',
};
/** How a game is won, for the titles Ligo knows it for; null accepts any score with a winner. */
const GAME_SCORES: Partial<Record<Title, typeof R6_GAME_SCORE>> = { r6: R6_GAME_SCORE };

export interface CompetitionValues {
  title: string;
  name: string;
  slug: string;
  participantMode: string;
}

type CreateField = 'title' | 'name' | 'slug' | 'participantMode';
export type CreateCompetitionReply =
  | { ok: true; slug: string }
  | { ok: false; error: 'not_found' | 'not_owner' }
  | {
      ok: false;
      errors: Partial<Record<CreateField, 'invalid' | 'taken' | 'reserved' | 'length'>>;
    };

const orgOf = (db: Reader, slug: string) => db.select().from(org).where(eq(org.slug, slug)).get();
const isOwner = (row: { ownerDiscordUserId: string | null }, user: OrgUser) =>
  user.discordUserId !== null && row.ownerDiscordUserId === user.discordUserId;

/** The organisation's owner creates a competition, with defaults; its Discord server comes next. */
export function createCompetition(
  db: Db,
  user: OrgUser,
  orgSlug: string,
  values: CompetitionValues,
  now: number,
): CreateCompetitionReply {
  const orgRow = orgOf(db, orgSlug);
  if (!orgRow) return { ok: false, error: 'not_found' };
  if (!isOwner(orgRow, user)) return { ok: false, error: 'not_owner' };
  const errors: Partial<Record<CreateField, 'invalid' | 'taken' | 'reserved' | 'length'>> = {};
  const title = TITLES.find((entry) => entry === values.title);
  if (!title) errors.title = 'invalid';
  const mode = schema.PARTICIPANT_MODES.find((entry) => entry === values.participantMode);
  if (!mode) errors.participantMode = 'invalid';
  const name = values.name.trim();
  if (name.length < 2 || name.length > 60) errors.name = 'length';
  const slug = values.slug.trim();
  if (!SLUG.test(slug)) errors.slug = 'invalid';
  else if (RESERVED_COMPETITION_SLUGS.includes(slug)) errors.slug = 'reserved';
  else if (
    db
      .select({ id: competition.id })
      .from(competition)
      .where(and(eq(competition.orgId, orgRow.id), eq(competition.slug, slug)))
      .get()
  ) {
    errors.slug = 'taken';
  }
  if (!title || !mode || Object.keys(errors).length > 0) return { ok: false, errors };
  db.transaction((tx) => {
    const created = tx
      .insert(competition)
      .values({
        orgId: orgRow.id,
        title,
        name,
        slug,
        participantMode: mode,
        // A new league validates results through staff until it chooses otherwise.
        rulesetJson: rulesetSchema.parse({
          result_validation: 'staff',
          game_score: GAME_SCORES[title] ?? null,
        }),
        pointsJson: DEFAULT_POINTS,
        tiebreakJson: DEFAULT_TIEBREAK,
        schedulingJson: schedulingSchema.parse({ rounds_per_week: 1 }),
        statSchemaVersion: 1,
        themeJson: {},
      })
      .returning()
      .get();
    tx.insert(auditLog)
      .values({
        actorPlayerId: user.playerId,
        actorKind: 'user',
        action: 'competition.create',
        entity: 'competition',
        entityId: String(created.id),
        beforeJson: null,
        afterJson: { title, name, slug, participantMode: mode },
        at: now,
      })
      .run();
  });
  return { ok: true, slug };
}

/** The general settings: the competition's name, result validation, scheduling, requests, roles. */
const generalSchema = z.strictObject({
  name: z.string().min(2).max(60),
  ruleset: rulesetSchema,
  scheduling: schedulingSchema,
});
type General = z.infer<typeof generalSchema>;

const choice = (options: readonly string[]) => ({ type: 'choice' as const, options });
const APPROVAL = choice(['staff', 'auto']);

export const GENERAL_FIELDS: readonly SettingField[] = [
  { path: 'name', kind: { type: 'text' } },
  { path: 'ruleset.result_validation', kind: choice(['staff', 'opponent']) },
  { path: 'scheduling.time_zone', kind: { type: 'text' } },
  { path: 'scheduling.rounds_per_week', kind: { type: 'int' } },
  { path: 'scheduling.extension_weeks', kind: { type: 'int' } },
  { path: 'scheduling.auto_slot.weekday', kind: { type: 'optionalInt' } },
  { path: 'scheduling.auto_slot.time', kind: { type: 'text' } },
  { path: 'ruleset.requests.approval.team_owner', kind: APPROVAL },
  { path: 'ruleset.requests.approval.team_member_add', kind: APPROVAL },
  { path: 'ruleset.requests.approval.team_member_remove', kind: APPROVAL },
  { path: 'ruleset.requests.approval.roster_move', kind: APPROVAL },
  { path: 'ruleset.requests.answer_within_hours', kind: { type: 'int' } },
  { path: 'ruleset.requests.remind_before_hours', kind: { type: 'optionalInt' } },
  { path: 'ruleset.team_roles.managers_max', kind: { type: 'int' } },
  { path: 'ruleset.team_roles.coaches_max', kind: { type: 'int' } },
];

/** No weekday: no automatic slot at all. */
function shapeAutoSlot(draft: Record<string, unknown>): void {
  const scheduling = draft.scheduling as { auto_slot?: { weekday?: unknown } | null } | undefined;
  if (scheduling?.auto_slot?.weekday === null) scheduling.auto_slot = null;
}

/** A setting as its form field shows it. */
function valueAt(settings: unknown, path: string): string {
  let node: unknown = settings;
  for (const key of path.split('.')) {
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[key]
        : undefined;
  }
  // Every general field holds a string, a number or a boolean.
  return typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean'
    ? String(node)
    : '';
}

export type CompetitionAdminView =
  | {
      ok: true;
      owner: boolean;
      org: { name: string; slug: string };
      competition: {
        id: number;
        name: string;
        slug: string;
        title: Title;
        participantMode: string;
      };
      /** Each general field's current value, as typed in its form. */
      values: Record<string, string>;
    }
  | { ok: false; error: 'not_found' | 'not_allowed' };

/** Who opens the competition's admin page: the organisation's owner and the competition's staff. */
function opened(
  db: Reader,
  user: OrgUser,
  orgSlug: string,
  compSlug: string,
  staffIds: readonly number[],
) {
  const orgRow = orgOf(db, orgSlug);
  const row =
    orgRow &&
    db
      .select()
      .from(competition)
      .where(and(eq(competition.orgId, orgRow.id), eq(competition.slug, compSlug)))
      .get();
  if (!orgRow || !row) return { ok: false as const, error: 'not_found' as const };
  const owner = isOwner(orgRow, user);
  if (!owner && !staffIds.includes(row.id))
    return { ok: false as const, error: 'not_allowed' as const };
  return { ok: true as const, orgRow, row, owner };
}

const generalOf = (row: typeof competition.$inferSelect): General => ({
  name: row.name,
  ruleset: row.rulesetJson,
  scheduling: row.schedulingJson,
});

/** The competition's admin page; `staffIds` are the competitions whose staff role the user holds. */
export function competitionAdmin(
  db: Reader,
  user: OrgUser,
  orgSlug: string,
  compSlug: string,
  staffIds: readonly number[],
): CompetitionAdminView {
  const access = opened(db, user, orgSlug, compSlug, staffIds);
  if (!access.ok) return access;
  const { orgRow, row, owner } = access;
  const general = generalOf(row);
  return {
    ok: true,
    owner,
    org: { name: orgRow.name, slug: orgRow.slug },
    competition: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      title: row.title,
      participantMode: row.participantMode,
    },
    values: Object.fromEntries(
      GENERAL_FIELDS.map((field) => [field.path, valueAt(general, field.path)]),
    ),
  };
}

export type UpdateGeneralReply =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'not_allowed' }
  | { ok: false; error: 'invalid'; errors: SettingErrors };

/** Saves the general form; every other setting keeps its value. Audited, before and after. */
export function updateCompetitionGeneral(
  db: Db,
  user: OrgUser,
  key: { orgSlug: string; compSlug: string; staffIds: readonly number[] },
  form: Readonly<Record<string, string>>,
  now: number,
): UpdateGeneralReply {
  const access = opened(db, user, key.orgSlug, key.compSlug, key.staffIds);
  if (!access.ok) return access;
  const { row } = access;
  const current = generalOf(row);
  const read = readSettingsForm(generalSchema, current, GENERAL_FIELDS, form, shapeAutoSlot);
  if (!read.ok) return { ok: false, error: 'invalid', errors: read.errors };
  const next = read.value;
  db.transaction((tx) => {
    tx.update(competition)
      .set({ name: next.name.trim(), rulesetJson: next.ruleset, schedulingJson: next.scheduling })
      .where(eq(competition.id, row.id))
      .run();
    tx.insert(auditLog)
      .values({
        actorPlayerId: user.playerId,
        actorKind: 'user',
        action: 'competition.settings',
        entity: 'competition',
        entityId: String(row.id),
        beforeJson: current,
        afterJson: { ...next, name: next.name.trim() },
        at: now,
      })
      .run();
  });
  return { ok: true };
}
