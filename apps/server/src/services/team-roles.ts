import {
  categoryName,
  fillTemplate,
  type DesiredRole,
  type DiscordSettings,
  type KnownObject,
} from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { and, eq, gt, inArray, isNull, lte, ne, or } from 'drizzle-orm';
import type { DiscordGateway } from '../discord/gateway.ts';
import { withGuildLock } from './guild-lock.ts';

// Team roles (phase 4; design doc section 6, "Reconciler"; M-46): one role per roster playing in
// the competition, held by its season lineup's players and its officials with a Discord account.
// Pure reads: the reconciler compares this with the server and makes the changes.

const { club, clubStaff, division, player, rosterEntry, season, slot, team, teamStaff } = schema;

type Reader = Pick<Db, 'select'>;

/** The key of a roster's role in `discord_object` and in the reconciler's desired state. */
export const teamRoleKey = (teamId: number) => `team:${String(teamId)}`;

/**
 * The slots that hold a team role: a team still playing (active, or frozen while staff decide),
 * in a season not closed yet. A team withdrawn or excluded loses its role, and so does every team
 * once its season is closed.
 */
const HOLDING_SLOTS = ['active', 'frozen'] as const;

export interface CompetitionRoster {
  teamId: number;
  clubId: number;
  name: string;
  tag: string;
  /** The roster's first colour (its club's when it has none), as Discord takes it (0xRRGGBB). */
  color: number | null;
  /** The seasons it has a holding slot in. */
  seasonIds: number[];
}

/** The rosters with a holding slot in one of the competition's seasons not closed, by ID. */
export function competitionRosters(db: Reader, competitionId: number): CompetitionRoster[] {
  const rows = db
    .select({
      teamId: team.id,
      clubId: team.clubId,
      name: team.name,
      tag: team.tag,
      colors: team.colorsJson,
      clubColors: club.colorsJson,
      seasonId: season.id,
    })
    .from(slot)
    .innerJoin(division, eq(slot.divisionId, division.id))
    .innerJoin(season, eq(division.seasonId, season.id))
    .innerJoin(team, eq(slot.teamId, team.id))
    .innerJoin(club, eq(team.clubId, club.id))
    .where(
      and(
        eq(season.competitionId, competitionId),
        ne(season.status, 'closed'),
        inArray(slot.status, HOLDING_SLOTS),
      ),
    )
    .orderBy(team.id)
    .all();
  const rosters = new Map<number, CompetitionRoster>();
  for (const row of rows) {
    const known = rosters.get(row.teamId);
    if (known) {
      if (!known.seasonIds.includes(row.seasonId)) known.seasonIds.push(row.seasonId);
      continue;
    }
    // A roster without colours of its own wears its club's.
    const first = (row.colors ?? row.clubColors)[0];
    rosters.set(row.teamId, {
      teamId: row.teamId,
      clubId: row.clubId,
      name: row.name,
      tag: row.tag,
      color: first === undefined ? null : Number.parseInt(first.slice(1), 16),
      seasonIds: [row.seasonId],
    });
  }
  return [...rosters.values()];
}

/**
 * Who should hold a roster's role: its lineup in those seasons as of `now` (a move waiting for
 * its start date not yet, an ended one no longer), its own officials and its club's. Players
 * without a Discord account are left out: there is nobody to give it to.
 */
function holders(db: Reader, roster: CompetitionRoster, now: number): string[] {
  const lineup = db
    .select({ discordUserId: player.discordUserId })
    .from(rosterEntry)
    .innerJoin(player, eq(rosterEntry.playerId, player.id))
    .where(
      and(
        eq(rosterEntry.teamId, roster.teamId),
        inArray(rosterEntry.seasonId, roster.seasonIds),
        lte(rosterEntry.validFrom, now),
        or(isNull(rosterEntry.validTo), gt(rosterEntry.validTo, now)),
      ),
    )
    .all();
  // 'owner' rows of team_staff are history from before clubs, as in `teamsOfPlayer`.
  const officials = db
    .select({ discordUserId: player.discordUserId })
    .from(teamStaff)
    .innerJoin(player, eq(teamStaff.playerId, player.id))
    .where(
      and(
        eq(teamStaff.teamId, roster.teamId),
        isNull(teamStaff.until),
        inArray(teamStaff.role, ['manager', 'coach']),
      ),
    )
    .all();
  const clubOfficials = db
    .select({ discordUserId: player.discordUserId })
    .from(clubStaff)
    .innerJoin(player, eq(clubStaff.playerId, player.id))
    .where(and(eq(clubStaff.clubId, roster.clubId), isNull(clubStaff.until)))
    .all();
  const ids = new Set<string>();
  for (const row of [...lineup, ...officials, ...clubOfficials])
    if (row.discordUserId !== null) ids.add(row.discordUserId);
  return [...ids].sort();
}

