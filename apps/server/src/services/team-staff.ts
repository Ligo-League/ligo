import {
  checkTeamChange,
  roleLevel,
  TEAM_ROLES,
  type AddableTeamRole,
  type RoleCounts,
  type RoleLimits,
  type SubjectError,
  type TeamRole,
} from '@ligo/core';
import {
  listLeagueMatches,
  listSeasonTeams,
  schema,
  type Db,
  type League,
  type SeasonTeam,
  type Tx,
} from '@ligo/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { requireStaff, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';

// Who acts for a team, at two levels (maintainer, 13 and 14 November 2026): the club's owner and
// managers, for every roster of the club, and each roster's managers and coaches. Everything here
// takes a roster: its club's officials come with it. League staff change it directly here; teams
// ask through requests, which apply the same change once approved (services/requests.ts).

const { auditLog, clubStaff, player, team: teamTable, teamStaff } = schema;

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

/** The club a roster belongs to. */
function clubOf(db: Pick<Db, 'select'>, teamId: number): number {
  const row = db
    .select({ clubId: teamTable.clubId })
    .from(teamTable)
    .where(eq(teamTable.id, teamId))
    .get();
  // Every roster has a club; callers pass a roster they have just read.
  if (!row) throw new Error(`Team ${String(teamId)} not found`);
  return row.clubId;
}

/**
 * The people currently acting for a roster: its club's owner and managers, then its own managers
 * and coaches, each by seniority.
 */
export function listTeamStaff(db: Pick<Db, 'select'>, teamId: number): TeamMember[] {
  const person = {
    playerId: player.id,
    discordUserId: player.discordUserId,
    displayName: player.displayName,
  };
  const club = db
    .select({ ...person, role: clubStaff.role, since: clubStaff.since })
    .from(clubStaff)
    .innerJoin(player, eq(clubStaff.playerId, player.id))
    .innerJoin(teamTable, eq(teamTable.clubId, clubStaff.clubId))
    .where(and(eq(teamTable.id, teamId), isNull(clubStaff.until)))
    .all()
    .map((row) => ({ ...row, role: row.role === 'owner' ? ('owner' as const) : 'club_manager' }));
  const roster = db
    .select({ ...person, role: teamStaff.role, since: teamStaff.since })
    .from(teamStaff)
    .innerJoin(player, eq(teamStaff.playerId, player.id))
    // 'owner' rows are history from before clubs: the owner is the club's now.
    .where(
      and(
        eq(teamStaff.teamId, teamId),
        isNull(teamStaff.until),
        inArray(teamStaff.role, ['manager', 'coach']),
      ),
    )
    .all();
  return [...club, ...roster]
    .map((row) => ({ ...row, role: row.role as TeamRole }))
    .sort((x, y) => roleOrder(x.role) - roleOrder(y.role) || x.since - y.since)
    .map((row) => ({
      playerId: row.playerId,
      discordUserId: row.discordUserId,
      displayName: row.displayName,
      role: row.role,
    }));
}

export function roleCounts(members: readonly TeamMember[]): RoleCounts {
  const counts: RoleCounts = { owner: 0, club_manager: 0, manager: 0, coach: 0 };
  for (const member of members) counts[member.role] += 1;
  return counts;
}

