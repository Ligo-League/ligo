import {
  mayManagePlayers,
  windowOpenAt,
  type LineupPlace,
  type MercatoSettings,
  type RegistrationRole,
} from '@ligo/core';
import { schema, type Db, type RosterMovePayload } from '@ligo/db';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { highestRole, requireStaff, teamsActedFor, type Actor } from './permissions.ts';

// What a roster's mercato moves are read from (design doc section 7; O-35): its season under
// way, its lineup, its own players, the season's windows and the moves already filed. Shared by
// filing (`roster-moves.ts`) and deciding (`roster-move-apply.ts`).

const { auditLog, competition, division, mercatoWindow, player, request, rosterEntry } = schema;
const { rosterPlayer, season, slot, team } = schema;

export type Reader = Pick<Db, 'select'>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** The season under way the roster plays, with its competition. */
export function seasonOf(db: Reader, teamId: number) {
  return db
    .select({ season, competition })
    .from(slot)
    .innerJoin(division, eq(slot.divisionId, division.id))
    .innerJoin(season, eq(division.seasonId, season.id))
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .where(and(eq(slot.teamId, teamId), inArray(season.status, ['active', 'cup'])))
    .orderBy(desc(season.startsOn), desc(season.id))
    .get();
}
export type MoveSeason = NonNullable<ReturnType<typeof seasonOf>>;

/** Who acts on a roster's moves: league staff of its competition, or an official who manages its players. */
export function accessOf(
  db: Reader,
  actor: Actor,
  teamId: number,
  found: MoveSeason,
): { playerId: number | null; staff: boolean } | null {
  const staff = requireStaff(db, actor);
  const acting = teamsActedFor(db, actor);
  if (staff.ok && staff.league.competition.id === found.competition.id) {
    return { playerId: acting.playerId, staff: true };
  }
  const role = highestRole(acting.teams, teamId);
  if (acting.playerId === null || role === null || !mayManagePlayers(role)) return null;
  return { playerId: acting.playerId, staff: false };
}

export interface LineupMember extends LineupPlace {
  name: string;
  /** When the player may start playing, if not yet: the block after their move (O-35). */
  startsAt: number | null;
}

/** The roster's lineup for the season, blocked incoming players included. */
export function lineupOf(
  db: Reader,
  seasonId: number,
  teamId: number,
  now: number,
): LineupMember[] {
  return db
    .select({
      playerId: rosterEntry.playerId,
      name: player.displayName,
      role: rosterEntry.role,
      captain: rosterEntry.captain,
      validFrom: rosterEntry.validFrom,
    })
    .from(rosterEntry)
    .innerJoin(player, eq(rosterEntry.playerId, player.id))
    .where(
      and(
        eq(rosterEntry.seasonId, seasonId),
        eq(rosterEntry.teamId, teamId),
        isNull(rosterEntry.validTo),
      ),
    )
    .orderBy(asc(rosterEntry.role), asc(player.displayName))
    .all()
    .flatMap((row) =>
      // A coach left in an old lineup is no player of it.
      row.role === 'coach'
        ? []
        : [
            {
              playerId: row.playerId,
              name: row.name,
              role: row.role,
              captain: row.captain,
              startsAt: row.validFrom > now ? row.validFrom : null,
            },
          ],
    );
}

/** The season's window open at `at`, if any. */
export function windowAt(db: Reader, seasonId: number, at: number) {
  return (
    db
      .select()
      .from(mercatoWindow)
      .where(eq(mercatoWindow.seasonId, seasonId))
      .all()
      .find((row) => windowOpenAt(row, at)) ?? null
  );
}

/** The season's next window still to come, if any. */
export function nextWindow(db: Reader, seasonId: number, now: number) {
  return (
    db
      .select()
      .from(mercatoWindow)
      .where(and(eq(mercatoWindow.seasonId, seasonId), isNull(mercatoWindow.closedEarlyAt)))
      .orderBy(asc(mercatoWindow.opensAt))
      .all()
      .find((row) => row.opensAt > now) ?? null
  );
}

export type MoveRow = typeof request.$inferSelect & { payloadJson: RosterMovePayload };
const isMovePayload = (payload: unknown): payload is RosterMovePayload =>
  typeof payload === 'object' && payload !== null && 'counted' in payload;

/** The roster's moves of the season, latest first. */
export function movesOf(db: Reader, seasonId: number, teamId: number): MoveRow[] {
  return db
    .select()
    .from(request)
    .where(
      and(
        eq(request.kind, 'roster_move'),
        eq(request.seasonId, seasonId),
        eq(request.teamId, teamId),
      ),
    )
    .orderBy(desc(request.requestedAt), desc(request.id))
    .all()
    .flatMap((row) =>
      isMovePayload(row.payloadJson) ? [{ ...row, payloadJson: row.payloadJson }] : [],
    );
}