/** The team roles the competition's server should hold, by roster ID. */
export function desiredTeamRoles(
  db: Reader,
  competitionId: number,
  settings: DiscordSettings,
  now: number,
): DesiredRole[] {
  return competitionRosters(db, competitionId).map((roster) => ({
    key: teamRoleKey(roster.teamId),
    name: categoryName(
      fillTemplate(settings.team_role_template, { name: roster.name, tag: roster.tag }),
    ),
    color: roster.color,
    mentionable: settings.team_roles_mentionable,
    members: holders(db, roster, now),
  }));
}

/** The team roles stored for a server, by key. */
export function storedTeamRoles(db: Reader, guildId: string): Map<string, KnownObject> {
  const rows = db
    .select()
    .from(schema.discordObject)
    .where(
      and(eq(schema.discordObject.guildId, guildId), eq(schema.discordObject.kind, 'team_role')),
    )
    .all();
  return new Map(
    rows.map((row) => [
      row.key,
      { kind: row.kind, key: row.key, discordId: row.discordId, createdByLigo: row.createdByLigo },
    ]),
  );
}

export type TeamRoleError =
  | 'not_linked'
  | 'not_a_roster'
  | 'not_in_server'
  | 'discord_unavailable'
  | 'unknown_role'
  | 'reserved_role'
  | 'role_taken'
  | 'not_a_link';

export interface RosterRole {
  teamId: number;
  name: string;
  tag: string;
  /** Its role in the server: made by Ligo, or linked by staff; null until the next sync. */
  role: { id: string; name: string; linked: boolean } | null;
}

export interface TeamRoleChoices {
  ok: true;
  rosters: RosterRole[];
  /** Roles staff may link: none of the league's staff roles, and none Ligo already holds. */
  linkable: { id: string; name: string }[];
}

/** Roles that are never a team's: @everyone, the league's staff role and its divisions'. */
function reservedRoles(db: Reader, competitionId: number, everyoneId: string, staffRoleId: string) {
  const divisions = db
    .select({ roleId: division.staffRoleId })
    .from(division)
    .innerJoin(season, eq(division.seasonId, season.id))
    .where(eq(season.competitionId, competitionId))
    .all();
  const reserved = new Set([everyoneId, staffRoleId]);
  for (const row of divisions) if (row.roleId !== null) reserved.add(row.roleId);
  return reserved;
}

const guildOf = (db: Reader, competitionId: number) =>
  db
    .select()
    .from(schema.leagueGuild)
    .where(eq(schema.leagueGuild.competitionId, competitionId))
    .get();

async function snapshotOf(gateway: DiscordGateway, guildId: string) {
  try {
    const snapshot = await gateway.guildSnapshot(guildId);
    return snapshot ?? ('not_in_server' as const);
  } catch {
    return 'discord_unavailable' as const;
  }
}

/** The competition's rosters with their role in its server, and the roles staff may link. */
export async function teamRoleChoices(
  db: Reader,
  gateway: DiscordGateway,
  competitionId: number,
): Promise<
  TeamRoleChoices | { ok: false; error: 'not_linked' | 'not_in_server' | 'discord_unavailable' }
