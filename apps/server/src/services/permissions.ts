import {
  actsForSide,
  TEAM_ROLES,
  type MatchRoleHeld,
  type RoleHeld,
  type TeamRole,
} from '@ligo/core';
import {
  findGuildLeague,
  listLeagueMatches,
  schema,
  type Db,
  type GuildLeague,
  type LeagueMatch,
} from '@ligo/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

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

/** A role someone holds for a roster; a club role counts for each roster of the club. */
export type TeamRoleHeld = RoleHeld;

/**
 * The rosters a player currently acts for: as one of a roster's officials, or as an official of
 * its club, who acts for every roster of the club.
 */
export function teamsOfPlayer(db: Pick<Db, 'select'>, playerId: number): TeamRoleHeld[] {
  const { clubStaff, team, teamStaff } = schema;
  const roster = db
    .select({ teamId: teamStaff.teamId, clubId: team.clubId, role: teamStaff.role })
    .from(teamStaff)
    .innerJoin(team, eq(teamStaff.teamId, team.id))
    // 'owner' rows are history from before clubs: the owner is the club's now.
    .where(
      and(
        eq(teamStaff.playerId, playerId),
        isNull(teamStaff.until),
        inArray(teamStaff.role, ['manager', 'coach']),
      ),
    )
    .all()
    .map((row): TeamRoleHeld => ({
      teamId: row.teamId,
      clubId: row.clubId,
      role: row.role === 'coach' ? 'coach' : 'manager',
    }));
  const club = db
    .select({ teamId: team.id, clubId: clubStaff.clubId, role: clubStaff.role })
    .from(clubStaff)
    .innerJoin(team, eq(team.clubId, clubStaff.clubId))
    .where(and(eq(clubStaff.playerId, playerId), isNull(clubStaff.until)))
    .all()
    .map((row): TeamRoleHeld => ({
      teamId: row.teamId,
      clubId: row.clubId,
      role: row.role === 'owner' ? 'owner' : 'club_manager',
    }));
  return [...club, ...roster];
}

/** The highest role held for a roster, among the roles held: the club's before the roster's. */
export function highestRole(held: readonly TeamRoleHeld[], teamId: number): TeamRole | null {
  const roles = held.filter((entry) => entry.teamId === teamId).map((entry) => entry.role);
  return TEAM_ROLES.find((role) => roles.includes(role)) ?? null;
}

/**
 * The roles a player holds in a season's matches: their officials' roles, the captaincy of the
 * roster they play for that season (M-19), and each captaincy for one match of that season
 * (O-30b), which counts in that match only (`matchId`). The captain acts in matches only:
 * requests about the team's officials read `teamsOfPlayer`, which leaves the captain out.
 */
export function matchRolesOf(
  db: Pick<Db, 'select'>,
  playerId: number,
  seasonId: number | null,
): MatchRoleHeld[] {
  const officials: MatchRoleHeld[] = teamsOfPlayer(db, playerId);
  if (seasonId === null) return officials;
  const { rosterEntry, team } = schema;
  const captaincies = db
    .select({ teamId: rosterEntry.teamId, clubId: team.clubId })
    .from(rosterEntry)
    .innerJoin(team, eq(rosterEntry.teamId, team.id))
    .where(
      and(
        eq(rosterEntry.playerId, playerId),
        eq(rosterEntry.seasonId, seasonId),
        eq(rosterEntry.captain, true),
        isNull(rosterEntry.validTo),
      ),
    )
    .all()
    .map((row): MatchRoleHeld => ({ ...row, role: 'captain' }));
  const forOneMatch = db
    .select({ matchId: schema.matchCaptain.matchId, side: schema.matchCaptain.side })
    .from(schema.matchCaptain)
    .where(eq(schema.matchCaptain.playerId, playerId))
    .all()
    .flatMap(({ matchId, side }): MatchRoleHeld[] => {
      const [found] = listLeagueMatches(db, { matchId });
      if (found?.seasonId !== seasonId) return [];
      const teamId = found[side].teamId;
      const clubId = db
        .select({ clubId: team.clubId })
        .from(team)
        .where(eq(team.id, teamId))
        .get()?.clubId;
      return clubId === undefined ? [] : [{ teamId, clubId, role: 'captain', matchId }];
    });
  return [...officials, ...captaincies, ...forOneMatch];
}

/** `matchRolesOf` for a Discord user: who may act in that season's matches, and for which side. */
export function matchActorOf(
  db: Pick<Db, 'select'>,
  actor: Pick<Actor, 'user'>,
  seasonId: number | null,
): { playerId: number | null; teams: MatchRoleHeld[] } {
  const found = db
    .select({ id: schema.player.id })
    .from(schema.player)
    .where(eq(schema.player.discordUserId, actor.user.id))
    .get();
  if (!found) return { playerId: null, teams: [] };
  return { playerId: found.id, teams: matchRolesOf(db, found.id, seasonId) };
}

type Side = 'a' | 'b';

/** Whether the roles let someone act for that side of the match (core `actsForSide`). */
export const actsFor = (held: readonly MatchRoleHeld[], found: LeagueMatch, side: Side) =>
  actsForSide(held, found, side);

/** The side someone acts for, side A first when they act for both. */
export const sideOf = (held: readonly MatchRoleHeld[], found: LeagueMatch): Side | null =>
  actsFor(held, found, 'a') ? 'a' : actsFor(held, found, 'b') ? 'b' : null;

/**
 * The teams a Discord user may act for, as owner, manager or coach, read from the database on
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
