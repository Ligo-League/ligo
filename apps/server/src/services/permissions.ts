import { findGuildLeague, type Db, type GuildLeague } from '@ligo/db';

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