> {
  const guild = guildOf(db, competitionId);
  if (!guild) return { ok: false, error: 'not_linked' };
  const snapshot = await snapshotOf(gateway, guild.guildId);
  if (typeof snapshot === 'string') return { ok: false, error: snapshot };
  const names = new Map(snapshot.roles.map((role) => [role.id, role.name]));
  const stored = storedTeamRoles(db, guild.guildId);
  const held = new Set([...stored.values()].map((object) => object.discordId));
  const reserved = reservedRoles(db, competitionId, snapshot.everyoneId, guild.staffRoleId);
  return {
    ok: true,
    rosters: competitionRosters(db, competitionId).map((roster) => {
      const object = stored.get(teamRoleKey(roster.teamId));
      const name = object && names.get(object.discordId);
      return {
        teamId: roster.teamId,
        name: roster.name,
        tag: roster.tag,
        role:
          object && name !== undefined
            ? { id: object.discordId, name, linked: !object.createdByLigo }
            : null,
      };
    }),
    linkable: snapshot.roles
      .filter((role) => !reserved.has(role.id) && !held.has(role.id))
      .map((role) => ({ id: role.id, name: role.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export interface TeamRoleChange {
  competitionId: number;
  teamId: number;
  actorPlayerId: number;
  now: number;
}

type Reply = { ok: true } | { ok: false; error: TeamRoleError };

/**
 * Links an existing server role to a roster (M-46): Ligo then gives it to the roster's holders
 * and takes it from anyone else, but never renames, recolours or deletes it. A role Ligo made for
 * the roster before is deleted first, since nothing needs it any more. Runs between syncs of the
 * server, so a sync never makes the roster a role at the same moment.
 */
export function linkTeamRole(
  db: Db,
  gateway: DiscordGateway,
  change: TeamRoleChange & { roleId: string },
): Promise<Reply> {
  const guild = guildOf(db, change.competitionId);
  if (!guild) return Promise.resolve({ ok: false, error: 'not_linked' });
  return withGuildLock(guild.guildId, async (): Promise<Reply> => {
    if (!competitionRosters(db, change.competitionId).some((r) => r.teamId === change.teamId))
      return { ok: false, error: 'not_a_roster' };
    const snapshot = await snapshotOf(gateway, guild.guildId);
    if (typeof snapshot === 'string') return { ok: false, error: snapshot };
    if (!snapshot.roles.some((role) => role.id === change.roleId))
      return { ok: false, error: 'unknown_role' };
    if (
      reservedRoles(db, change.competitionId, snapshot.everyoneId, guild.staffRoleId).has(
        change.roleId,
      )
    )
      return { ok: false, error: 'reserved_role' };
    const key = teamRoleKey(change.teamId);
    const stored = storedTeamRoles(db, guild.guildId);
    const before = stored.get(key);
    if (before?.discordId === change.roleId && !before.createdByLigo) return { ok: true };
    if ([...stored.values()].some((object) => object.discordId === change.roleId))
      return { ok: false, error: 'role_taken' };
    if (before?.createdByLigo && snapshot.roles.some((role) => role.id === before.discordId)) {
      try {
        await gateway.changeGuild(
          guild.guildId,
          { kind: 'delete_role', roleId: before.discordId },
          'Ligo: a role was linked to this team instead',
        );
      } catch {
        return { ok: false, error: 'discord_unavailable' };
      }
    }
    db.transaction((tx) => {
      const where = and(
        eq(schema.discordObject.guildId, guild.guildId),
        eq(schema.discordObject.kind, 'team_role'),
        eq(schema.discordObject.key, key),
      );
      tx.delete(schema.discordObject).where(where).run();
      tx.insert(schema.discordObject)
        .values({
          guildId: guild.guildId,
          kind: 'team_role',
          key,
          discordId: change.roleId,
          createdByLigo: false,
          createdAt: change.now,
        })
        .run();
      tx.insert(schema.auditLog)
        .values({
          actorPlayerId: change.actorPlayerId,
          actorKind: 'user',
          action: 'discord.team_role.link',
          entity: 'team',
          entityId: String(change.teamId),
          beforeJson: before
            ? { roleId: before.discordId, createdByLigo: before.createdByLigo }
            : null,
          afterJson: { roleId: change.roleId, guildId: guild.guildId },
          at: change.now,
        })
        .run();
    });
    return { ok: true };
  });
}

/** Unlinks a role staff linked: it stays in the server as it is, and the next sync makes one. */
export function unlinkTeamRole(db: Db, change: TeamRoleChange): Promise<Reply> {
  const guild = guildOf(db, change.competitionId);
  if (!guild) return Promise.resolve({ ok: false, error: 'not_linked' });
  return withGuildLock(guild.guildId, (): Promise<Reply> => {
    const key = teamRoleKey(change.teamId);
    const before = storedTeamRoles(db, guild.guildId).get(key);
    if (!before || before.createdByLigo) return Promise.resolve({ ok: false, error: 'not_a_link' });
    db.transaction((tx) => {
      tx.delete(schema.discordObject)
        .where(
          and(
            eq(schema.discordObject.guildId, guild.guildId),
            eq(schema.discordObject.kind, 'team_role'),
            eq(schema.discordObject.key, key),
          ),
        )
        .run();
      tx.insert(schema.auditLog)
        .values({
          actorPlayerId: change.actorPlayerId,
          actorKind: 'user',
          action: 'discord.team_role.unlink',
          entity: 'team',
          entityId: String(change.teamId),
          beforeJson: { roleId: before.discordId, guildId: guild.guildId },
          afterJson: null,
          at: change.now,
        })
        .run();
    });
    return Promise.resolve({ ok: true });
  });
}
