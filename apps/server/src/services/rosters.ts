import { randomBytes } from 'node:crypto';
import {
  mayJoinRoster,
  mayManagePlayers,
  rosterGaps,
  playsSeasonUnderWay,
  type PlayerGap,
  type RosterJoinError,
} from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { and, asc, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { inviteTokenMatches } from './invites.ts';
import { highestRole, teamsOfPlayer } from './permissions.ts';
import { profilesOf } from './profiles.ts';

// A roster's own players (M-33, M-34, maintainer, 15 November 2026). Each joins from the
// roster's invitation link with their own account and completes their own profile; they leave
// when they want, and the officials who may add officials remove them. The list stays open all
// year, as a preparation; a season's lineup (`roster_entry`) follows the mercato (M-35).

const {
  auditLog,
  division,
  org,
  player,
  registrationPlayer,
  request,
  rosterInvite,
  rosterPlayer,
  season,
  slot,
  team,
} = schema;

type Reader = Pick<Db, 'select'>;
const DAY_MS = 86_400_000;

export interface RosterRef {
  teamId: number;
  name: string;
  tag: string;
  slug: string;
  title: string;
}

/** The roster, whether its players may change now, and the group's settings for it. */
export function rosterState(db: Reader, teamId: number) {
  const row = db
    .select({ team, settings: org.settingsJson })
    .from(team)
    .innerJoin(org, eq(team.orgId, org.id))
    .where(eq(team.id, teamId))
    .get();
  if (!row) return null;
  const statuses = db
    .select({ status: season.status })
    .from(slot)
    .innerJoin(division, eq(slot.divisionId, division.id))
    .innerJoin(season, eq(division.seasonId, season.id))
    .where(eq(slot.teamId, teamId))
    .all()
    .map((entry) => entry.status);
  const ref: RosterRef = {
    teamId: row.team.id,
    name: row.team.name,
    tag: row.team.tag,
    slug: row.team.slug,
    title: row.team.title,
  };
  return {
    team: ref,
    orgId: row.team.orgId,
    /** It plays a season under way: that season's lineup is the mercato's. */
    inPlay: playsSeasonUnderWay(statuses),
    max: row.settings.rosters.players_max,
    inviteDays: row.settings.rosters.invite_days,
  };
}

export interface RosterMember {
  playerId: number;
  name: string;
  joinedAt: number;
  /** What the player still has to complete on `/me`. */
  gaps: PlayerGap[];
}

/** The roster's players now, in the order they joined. */
export function rosterMembers(db: Reader, teamId: number, title: string): RosterMember[] {
  const rows = db
    .select({
      playerId: rosterPlayer.playerId,
      name: player.displayName,
      joinedAt: rosterPlayer.joinedAt,
    })
    .from(rosterPlayer)
    .innerJoin(player, eq(rosterPlayer.playerId, player.id))
    .where(and(eq(rosterPlayer.teamId, teamId), isNull(rosterPlayer.leftAt)))
    .orderBy(asc(rosterPlayer.joinedAt), asc(rosterPlayer.id))
    .all();
  const profiles = profilesOf(
    db,
    rows.map((row) => row.playerId),
    title,
  );
  return rows.map((row) => {
    const profile = profiles.get(row.playerId);
    return { ...row, gaps: profile ? rosterGaps(profile) : ['game_account', 'nationality'] };
  });
}

/** Whether the player manages the roster's players: an official who may add officials. */
export function managesPlayers(db: Reader, playerId: number, teamId: number): boolean {
  const role = highestRole(teamsOfPlayer(db, playerId), teamId);
  return role !== null && mayManagePlayers(role);
}

/** The rosters whose players the player manages. */
export function rostersManagedBy(db: Reader, playerId: number): number[] {
  const held = teamsOfPlayer(db, playerId);
  return [...new Set(held.map((entry) => entry.teamId))].filter((teamId) => {
    const role = highestRole(held, teamId);
    return role !== null && mayManagePlayers(role);
  });
}

/** The roster's invitation in force, if any: not revoked, not expired. */
export function currentRosterInvite(db: Reader, teamId: number, now: number) {
  return (
    db
      .select()
      .from(rosterInvite)
      .where(
        and(
          eq(rosterInvite.teamId, teamId),
          isNull(rosterInvite.revokedAt),
          gt(rosterInvite.expiresAt, now),
        ),
      )
      .orderBy(desc(rosterInvite.id))
      .get() ?? null
  );
}

export type InviteReply =
  | { ok: true; invite: { id: number; nonce: string; expiresAt: number } }
  | { ok: false; error: 'not_found' | 'not_allowed' };

/**
 * The roster's invitation for its officials to share: the one in force, or a new one. `renew`
 * revokes the one in force first, so a link given to the wrong person stops working.
 */
export function rosterInviteFor(
  db: Db,
  by: { playerId: number },
  teamId: number,
  options: { renew: boolean },
  now: number,
): InviteReply {
  const state = rosterState(db, teamId);
  if (!state) return { ok: false, error: 'not_found' };
  if (!managesPlayers(db, by.playerId, teamId)) return { ok: false, error: 'not_allowed' };
  return db.transaction((tx): InviteReply => {
    const current = currentRosterInvite(tx, teamId, now);
    if (current && !options.renew) return { ok: true, invite: current };
    if (current) {
      tx.update(rosterInvite).set({ revokedAt: now }).where(eq(rosterInvite.id, current.id)).run();
    }
    const created = tx
      .insert(rosterInvite)
      .values({
        teamId,
        nonce: randomBytes(32).toString('base64url'),
        createdAt: now,
        expiresAt: now + state.inviteDays * DAY_MS,
      })
      .returning()
      .get();
    tx.insert(auditLog)
      .values({
        actorPlayerId: by.playerId,
        actorKind: 'user',
        action: current ? 'roster.invite.renew' : 'roster.invite.create',
        entity: 'team',
        entityId: String(teamId),
        afterJson: { inviteId: created.id, expiresAt: created.expiresAt },
        at: now,
      })
      .run();
    return { ok: true, invite: created };
  });
}

export interface RosterLink {
  inviteId: number;
  token: string;
  secret: string;
}

/** The roster an invitation link opens, while it is in force; null for any other link. */
function openRosterLink(db: Reader, link: RosterLink, now: number) {
  const invite = db.select().from(rosterInvite).where(eq(rosterInvite.id, link.inviteId)).get();
  if (!invite || !inviteTokenMatches(link.secret, invite, link.token, 'roster')) return null;
  if (invite.revokedAt !== null || invite.expiresAt <= now) return null;
  return rosterState(db, invite.teamId);
}

export type RosterJoinView =
  | {
      ok: true;
      team: RosterRef;
      /** Whether the player may join now, or why not. */
      verdict: { ok: true } | { ok: false; error: RosterJoinError };
      gaps: PlayerGap[];
    }
  | { ok: false; error: 'invalid_link' };

function verdictFor(
  db: Reader,
  playerId: number,
  state: NonNullable<ReturnType<typeof rosterState>>,
) {
  const members = rosterMembers(db, state.team.teamId, state.team.title);
  const profile = profilesOf(db, [playerId], state.team.title).get(playerId);
  const gaps = profile ? rosterGaps(profile) : (['game_account', 'nationality'] as PlayerGap[]);
  const verdict = mayJoinRoster({
    onRoster: members.some((member) => member.playerId === playerId),
    gaps,
    count: members.length,
    max: state.max,
  });
  return { verdict, gaps };
}

/** What a player sees on opening a roster's link: the roster, and whether they may join. */
export function rosterJoinView(
  db: Reader,
  playerId: number,
  link: RosterLink,
  now: number,
): RosterJoinView {
  const state = openRosterLink(db, link, now);
  if (!state) return { ok: false, error: 'invalid_link' };
  return { ok: true, team: state.team, ...verdictFor(db, playerId, state) };
}

export type RosterJoinReply =
  { ok: true; team: RosterRef } | { ok: false; error: RosterJoinError | 'invalid_link' };

/** A player joins a roster from its link; everything is checked again as it is written. */
export function joinRoster(
  db: Db,
  playerId: number,
  link: RosterLink,
  now: number,
): RosterJoinReply {
  return db.transaction((tx): RosterJoinReply => {
    const state = openRosterLink(tx, link, now);
    if (!state) return { ok: false, error: 'invalid_link' };
    const { verdict } = verdictFor(tx, playerId, state);
    if (!verdict.ok) return verdict;
    tx.insert(rosterPlayer).values({ teamId: state.team.teamId, playerId, joinedAt: now }).run();
    tx.insert(auditLog)
      .values({
        actorPlayerId: playerId,
        actorKind: 'user',
        action: 'roster.join',
        entity: 'team',
        entityId: String(state.team.teamId),
        afterJson: { playerId, inviteId: link.inviteId },
        at: now,
      })
      .run();
    return { ok: true, team: state.team };
  });
}

export type RosterLeaveReply = { ok: true } | { ok: false; error: 'not_found' | 'not_allowed' };

/** A player leaves a roster, or one of the officials who manage its players removes them. */
export function removeFromRoster(
  db: Db,
  by: { playerId: number },
  teamId: number,
  playerId: number,
  now: number,
): RosterLeaveReply {
  const state = rosterState(db, teamId);
  if (!state) return { ok: false, error: 'not_found' };
  const self = by.playerId === playerId;
  if (!self && !managesPlayers(db, by.playerId, teamId)) return { ok: false, error: 'not_allowed' };
  return db.transaction((tx): RosterLeaveReply => {
    const current = tx
      .select()
      .from(rosterPlayer)
      .where(
        and(
          eq(rosterPlayer.teamId, teamId),
          eq(rosterPlayer.playerId, playerId),
          isNull(rosterPlayer.leftAt),
        ),
      )
      .get();
    if (!current) return { ok: false, error: 'not_found' };
    tx.update(rosterPlayer).set({ leftAt: now }).where(eq(rosterPlayer.id, current.id)).run();
    // A player who left the roster leaves the lineups it waits to register with.
    const waiting = tx
      .select({ id: request.id })
      .from(request)
      .where(
        and(
          eq(request.teamId, teamId),
          eq(request.kind, 'registration'),
          eq(request.status, 'pending'),
        ),
      )
      .all()
      .map((row) => row.id);
    if (waiting.length > 0) {
      tx.delete(registrationPlayer)
        .where(
          and(
            inArray(registrationPlayer.requestId, waiting),
            eq(registrationPlayer.playerId, playerId),
          ),
        )
        .run();
    }
    tx.insert(auditLog)
      .values({
        actorPlayerId: by.playerId,
        actorKind: 'user',
        action: self ? 'roster.leave' : 'roster.remove',
        entity: 'team',
        entityId: String(teamId),
        beforeJson: { playerId, joinedAt: current.joinedAt },
        afterJson: waiting.length > 0 ? { registrations: waiting } : null,
        at: now,
      })
      .run();
    return { ok: true };
  });
}

/** The rosters a player plays for now, for their own page. */
export function rostersOf(db: Reader, playerId: number): RosterRef[] {
  return db
    .select({ teamId: rosterPlayer.teamId })
    .from(rosterPlayer)
    .where(and(eq(rosterPlayer.playerId, playerId), isNull(rosterPlayer.leftAt)))
    .orderBy(asc(rosterPlayer.joinedAt))
    .all()
    .flatMap((row) => {
      const state = rosterState(db, row.teamId);
      return state ? [state.team] : [];
    });
}
