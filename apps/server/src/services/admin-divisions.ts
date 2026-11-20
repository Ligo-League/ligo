import { schema, type Db } from '@ligo/db';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { DiscordGateway } from '../discord/gateway.ts';
import { openSeason } from './admin-seasons.ts';
import type { OrgUser } from './orgs.ts';
import {
  readSettingsForm,
  settingsFormValues,
  type SettingErrors,
  type SettingField,
} from './settings-form.ts';

// Divisions in the admin panel (phase 3h; design doc section 7). The organisation's owner and the
// competition's staff add divisions to a season and change them: name, kind, level, region, the
// Discord category prefix (`L1`, also what `/standings` accepts), the results channel and, from
// phase 4, the division's staff role (M-05). The results channel is a text channel of the
// league's server where the bot posts a notice first, as on the channels page: one it cannot
// write to is refused now. The staff role is a role of that server, neither @everyone, nor the
// league's staff role, nor a team's role.

const { auditLog, discordObject, division, leagueGuild } = schema;
type Reader = Pick<Db, 'select'>;
type DivisionRow = typeof division.$inferSelect;

const divisionSchema = z.strictObject({
  name: z.string().min(1).max(40),
  kind: z.enum(schema.DIVISION_KINDS),
  level: z.int().min(1).max(20),
  region: z.string().min(1).max(40).nullable(),
  /** A Discord category's prefix, and what staff type in `/standings`: `L1`, `SUD`. */
  category_prefix: z.string().regex(/^[A-Za-z0-9-]{1,10}$/),
  results_channel_id: z
    .string()
    .regex(/^\d{17,20}$/)
    .nullable(),
  /** A role of the league's server whose holders act for this division only (M-05). */
  staff_role_id: z
    .string()
    .regex(/^\d{17,20}$/)
    .nullable(),
});
type DivisionForm = z.infer<typeof divisionSchema>;

export const DIVISION_FIELDS: readonly SettingField[] = [
  { path: 'name', kind: { type: 'text' } },
  { path: 'kind', kind: { type: 'choice', options: schema.DIVISION_KINDS } },
  { path: 'level', kind: { type: 'int' } },
  { path: 'region', kind: { type: 'text' } },
  { path: 'category_prefix', kind: { type: 'text' } },
  { path: 'results_channel_id', kind: { type: 'text' } },
  { path: 'staff_role_id', kind: { type: 'text' } },
];

/**
 * An empty region, channel or role means none: the league's results channel then applies, and
 * only the competition's staff act for the division.
 */
function shapeEmpty(draft: Record<string, unknown>): void {
  if (draft.region === '') draft.region = null;
  if (draft.results_channel_id === '') draft.results_channel_id = null;
  if (draft.staff_role_id === '') draft.staff_role_id = null;
}

const EMPTY: DivisionForm = {
  name: '',
  kind: 'league',
  level: 1,
  region: null,
  category_prefix: '',
  results_channel_id: null,
  staff_role_id: null,
};

const formOf = (row: DivisionRow): DivisionForm => ({
  name: row.name,
  kind: row.kind,
  level: row.level,
  region: row.region,
  category_prefix: row.categoryPrefix,
  results_channel_id: row.resultsChannelId,
  staff_role_id: row.staffRoleId,
});

type Key = {
  orgSlug: string;
  compSlug: string;
  seasonId: number;
  /** Null: a new division. */
  divisionId: number | null;
  staffIds: readonly number[];
};

/** The season, and the division of it asked for (none for a new one). */
function openDivision(db: Reader, user: OrgUser, key: Key) {
  const access = openSeason(db, user, key);
  if (!access.ok) return access;
  if (key.divisionId === null) return { ...access, divisionRow: null };
  const row = db
    .select()
    .from(division)
    .where(and(eq(division.id, key.divisionId), eq(division.seasonId, access.seasonRow.id)))
    .get();
  if (!row) return { ok: false as const, error: 'not_found' as const };
  return { ...access, divisionRow: row };
}

export type DivisionAdminView =
  | {
      ok: true;
      org: { name: string; slug: string };
      competition: { id: number; name: string; slug: string };
      season: { id: number; name: string };
      /** Null for a new division. */
      division: { id: number; name: string } | null;
      values: Record<string, string>;
      /** The league's Discord server, where the results channel is chosen; null when unlinked. */
      guildId: string | null;
    }
  | { ok: false; error: 'not_found' | 'not_allowed' };

/** A division's form, or a new division's. */
export function divisionAdmin(db: Reader, user: OrgUser, key: Key): DivisionAdminView {
  const access = openDivision(db, user, key);
  if (!access.ok) return access;
  const { orgRow, row, seasonRow, divisionRow } = access;
  return {
    ok: true,
    org: { name: orgRow.name, slug: orgRow.slug },
    competition: { id: row.id, name: row.name, slug: row.slug },
    season: { id: seasonRow.id, name: seasonRow.name },
    division: divisionRow && { id: divisionRow.id, name: divisionRow.name },
    values: settingsFormValues(divisionRow ? formOf(divisionRow) : EMPTY, DIVISION_FIELDS),
    guildId: guildOf(db, row.id),
  };
}

