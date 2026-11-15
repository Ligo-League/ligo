import { mayFile, teamRolesSchema, type FilingError, type SubjectError } from '@ligo/core';
import { findRoster, schema, type Db } from '@ligo/db';
import { and, desc, eq, ne } from 'drizzle-orm';
import { highestRole, teamsOfPlayer } from './permissions.ts';
import { ensurePlayer } from './players.ts';
import {
  applyStaffChange,
  checkStaffChange,
  listTeamStaff,
  type DirectChange,
  type TeamMember,
  type TeamStaffChange,
} from './team-staff.ts';

// `/teams/:slug/manage`: the website's `/team`, for one roster. It acts in the league the roster
// plays in now, as `/team` does in that league's Discord server.

export interface ManagedRoster {
  teamId: number;
  name: string;
  tag: string;
  slug: string;
  clubSlug: string;
  /**
   * The competition of the latest season the roster has a place in, registration aside; null
   * for a roster in no competition yet (M-33), whose officials change it themselves.
   */
  competitionId: number | null;
  orgId: number;
}

/**
 * The roster of that slug and the competition it plays in, or null when there is no such
 * roster. A roster with no place in any season is in no competition. One whose only place is in
 * a season still in registration has no league to act in yet (`/team` acts on the league's
 * current season): it is not found here, until its season starts.
 */
export function rosterToManage(db: Pick<Db, 'select'>, slug: string): ManagedRoster | null {
  const roster = findRoster(db, { slug });
  if (!roster) return null;
  const { division, season, slot } = schema;
  const place = db
    .select({ competitionId: season.competitionId })
    .from(slot)
    .innerJoin(division, eq(slot.divisionId, division.id))
    .innerJoin(season, eq(division.seasonId, season.id))
    .where(and(eq(slot.teamId, roster.teamId), ne(season.status, 'registration')))
    .orderBy(desc(season.startsOn), desc(season.id))
    .get();
  const orgId =
    db
      .select({ orgId: schema.team.orgId })
      .from(schema.team)
      .where(eq(schema.team.id, roster.teamId))
      .get()?.orgId ?? 0;
  const base = {
    teamId: roster.teamId,
    clubSlug: roster.club.slug,
    name: roster.name,
    tag: roster.tag,
    slug: roster.slug,
    orgId,
  };
  if (place) return { ...base, competitionId: place.competitionId };
  const anySlot = db.select({ id: slot.id }).from(slot).where(eq(slot.teamId, roster.teamId)).get();
  return anySlot ? null : { ...base, competitionId: null };
}

export type FreeChangeError = 'not_free' | 'not_official' | FilingError | SubjectError['error'];

export type FreeChangeReply =
  | { ok: true; members: TeamMember[] }
  | { ok: false; error: FreeChangeError }
  | { ok: false; error: 'role_full'; max: number };

/**
 * A roster in no competition has no league staff to answer requests: its officials change it
 * at once, within the same rules as a request (`mayFile`) and the default limits of a roster's
 * officials, with the group's for club managers. `member` null is the official leaving.
 */
export function changeFreeRoster(
  db: Db,
  by: { playerId: number },
  roster: ManagedRoster,
  change: DirectChange | { kind: 'team_member_remove'; member: null },
  now: number,
): FreeChangeReply {
  if (roster.competitionId !== null) return { ok: false, error: 'not_free' };
  const filerRole = highestRole(teamsOfPlayer(db, by.playerId), roster.teamId);
  if (filerRole === null) return { ok: false, error: 'not_official' };
  const group = db.select().from(schema.org).where(eq(schema.org.id, roster.orgId)).get();
  if (!group) return { ok: false, error: 'not_free' };
  const limits = {
    ...teamRolesSchema.parse({}),
    club_managers_max: group.settingsJson.club_roles.managers_max,
  };

  return db.transaction((tx): FreeChangeReply => {
    let playerId: number;
    if (change.member === null) {
      playerId = by.playerId;
    } else if (change.kind === 'team_member_remove') {
      // Someone the roster never had is not created just to be refused.
      const found = listTeamStaff(tx, roster.teamId).find(
        (member) => member.discordUserId === change.member.id,
      );
      if (!found) return { ok: false, error: 'not_on_team' };
      playerId = found.playerId;
    } else {
      playerId = ensurePlayer(
        tx,
        {
          orgId: roster.orgId,
          discordUserId: change.member.id,
          displayName: change.member.displayName,
        },
        now,
      ).id;
    }
    const self = playerId === by.playerId;
    const role = change.kind === 'team_member_add' ? change.role : null;
    const allowed = mayFile(change.kind, filerRole, self, role);
    if (!allowed.ok) return allowed;
    const staffChange: TeamStaffChange =
      change.kind === 'team_member_add'
        ? { kind: change.kind, playerId, role: change.role }
        : { kind: change.kind, playerId };
    const checked = checkStaffChange(tx, roster.teamId, staffChange, limits);
    if (!checked.ok) return checked;
    const members = applyStaffChange(
      tx,
      roster.teamId,
      staffChange,
      { playerId: by.playerId, kind: 'user' },
      now,
    );
    return { ok: true, members };
  });
}
