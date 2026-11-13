import { listSeasonTeams, schema, type Db, type SeasonTeam, type Tx } from '@ligo/db';
import { and, eq, isNull } from 'drizzle-orm';
import { requireStaff, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';

const { auditLog, player, teamStaff } = schema;

export type TeamRole = 'manager' | 'staff';

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
  'not_linked' | 'not_staff' | 'no_season' | 'team_not_found' | 'already_on_team' | 'not_on_team';

export type TeamStaffReply =
  | { ok: true; team: SeasonTeam; members: TeamMember[] }
  | { ok: false; error: TeamStaffError }
  | { ok: false; error: 'staff_full'; max: number };

/** The people currently acting for a team: its manager first, then its staff by seniority. */
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
    .sort(
      (x, y) => Number(y.role === 'manager') - Number(x.role === 'manager') || x.since - y.since,
    )
    .map((row) => ({
      playerId: row.playerId,
      discordUserId: row.discordUserId,
      displayName: row.displayName,
      role: row.role,
    }));
}

/** League staff acting on a team of the current season: the checks every change starts with. */
function open(db: Db, actor: Actor, teamId: number) {
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

function audit(
  tx: Tx,
  action: string,
  staffPlayerId: number,
  teamId: number,
  before: TeamMember[],
  now: number,
): void {
  const names = (members: TeamMember[]) =>
    members.map((member) => ({ playerId: member.playerId, role: member.role }));
  tx.insert(auditLog)
    .values({
      actorPlayerId: staffPlayerId,
      actorKind: 'user',
      action,
      entity: 'team',
      entityId: String(teamId),
      beforeJson: { staff: names(before) },
      afterJson: { staff: names(listTeamStaff(tx, teamId)) },
      at: now,
    })
    .run();
}

const endRole = (tx: Tx, teamId: number, playerId: number, now: number) =>
  tx
    .update(teamStaff)
    .set({ until: now })
    .where(
      and(eq(teamStaff.teamId, teamId), eq(teamStaff.playerId, playerId), isNull(teamStaff.until)),
    )
    .run();

/**
 * Makes a member the manager of a team. A team has one manager: the previous one stops being
 * manager, and a staff member who is promoted leaves the staff list.
 */
export function setTeamManager(
  db: Db,
  actor: Actor,
  request: { teamId: number; member: MemberRef },
  now: number,
): TeamStaffReply {
  const opened = open(db, actor, request.teamId);
  if (!opened.ok) return opened;
  const { league, team } = opened;

  return db.transaction((tx): TeamStaffReply => {
    const before = listTeamStaff(tx, team.teamId);
    const member = ensurePlayer(
      tx,
      {
        orgId: league.org.id,
        discordUserId: request.member.id,
        displayName: request.member.displayName,
      },
      now,
    );
    const current = before.find((candidate) => candidate.playerId === member.id);
    if (current?.role === 'manager') return { ok: false, error: 'already_on_team' };

    for (const candidate of before) {
      if (candidate.role === 'manager' || candidate.playerId === member.id) {
        endRole(tx, team.teamId, candidate.playerId, now);
      }
    }
    tx.insert(teamStaff)
      .values({ teamId: team.teamId, playerId: member.id, role: 'manager', since: now })
      .run();

    audit(
      tx,
      'team.manager.set',
      staffPlayerId(tx, league.org.id, actor, now),
      team.teamId,
      before,
      now,
    );
    return { ok: true, team, members: listTeamStaff(tx, team.teamId) };
  });
}

/** Adds a member to a team's staff, within the league's limit. */
export function addTeamStaff(
  db: Db,
  actor: Actor,
  request: { teamId: number; member: MemberRef },
  now: number,
): TeamStaffReply {
  const opened = open(db, actor, request.teamId);
  if (!opened.ok) return opened;
  const { league, team } = opened;
  const max = league.competition.rulesetJson.team_staff_max;

  return db.transaction((tx): TeamStaffReply => {
    const before = listTeamStaff(tx, team.teamId);
    const member = ensurePlayer(
      tx,
      {
        orgId: league.org.id,
        discordUserId: request.member.id,
        displayName: request.member.displayName,
      },
      now,
    );
    if (before.some((candidate) => candidate.playerId === member.id)) {
      return { ok: false, error: 'already_on_team' };
    }
    if (before.filter((candidate) => candidate.role === 'staff').length >= max) {
      return { ok: false, error: 'staff_full', max };
    }

    tx.insert(teamStaff)
      .values({ teamId: team.teamId, playerId: member.id, role: 'staff', since: now })
      .run();
    audit(
      tx,
      'team.staff.add',
      staffPlayerId(tx, league.org.id, actor, now),
      team.teamId,
      before,
      now,
    );
    return { ok: true, team, members: listTeamStaff(tx, team.teamId) };
  });
}

/** Ends a member's role on a team, manager or staff. The row is kept with its end date. */
export function removeTeamStaff(
  db: Db,
  actor: Actor,
  request: { teamId: number; member: MemberRef },
  now: number,
): TeamStaffReply {
  const opened = open(db, actor, request.teamId);
  if (!opened.ok) return opened;
  const { league, team } = opened;

  return db.transaction((tx): TeamStaffReply => {
    const before = listTeamStaff(tx, team.teamId);
    const member = before.find((candidate) => candidate.discordUserId === request.member.id);
    if (!member) return { ok: false, error: 'not_on_team' };

    endRole(tx, team.teamId, member.playerId, now);
    audit(
      tx,
      'team.staff.remove',
      staffPlayerId(tx, league.org.id, actor, now),
      team.teamId,
      before,
      now,
    );
    return { ok: true, team, members: listTeamStaff(tx, team.teamId) };
  });
}

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
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return listSeasonTeams(db, staff.league.season.id)
    .filter((team) => {
      const tokens = `${team.name} ${team.tag} ${team.division}`.toLowerCase().split(/\s+/);
      return words.every((word) => tokens.some((token) => token.startsWith(word)));
    })
    .slice(0, limit);
}

const staffPlayerId = (tx: Tx, orgId: number, actor: Actor, now: number) =>
  ensurePlayer(
    tx,
    { orgId, discordUserId: actor.user.id, displayName: actor.user.displayName },
    now,
  ).id;