const guildOf = (db: Reader, competitionId: number) =>
  db
    .select({ guildId: leagueGuild.guildId })
    .from(leagueGuild)
    .where(eq(leagueGuild.competitionId, competitionId))
    .get()?.guildId ?? null;

/** The season's other divisions that share this name or prefix, ignoring case. */
function clashes(db: Reader, seasonId: number, divisionId: number | null, next: DivisionForm) {
  const others = db
    .select({ name: division.name, prefix: division.categoryPrefix })
    .from(division)
    .where(
      divisionId === null
        ? eq(division.seasonId, seasonId)
        : and(eq(division.seasonId, seasonId), ne(division.id, divisionId)),
    )
    .all();
  const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();
  const errors: SettingErrors = {};
  if (others.some((other) => same(other.name, next.name))) errors.name = 'taken';
  if (others.some((other) => same(other.prefix, next.category_prefix))) {
    errors.category_prefix = 'taken';
  }
  return errors;
}

export type SaveDivisionReply =
  | { ok: true; id: number }
  | { ok: false; error: 'not_found' | 'not_allowed' }
  | { ok: false; error: 'invalid'; errors: SettingErrors };

/**
 * Adds a division to the season (`divisionId` null) or saves one. A new results channel must be
 * a text channel of the league's server, and the bot posts `notice(division name)` there before
 * anything is saved. Audited, before and after.
 */
export async function saveDivision(
  db: Db,
  gateway: Pick<DiscordGateway, 'postMessage' | 'guildTextChannels' | 'guildRoles'>,
  user: OrgUser,
  key: Key,
  form: Readonly<Record<string, string>>,
  notice: (divisionName: string) => string,
  now: number,
): Promise<SaveDivisionReply> {
  const access = openDivision(db, user, key);
  if (!access.ok) return access;
  const { row: competition, seasonRow, divisionRow } = access;
  const current = divisionRow ? formOf(divisionRow) : EMPTY;
  const read = readSettingsForm(divisionSchema, current, DIVISION_FIELDS, form, shapeEmpty);
  if (!read.ok) return { ok: false, error: 'invalid', errors: read.errors };
  const next = read.value;
  const taken = clashes(db, seasonRow.id, divisionRow?.id ?? null, next);
  if (Object.keys(taken).length > 0) return { ok: false, error: 'invalid', errors: taken };

  const channelId = next.results_channel_id;
  if (channelId !== null && channelId !== current.results_channel_id) {
    const refused = (error: 'not_in_server' | 'cannot_post'): SaveDivisionReply => ({
      ok: false,
      error: 'invalid',
      errors: { results_channel_id: error },
    });
    const guildId = guildOf(db, competition.id);
    if (guildId === null) return refused('not_in_server');
    try {
      const channels = await gateway.guildTextChannels(guildId);
      if (!channels?.some((channel) => channel.id === channelId)) return refused('not_in_server');
      await gateway.postMessage(channelId, { content: notice(next.name) });
    } catch {
      return refused('cannot_post');
    }
  }

  const roleId = next.staff_role_id;
  if (roleId !== null && roleId !== current.staff_role_id) {
    const refused = (error: 'role_not_in_server' | 'role_reserved'): SaveDivisionReply => ({
      ok: false,
      error: 'invalid',
      errors: { staff_role_id: error },
    });
    const guild = db
      .select()
      .from(leagueGuild)
      .where(eq(leagueGuild.competitionId, competition.id))
      .get();
    if (!guild) return refused('role_not_in_server');
    const teamRole = db
      .select({ id: discordObject.id })
      .from(discordObject)
      .where(and(eq(discordObject.guildId, guild.guildId), eq(discordObject.discordId, roleId)))
      .get();
    if (roleId === guild.guildId || roleId === guild.staffRoleId || teamRole)
      return refused('role_reserved');
    let roles;
    try {
      roles = await gateway.guildRoles(guild.guildId);
    } catch {
      roles = null;
    }
    if (!roles?.some((role) => role.id === roleId)) return refused('role_not_in_server');
  }

  const values = {
    name: next.name,
    kind: next.kind,
    level: next.level,
    region: next.region,
    categoryPrefix: next.category_prefix,
    resultsChannelId: next.results_channel_id,
    staffRoleId: next.staff_role_id,
  };
  const id = db.transaction((tx) => {
    const saved = divisionRow
      ? tx.update(division).set(values).where(eq(division.id, divisionRow.id)).returning().get()
      : tx
          .insert(division)
          .values({ ...values, seasonId: seasonRow.id })
          .returning()
          .get();
    tx.insert(auditLog)
      .values({
        actorPlayerId: user.playerId,
        actorKind: 'user',
        action: divisionRow ? 'division.settings' : 'division.create',
        entity: 'division',
        entityId: String(saved.id),
        beforeJson: divisionRow ? current : null,
        afterJson: next,
        at: now,
      })
      .run();
    return saved.id;
  });
  return { ok: true, id };
}