/**
 * The roster's counted moves pending or approved: in the window when the league has windows, in
 * the season when its mercato is always open. `except` leaves a move out, to check it again.
 */
export function countedMoves(
  moves: readonly MoveRow[],
  settings: MercatoSettings,
  windowId: number | null,
  except: number | null = null,
): number {
  return moves.filter(
    (row) =>
      row.id !== except &&
      (row.status === 'pending' || row.status === 'approved') &&
      row.payloadJson.counted &&
      (settings.mode === 'open' || row.payloadJson.windowId === windowId),
  ).length;
}

/** The other roster of the competition whose lineup a player is in this season, if any. */
export function sourceOf(db: Reader, seasonId: number, playerId: number, teamId: number) {
  const here = db.select({ clubId: team.clubId }).from(team).where(eq(team.id, teamId)).get();
  const other = db
    .select({ teamId: rosterEntry.teamId, clubId: team.clubId, name: team.name })
    .from(rosterEntry)
    .innerJoin(team, eq(rosterEntry.teamId, team.id))
    .where(
      and(
        eq(rosterEntry.seasonId, seasonId),
        eq(rosterEntry.playerId, playerId),
        isNull(rosterEntry.validTo),
      ),
    )
    .all()
    .find((row) => row.teamId !== teamId);
  return other
    ? { teamId: other.teamId, name: other.name, sameClub: other.clubId === here?.clubId }
    : null;
}

/** The roster's own players now (M-33). */
export function rosterPlayerIds(db: Reader, teamId: number): number[] {
  return db
    .select({ playerId: rosterPlayer.playerId })
    .from(rosterPlayer)
    .where(and(eq(rosterPlayer.teamId, teamId), isNull(rosterPlayer.leftAt)))
    .all()
    .map((row) => row.playerId);
}

export const nameOf = (db: Reader, playerId: number) =>
  db.select({ name: player.displayName }).from(player).where(eq(player.id, playerId)).get()?.name ??
  '?';
export const teamNameOf = (db: Reader, teamId: number) =>
  db.select({ name: team.name }).from(team).where(eq(team.id, teamId)).get()?.name ?? '?';

export interface MoveView {
  id: number;
  out: { playerId: number; name: string } | null;
  in: { playerId: number; name: string; role: RegistrationRole } | null;
  /** The roster the incoming player leaves, when a transfer. */
  from: string | null;
  counted: boolean;
  status: (typeof request.$inferSelect)['status'];
  requestedAt: number;
  requester: string;
  note: string | null;
  /** Why staff made it, for a staff exception (O-35). */
  exceptionReason: string | null;
  reason: string | null;
}

export function viewOf(db: Reader, row: MoveRow): MoveView {
  const payload = row.payloadJson;
  return {
    id: row.id,
    out:
      payload.outId === null ? null : { playerId: payload.outId, name: nameOf(db, payload.outId) },
    in: payload.in === null ? null : { ...payload.in, name: nameOf(db, payload.in.playerId) },
    from: payload.fromTeamId === null ? null : teamNameOf(db, payload.fromTeamId),
    counted: payload.counted,
    status: row.status,
    requestedAt: row.requestedAt,
    requester: nameOf(db, row.requestedBy),
    note: row.note,
    exceptionReason: payload.exceptionReason,
    reason: row.reason,
  };
}

export function auditMove(
  tx: Tx,
  action: string,
  requestId: number,
  by: number,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  now: number,
): void {
  tx.insert(auditLog)
    .values({
      actorPlayerId: by,
      actorKind: 'user',
      action,
      entity: 'request',
      entityId: String(requestId),
      beforeJson: before,
      afterJson: after,
      at: now,
    })
    .run();
}

/** An approved move, as the team and season pages show it. */
export interface PublicMove {
  at: number;
  team: { name: string; slug: string };
  move: MoveView;
}

/**
 * The season's approved moves, latest first: all of them, or those of one roster, the moves
 * that took one of its players included. Their reasons stay off public pages: a reason can
 * accuse a player.
 */
export function seasonMoves(db: Reader, seasonId: number, teamId: number | null): PublicMove[] {
  return db
    .select({ request, team: { name: team.name, slug: team.slug } })
    .from(request)
    .innerJoin(team, eq(request.teamId, team.id))
    .where(
      and(
        eq(request.kind, 'roster_move'),
        eq(request.seasonId, seasonId),
        eq(request.status, 'approved'),
      ),
    )
    .orderBy(desc(request.decidedAt), desc(request.id))
    .all()
    .flatMap((row) => {
      const payload = row.request.payloadJson;
      if (!isMovePayload(payload)) return [];
      if (teamId !== null && row.request.teamId !== teamId && payload.fromTeamId !== teamId) {
        return [];
      }
      return [
        {
          at: row.request.decidedAt ?? row.request.requestedAt,
          team: row.team,
          move: viewOf(db, { ...row.request, payloadJson: payload }),
        },
      ];
    });
}
