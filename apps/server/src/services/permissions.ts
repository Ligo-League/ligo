import { findGuildLeague, schema, type Db, type GuildLeague } from '@ligo/db';
import { and, eq, isNull } from 'drizzle-orm';

/** Who is acting, as Discord reports it for the interaction being handled. */
export interface Actor {
  guildId: string | null;
  user: { id: string; displayName: string };
  /** The member's role IDs in that server. */
  memberRoleIds: readonly string[];
}

export type StaffCheck =
  { ok: true; league: GuildLeague } | { ok: false; error: 'not_linked' | 'not_staff' };

/**
 * Staff are the members holding the staff role stored for the server. It is read from the
 * database on every call: hiding a command in Discord is cosmetic and proves nothing.
 */
export function requireStaff(
  db: Pick<Db, 'select'>,
  actor: Pick<Actor, 'guildId' | 'memberRoleIds'>,
): StaffCheck {
  const league = actor.guildId === null ? undefined : findGuildLeague(db, actor.guildId);
  if (!league) return { ok: false, error: 'not_linked' };
  if (!actor.memberRoleIds.includes(league.guild.staffRoleId)) {
    return { ok: false, error: 'not_staff' };
  }
  return { ok: true, league };
}

export interface TeamRoleHeld {
  teamId: number;
  role: 'manager' | 'staff';
}

/** The teams a player currently manages or staffs. */
export function teamsOfPlayer(db: Pick<Db, 'select'>, playerId: number): TeamRoleHeld[] {
  const { teamStaff } = schema;
  return db
    .select({ teamId: teamStaff.teamId, role: teamStaff.role })
    .from(teamStaff)
    .where(and(eq(teamStaff.playerId, playerId), isNull(teamStaff.until)))
    .all();
}

/**
 * The teams a Discord user may act for, as their manager or staff, read from the database on
 * every call. A user the platform has never seen acts for none.
 */
export function teamsActedFor(
  db: Pick<Db, 'select'>,
  actor: Pick<Actor, 'user'>,
): { playerId: number | null; teams: TeamRoleHeld[] } {
  const { player } = schema;
  const found = db
    .select({ id: player.id })
    .from(player)
    .where(eq(player.discordUserId, actor.user.id))
    .get();
  if (!found) return { playerId: null, teams: [] };
  return { playerId: found.id, teams: teamsOfPlayer(db, found.id) };
}