/** The league's limits for a roster's officials, and the group's for a club's managers. */
export function roleLimits(league: Pick<League, 'org' | 'competition'>): RoleLimits {
  return {
    ...league.competition.rulesetJson.team_roles,
    club_managers_max: league.org.settingsJson.club_roles.managers_max,
  };
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
  limits: RoleLimits,
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

/** Ends every role the player holds in the club, or on the roster only. */
function endRoles(
  tx: Tx,
  where: { clubId: number } | { teamId: number },
  playerId: number,
  now: number,
): void {
  if ('clubId' in where) {
    tx.update(clubStaff)
      .set({ until: now })
      .where(
        and(
          eq(clubStaff.clubId, where.clubId),
          eq(clubStaff.playerId, playerId),
          isNull(clubStaff.until),
        ),
      )
      .run();
    const rosters = tx
      .select({ id: teamTable.id })
      .from(teamTable)
      .where(eq(teamTable.clubId, where.clubId))
      .all()
      .map((row) => row.id);
    if (rosters.length === 0) return;
    tx.update(teamStaff)
      .set({ until: now })
      .where(
        and(
          inArray(teamStaff.teamId, rosters),
          eq(teamStaff.playerId, playerId),
          isNull(teamStaff.until),
        ),
      )
      .run();
    return;
  }
  tx.update(teamStaff)
    .set({ until: now })
    .where(
      and(
        eq(teamStaff.teamId, where.teamId),
        eq(teamStaff.playerId, playerId),
        isNull(teamStaff.until),
      ),
    )
    .run();
}

const AUDIT_ACTIONS = {
  team_owner: 'team.owner.set',
  team_member_add: 'team.member.add',
  team_member_remove: 'team.member.remove',
} as const;

/** Whether the change is the club's: its owner, or one of its managers. */
function atClub(change: TeamStaffChange, subjectRole: TeamRole | null): boolean {
  if (change.kind === 'team_owner') return true;
  if (change.kind === 'team_member_add') return roleLevel(change.role) === 'club';
  return subjectRole !== null && roleLevel(subjectRole) === 'club';
}

/**
 * Applies a change already checked with `checkStaffChange`, with its audit entry, in the
 * caller's transaction. A new owner replaces the club's previous one, who leaves the club, and
 * leaves any other role they held in the club. A change to the club is audited on the club.
 */
export function applyStaffChange(
  tx: Tx,
  teamId: number,
  change: TeamStaffChange,
  by: { playerId: number | null; kind: 'user' | 'system'; requestId?: number },
  now: number,
): TeamMember[] {
  const clubId = clubOf(tx, teamId);
  const before = listTeamStaff(tx, teamId);
  const subjectRole = before.find((member) => member.playerId === change.playerId)?.role ?? null;
  const club = atClub(change, subjectRole);
  if (change.kind === 'team_owner') {
    const previous = before.filter((member) => member.role === 'owner');
    for (const playerId of new Set([...previous.map((m) => m.playerId), change.playerId])) {
      endRoles(tx, { clubId }, playerId, now);
    }
    tx.insert(clubStaff)
      .values({ clubId, playerId: change.playerId, role: 'owner', since: now })
      .run();
  } else if (change.kind === 'team_member_remove') {
    endRoles(tx, club ? { clubId } : { teamId }, change.playerId, now);
  } else if (change.role === 'club_manager') {
    tx.insert(clubStaff)
      .values({ clubId, playerId: change.playerId, role: 'manager', since: now })
      .run();
  } else {
    tx.insert(teamStaff)
      .values({ teamId, playerId: change.playerId, role: change.role, since: now })
      .run();
  }
  const after = listTeamStaff(tx, teamId);
  const names = (members: TeamMember[]) =>
    members.map((member) => ({ playerId: member.playerId, role: member.role }));
  tx.insert(auditLog)
    .values({
      actorPlayerId: by.playerId,
      actorKind: by.kind,
      action: AUDIT_ACTIONS[change.kind],
      entity: club ? 'club' : 'team',
      entityId: String(club ? clubId : teamId),
      beforeJson: { staff: names(before) },
      afterJson: {
        staff: names(after),
        ...(club ? { teamId } : {}),
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
    const checked = checkStaffChange(tx, team.teamId, staffChange, roleLimits(league), true);
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

/**
 * The Discord users told about a team's match, such as a time proposed to it: its officials and
 * its captain for the match's season (M-19), once each.
 */
export function teamMentions(
  db: Pick<Db, 'select'>,
  teamId: number,
  seasonId: number,
  /** The match it is about: its captain for that match, if named, is mentioned too (O-30b). */
  matchId?: number,
): string[] {
  const { matchCaptain, rosterEntry } = schema;
  const captains = db
    .select({ discordUserId: player.discordUserId })
    .from(rosterEntry)
    .innerJoin(player, eq(rosterEntry.playerId, player.id))
    .where(
      and(
        eq(rosterEntry.teamId, teamId),
        eq(rosterEntry.seasonId, seasonId),
        eq(rosterEntry.captain, true),
        isNull(rosterEntry.validTo),
      ),
    )
    .all();
  const standIns =
    matchId === undefined
      ? []
      : db
          .select({ discordUserId: player.discordUserId, side: matchCaptain.side })
          .from(matchCaptain)
          .innerJoin(player, eq(matchCaptain.playerId, player.id))
          .where(eq(matchCaptain.matchId, matchId))
          .all()
          .filter(({ side }) => listLeagueMatches(db, { matchId })[0]?.[side].teamId === teamId);
  const ids = [...listTeamStaff(db, teamId), ...captains, ...standIns].flatMap(
    (row) => row.discordUserId ?? [],
  );
  return [...new Set(ids)];
}

/** `teamMentions` for both sides of a match, such as when its veto starts. */
export function matchMentions(
  db: Pick<Db, 'select'>,
  found: { id: number; seasonId: number; a: { teamId: number }; b: { teamId: number } },
): string[] {
  return [
    ...new Set([
      ...teamMentions(db, found.a.teamId, found.seasonId, found.id),
      ...teamMentions(db, found.b.teamId, found.seasonId, found.id),
    ]),
  ];
}
