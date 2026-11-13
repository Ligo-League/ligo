import {
  checkTeamChange,
  TEAM_ROLES,
  type AddableTeamRole,
  type RoleCounts,
  type SubjectError,
  type TeamRole,
  type TeamRolesSettings,
} from '@ligo/core';
import { listSeasonTeams, schema, type Db, type SeasonTeam, type Tx } from '@ligo/db';
import { and, eq, isNull } from 'drizzle-orm';
import { requireStaff, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';

// Who acts for a team: one owner, and the managers and coaches the league allows (maintainer,
// 13 November 2026). League staff change it directly here; teams ask through requests, which
// apply the same change once approved (services/requests.ts).

const { auditLog, player, teamStaff } = schema;

export type { TeamRole };

export interface TeamMember {
  playerId: number;
  discordUserId: string | null;
  displayName: string;
  role: TeamRole;
}

/** A Discord member picked in a command. */
export interface MemberRef {
  id: string;
  displayName: string;
}

export type TeamStaffError =
  | 'not_linked'
  | 'not_staff'
  | 'no_season'
  | 'team_not_found'
  | 'already_on_team'
  | 'not_on_team'
  | 'owner_cannot_leave';

export type TeamStaffReply =
  | { ok: true; team: SeasonTeam; members: TeamMember[] }
  | { ok: false; error: TeamStaffError }
  | { ok: false; error: 'role_full'; max: number };

const roleOrder = (role: TeamRole) => TEAM_ROLES.indexOf(role);

/** The people currently acting for a team: its owner, then managers, then coaches, by seniority. */
export function listTeamStaff(db: Pick<Db, 'select'>, teamId: number): TeamMember[] {
  return db
    .select({
      playerId: player.id,
      discordUserId: player.discordUserId,
      displayName: player.displayName,
      role: teamStaff.role,
      since: teamStaff.since,
    })
    .from(teamStaff)
    .innerJoin(player, eq(teamStaff.playerId, player.id))
    .where(and(eq(teamStaff.teamId, teamId), isNull(teamStaff.until)))
    .all()
    .sort((x, y) => roleOrder(x.role) - roleOrder(y.role) || x.since - y.since)
    .map((row) => ({
      playerId: row.playerId,
      discordUserId: row.discordUserId,
      displayName: row.displayName,
      role: row.role,
    }));
}

export function roleCounts(members: readonly TeamMember[]): RoleCounts {
  const counts: RoleCounts = { owner: 0, manager: 0, coach: 0 };
  for (const member of members) counts[member.role] += 1;
  return counts;
}

/** A change to who acts for a team, about one player. */
export type TeamStaffChange =
  | { kind: 'team_owner'; playerId: number }
  | { kind: 'team_member_add'; playerId: number; role: AddableTeamRole }
  | { kind: 'team_member_remove'; playerId: number };

/**
 * Whether the change fits the team as it is now and the league's limits. League staff may also
 * remove an owner (`byStaff`), for example one banned by the league; a team cannot.
 */
export function checkStaffChange(
  db: Pick<Db, 'select'>,
  teamId: number,
  change: TeamStaffChange,
  limits: TeamRolesSettings,
  byStaff = false,
): { ok: true; members: TeamMember[] } | SubjectError {
  const members = listTeamStaff(db, teamId);
  const subjectRole = members.find((member) => member.playerId === change.playerId)?.role ?? null;
  if (byStaff && change.kind === 'team_member_remove' && subjectRole === 'owner') {
    return { ok: true, members };
  }
  const checked = checkTeamChange({ ...change, subjectRole }, roleCounts(members), limits);
  return checked.ok ? { ok: true, members } : checked;
}

const endRole = (tx: Tx, teamId: number, playerId: number, now: number) =>
  tx
    .update(teamStaff)
    .set({ until: now })
    .where(
      and(eq(teamStaff.teamId, teamId), eq(teamStaff.playerId, playerId), isNull(teamStaff.until)),
    )
    .run();

const AUDIT_ACTIONS = {
  team_owner: 'team.owner.set',
  team_member_add: 'team.member.add',
  team_member_remove: 'team.member.remove',
} as const;

/**
 * Applies a change already checked with `checkStaffChange`, with its audit entry, in the
 * caller's transaction. A new owner replaces the previous one, who leaves the team's staff, and
 * leaves any other role they held on the team.
 */
export function applyStaffChange(
  tx: Tx,
  teamId: number,
  change: TeamStaffChange,
  by: { playerId: number | null; kind: 'user' | 'system'; requestId?: number },
  now: number,
): TeamMember[] {
  const before = listTeamStaff(tx, teamId);
  if (change.kind === 'team_owner') {
    for (const member of before) {
      if (member.role === 'owner' || member.playerId === change.playerId) {
        endRole(tx, teamId, member.playerId, now);
      }
    }
  } else if (change.kind === 'team_member_remove') {
    endRole(tx, teamId, change.playerId, now);
  }
  if (change.kind !== 'team_member_remove') {
    const role = change.kind === 'team_owner' ? 'owner' : change.role;
    tx.insert(teamStaff).values({ teamId, playerId: change.playerId, role, since: now }).run();
  }
  const after = listTeamStaff(tx, teamId);
  const names = (members: TeamMember[]) =>
    members.map((member) => ({ playerId: member.playerId, role: member.role }));
  tx.insert(auditLog)
    .values({
      actorPlayerId: by.playerId,
      actorKind: by.kind,
      action: AUDIT_ACTIONS[change.kind],
      entity: 'team',
      entityId: String(teamId),
      beforeJson: { staff: names(before) },
      afterJson: {
        staff: names(after),
        ...(by.requestId === undefined ? {} : { requestId: by.requestId }),
      },
      at: now,
    })
    .run();
  return after;
}

/** League staff acting on a team of the current season: the checks every change starts with. */
function open(db: Pick<Db, 'select'>, actor: Actor, teamId: number) {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const { league } = staff;
  if (!league.season) return { ok: false as const, error: 'no_season' as const };
  const team = listSeasonTeams(db, league.season.id).find(
    (candidate) => candidate.teamId === teamId,
  );
  // A team of another league is reported as missing, like an unknown one.
  if (!team) return { ok: false as const, error: 'team_not_found' as const };
  return { ok: true as const, league, team };
}

export type DirectChange =
  | { kind: 'team_owner'; member: MemberRef }
  | { kind: 'team_member_add'; member: MemberRef; role: AddableTeamRole }
  | { kind: 'team_member_remove'; member: MemberRef };

/**
 * League staff change who acts for a team directly, without a request: when they are already in
 * the discussion with the team, or to correct a mistake. Audited like an approved request.
 */
export function changeTeamStaff(
  db: Db,
  actor: Actor,
  request: { teamId: number; change: DirectChange },
  now: number,
): TeamStaffReply {
  const opened = open(db, actor, request.teamId);
  if (!opened.ok) return opened;
  const { league, team } = opened;
  const { change } = request;

  return db.transaction((tx): TeamStaffReply => {
    const orgId = league.org.id;
    let playerId: number;
    if (change.kind === 'team_member_remove') {
      // Someone the team never had is not created just to be refused.
      const found = listTeamStaff(tx, team.teamId).find(
        (member) => member.discordUserId === change.member.id,
      );
      if (!found) return { ok: false, error: 'not_on_team' };
      playerId = found.playerId;
    } else {
      playerId = ensurePlayer(
        tx,
        { orgId, discordUserId: change.member.id, displayName: change.member.displayName },
        now,
      ).id;
    }
    const staffChange: TeamStaffChange =
      change.kind === 'team_member_add'
        ? { kind: change.kind, playerId, role: change.role }
        : { kind: change.kind, playerId };
    const limits = league.competition.rulesetJson.team_roles;
    const checked = checkStaffChange(tx, team.teamId, staffChange, limits, true);
    if (!checked.ok) return checked;
    const by = ensurePlayer(
      tx,
      { orgId, discordUserId: actor.user.id, displayName: actor.user.displayName },
      now,
    ).id;
    const members = applyStaffChange(
      tx,
      team.teamId,
      staffChange,
      { playerId: by, kind: 'user' },
      now,
    );
    return { ok: true, team, members };
  });
}

type Direct<T> = (
  db: Db,
  actor: Actor,
  request: { teamId: number; member: MemberRef } & T,
  now: number,
) => TeamStaffReply;

/** League staff make a member the team's owner; the previous owner leaves the team's staff. */
export const setTeamOwner: Direct<object> = (db, actor, { teamId, member }, now) =>
  changeTeamStaff(db, actor, { teamId, change: { kind: 'team_owner', member } }, now);

/** League staff add a manager or a coach to a team, within the league's limits. */
export const addTeamMember: Direct<{ role: AddableTeamRole }> = (db, actor, request, now) =>
  changeTeamStaff(
    db,
    actor,
    {
      teamId: request.teamId,
      change: { kind: 'team_member_add', member: request.member, role: request.role },
    },
    now,
  );

/** League staff end someone's role on a team, the owner's included. The row keeps its end date. */
export const removeTeamMember: Direct<object> = (db, actor, { teamId, member }, now) =>
  changeTeamStaff(db, actor, { teamId, change: { kind: 'team_member_remove', member } }, now);

/** Who acts for a team, for league staff to check. */
export function showTeamStaff(db: Db, actor: Actor, teamId: number): TeamStaffReply {
  const opened = open(db, actor, teamId);
  if (!opened.ok) return opened;
  return { ok: true, team: opened.team, members: listTeamStaff(db, opened.team.teamId) };
}

/** The current season's teams whose name or tag starts like what league staff typed. */
export function searchTeams(
  db: Pick<Db, 'select'>,
  actor: Pick<Actor, 'guildId' | 'memberRoleIds'>,
  query: string,
  limit: number,
): SeasonTeam[] {
  const staff = requireStaff(db, actor);
  if (!staff.ok || !staff.league.season) return [];
  return filterTeams(listSeasonTeams(db, staff.league.season.id), query, limit);
}

/** The teams whose name, tag or division start like the words typed. */
export function filterTeams(
  teams: readonly SeasonTeam[],
  query: string,
  limit: number,
): SeasonTeam[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return teams
    .filter((team) => {
      const tokens = `${team.name} ${team.tag} ${team.division}`.toLowerCase().split(/\s+/);
      return words.every((word) => tokens.some((token) => token.startsWith(word)));
    })
    .slice(0, limit);
}
