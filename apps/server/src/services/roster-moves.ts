import {
  changeLineupRole,
  checkMove,
  mayManagePlayers,
  playerGaps,
  windowOpenAt,
  type LineupPlace,
  type MercatoSettings,
  type MoveError,
  type RegistrationRole,
  type RoleChange,
  type RoleChangeError,
} from '@ligo/core';
import { schema, type Db, type RosterMovePayload } from '@ligo/db';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { highestRole, requireStaff, teamsActedFor, type Actor } from './permissions.ts';
import { profilesOf } from './profiles.ts';
import { notOnServer, type MemberCheck } from './registration-players.ts';
import { lockedNow } from './registrations.ts';

// A roster's mercato moves (design doc section 7; O-35 and M-22, maintainer, 16 and 19 November
// 2026). The officials who manage the roster's players file a move, one player out, one in from
// the roster's own players, or a swap; league staff answer it (phase 3f-12). Role and captain
// changes are no moves: they apply at once and are audited. Everything is checked from the
// database at each step, with the roles Discord gives the actor now.

const { auditLog, competition, division, mercatoWindow, player, request, rosterEntry } = schema;
const { rosterPlayer, season, slot, team } = schema;

type Reader = Pick<Db, 'select'>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** The season under way the roster plays, with its competition. */
function seasonOf(db: Reader, teamId: number) {
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
type MoveSeason = NonNullable<ReturnType<typeof seasonOf>>;

/** Who acts on a roster's moves: league staff of its competition, or an official who manages its players. */
function accessOf(
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
function lineupOf(db: Reader, seasonId: number, teamId: number, now: number): LineupMember[] {
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
function windowAt(db: Reader, seasonId: number, at: number) {
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
function nextWindow(db: Reader, seasonId: number, now: number) {
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

type MoveRow = typeof request.$inferSelect & { payloadJson: RosterMovePayload };
const isMovePayload = (payload: unknown): payload is RosterMovePayload =>
  typeof payload === 'object' && payload !== null && 'counted' in payload;

/** The roster's moves of the season, latest first. */
function movesOf(db: Reader, seasonId: number, teamId: number): MoveRow[] {
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
function countedMoves(
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
function sourceOf(db: Reader, seasonId: number, playerId: number, teamId: number) {
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
function rosterPlayerIds(db: Reader, teamId: number): number[] {
  return db
    .select({ playerId: rosterPlayer.playerId })
    .from(rosterPlayer)
    .where(and(eq(rosterPlayer.teamId, teamId), isNull(rosterPlayer.leftAt)))
    .all()
    .map((row) => row.playerId);
}

const nameOf = (db: Reader, playerId: number) =>
  db.select({ name: player.displayName }).from(player).where(eq(player.id, playerId)).get()?.name ??
  '?';
const teamNameOf = (db: Reader, teamId: number) =>
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
  reason: string | null;
}

function viewOf(db: Reader, row: MoveRow): MoveView {
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
    reason: row.reason,
  };
}

export type MercatoTeamView =
  | {
      ok: true;
      team: { teamId: number; name: string; slug: string };
      season: { id: number; name: string };
      competition: { id: number; name: string };
      settings: MercatoSettings;
      timeZone: string;
      /** Before the lock, lineups change freely: no window, no count, no block. */
      lineupLocked: boolean;
      window: typeof mercatoWindow.$inferSelect | null;
      nextWindow: typeof mercatoWindow.$inferSelect | null;
      /** Whether a move can be filed now. */
      canFile: boolean;
      movesCounted: number;
      /** Null: no limit. */
      limit: number | null;
      lineup: LineupMember[];
      /** The roster's own players not in the lineup: who a move may bring in. */
      candidates: { playerId: number; name: string }[];
      moves: MoveView[];
      staff: boolean;
    }
  | { ok: false; error: 'not_found' | 'no_season' | 'not_allowed' };

/** The roster's mercato page, for league staff and the officials who manage its players. */
export function mercatoTeamView(
  db: Reader,
  actor: Actor,
  teamId: number,
  now: number,
): MercatoTeamView {
  const teamRow = db.select().from(team).where(eq(team.id, teamId)).get();
  if (!teamRow) return { ok: false, error: 'not_found' };
  const found = seasonOf(db, teamId);
  if (!found) return { ok: false, error: 'no_season' };
  const access = accessOf(db, actor, teamId, found);
  if (!access) return { ok: false, error: 'not_allowed' };
  const settings = found.competition.rulesetJson.mercato;
  const lineupLocked = lockedNow(found, now);
  const window = windowAt(db, found.season.id, now);
  const moves = movesOf(db, found.season.id, teamId);
  const lineup = lineupOf(db, found.season.id, teamId, now);
  const inLineup = new Set(lineup.map((entry) => entry.playerId));
  const candidates = rosterPlayerIds(db, teamId)
    .filter((id) => !inLineup.has(id))
    .map((playerId) => ({ playerId, name: nameOf(db, playerId) }))
    .sort((x, y) => x.name.localeCompare(y.name));
  const windowed = settings.mode === 'windows';
  return {
    ok: true,
    team: { teamId, name: teamRow.name, slug: teamRow.slug },
    season: { id: found.season.id, name: found.season.name },
    competition: { id: found.competition.id, name: found.competition.name },
    settings,
    timeZone: found.competition.schedulingJson.time_zone,
    lineupLocked,
    window,
    nextWindow: nextWindow(db, found.season.id, now),
    canFile: !lineupLocked || !windowed || window !== null || access.staff,
    movesCounted: countedMoves(moves, settings, window?.id ?? null),
    limit: windowed ? (window?.maxMovesPerTeam ?? null) : settings.max_moves_per_team,
    lineup,
    candidates,
    moves: moves.map((row) => viewOf(db, row)),
    staff: access.staff,
  };
}

export interface MoveInput {
  teamId: number;
  outId: number | null;
  in: { playerId: number; role: RegistrationRole } | null;
  note: string | null;
}

export type FileMoveError =
  | MoveError
  | 'not_found'
  | 'no_season'
  | 'not_allowed'
  | 'already_pending'
  | 'player_incomplete'
  | 'not_on_server'
  | 'discord_unavailable';

export type FileMoveReply =
  | {
      ok: true;
      move: MoveView;
      team: { teamId: number; name: string; slug: string };
      competition: { id: number; name: string };
      /** Where staff hear of it; null when the league has no staff queue. */
      queueChannelId: string | null;
    }
  | { ok: false; error: FileMoveError };

const NOTE_MAX = 500;

/**
 * Files a move for staff to answer. The rules of `checkMove` hold; the incoming player must
 * also meet the league's conditions, as at registration (profile, age, the league's Discord
 * server), and no other move of the roster waiting may concern the same players.
 */
export async function fileMove(
  db: Db,
  memberOf: MemberCheck,
  actor: Actor,
  input: MoveInput,
  now: number,
): Promise<FileMoveReply> {
  const fail = (error: FileMoveError) => ({ ok: false as const, error });
  const teamRow = db.select().from(team).where(eq(team.id, input.teamId)).get();
  if (!teamRow) return fail('not_found');
  const found = seasonOf(db, input.teamId);
  if (!found) return fail('no_season');
  const access = accessOf(db, actor, input.teamId, found);
  if (!access?.playerId) return fail('not_allowed');
  const filer = access.playerId;
  const seasonId = found.season.id;
  const { rulesetJson } = found.competition;

  const context = () => {
    const window = windowAt(db, seasonId, now);
    const moves = movesOf(db, seasonId, input.teamId);
    const source = input.in ? sourceOf(db, seasonId, input.in.playerId, input.teamId) : null;
    return { window, moves, source };
  };
  const { window, moves, source } = context();
  const concerned = [input.outId, input.in?.playerId].filter((id): id is number => id != null);
  const waiting = moves.filter((row) => row.status === 'pending');
  if (
    waiting.some((row) =>
      [row.payloadJson.outId, row.payloadJson.in?.playerId].some(
        (id) => id !== undefined && id !== null && concerned.includes(id),
      ),
    )
  ) {
    return fail('already_pending');
  }
  const verdict = checkMove(
    { outId: input.outId, in: input.in },
    {
      settings: rulesetJson.mercato,
      registration: rulesetJson.registration,
      lineupLocked: lockedNow(found, now),
      window,
      filedAt: now,
      movesCounted: countedMoves(moves, rulesetJson.mercato, window?.id ?? null),
      lineup: lineupOf(db, seasonId, input.teamId, now),
      rosterPlayerIds: rosterPlayerIds(db, input.teamId),
      from: source,
      // Staff filing through the form make an ordinary move; exceptions come with a reason.
      byStaff: false,
    },
  );
  if (!verdict.ok) return fail(verdict.error);

  if (input.in) {
    const profile = profilesOf(db, [input.in.playerId], teamRow.title).get(input.in.playerId);
    const gaps = profile
      ? playerGaps(profile, rulesetJson.registration, found.season.startsOn)
      : ['game_account' as const];
    if (gaps.length > 0) return fail('player_incomplete');
    const missing = await notOnServer(db, memberOf, found.competition.id, [input.in.playerId]);
    if (missing === null) return fail('discord_unavailable');
    if (missing.length > 0) return fail('not_on_server');
  }

  const note = input.note?.trim().slice(0, NOTE_MAX) || null;
  const payload: RosterMovePayload = {
    outId: input.outId,
    in: input.in,
    windowId: window?.id ?? null,
    counted: verdict.counted,
    fromTeamId: verdict.transferFrom,
    exceptionReason: null,
  };
  const row = db.transaction((tx) => {
    // Discord took a moment: check the count again inside the transaction.
    const again = movesOf(tx, seasonId, input.teamId);
    const max =
      rulesetJson.mercato.mode === 'windows'
        ? (window?.maxMovesPerTeam ?? null)
        : rulesetJson.mercato.max_moves_per_team;
    if (
      verdict.counted &&
      max !== null &&
      countedMoves(again, rulesetJson.mercato, window?.id ?? null) >= max
    ) {
      return null;
    }
    const stored = tx
      .insert(request)
      .values({
        competitionId: found.competition.id,
        seasonId,
        teamId: input.teamId,
        kind: 'roster_move',
        payloadJson: payload,
        approval: rulesetJson.requests.approval.roster_move,
        note,
        requestedBy: filer,
        requestedAt: now,
      })
      .returning()
      .get();
    auditMove(tx, 'request.file', stored.id, filer, null, { ...payload }, now);
    return stored;
  });
  if (!row) return fail('limit_reached');
  const guild = db
    .select({ queue: schema.leagueGuild.alertsChannelId })
    .from(schema.leagueGuild)
    .where(eq(schema.leagueGuild.competitionId, found.competition.id))
    .get();
  return {
    ok: true,
    move: viewOf(db, { ...row, payloadJson: payload }),
    team: { teamId: teamRow.id, name: teamRow.name, slug: teamRow.slug },
    competition: { id: found.competition.id, name: found.competition.name },
    queueChannelId: guild?.queue ?? null,
  };
}

function auditMove(
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

export type WithdrawMoveReply =
  { ok: true; move: MoveView } | { ok: false; error: 'not_found' | 'not_allowed' | 'not_pending' };

/** The roster's officials take back a move still waiting. */
export function withdrawMove(
  db: Db,
  actor: Actor,
  teamId: number,
  requestId: number,
  now: number,
): WithdrawMoveReply {
  const found = seasonOf(db, teamId);
  if (!found) return { ok: false, error: 'not_found' };
  const access = accessOf(db, actor, teamId, found);
  if (!access?.playerId) return { ok: false, error: 'not_allowed' };
  const by = access.playerId;
  return db.transaction((tx) => {
    const row = movesOf(tx, found.season.id, teamId).find((entry) => entry.id === requestId);
    if (!row) return { ok: false as const, error: 'not_found' as const };
    if (row.status !== 'pending') return { ok: false as const, error: 'not_pending' as const };
    tx.update(request)
      .set({ status: 'withdrawn', decidedBy: by, decidedAt: now })
      .where(eq(request.id, requestId))
      .run();
    auditMove(
      tx,
      'request.withdraw',
      requestId,
      by,
      { status: 'pending' },
      { status: 'withdrawn' },
      now,
    );
    return { ok: true as const, move: viewOf(tx, { ...row, status: 'withdrawn' }) };
  });
}

export type ChangeRoleError =
  RoleChangeError | 'not_found' | 'no_season' | 'not_allowed' | 'not_started';

/**
 * A starter becoming a substitute or back, or a new captain: no move, applied at once at any
 * time (O-35), audited so the team's history keeps it. A player still blocked after their move
 * cannot be named captain, since the captain acts in matches.
 */
export function changeRole(
  db: Db,
  actor: Actor,
  teamId: number,
  change: RoleChange,
  now: number,
): { ok: true } | { ok: false; error: ChangeRoleError } {
  const found = seasonOf(db, teamId);
  if (!found) return { ok: false, error: 'no_season' };
  const access = accessOf(db, actor, teamId, found);
  if (!access?.playerId) return { ok: false, error: 'not_allowed' };
  const by = access.playerId;
  const seasonId = found.season.id;
  return db.transaction((tx) => {
    const lineup = lineupOf(tx, seasonId, teamId, now);
    if ('captainId' in change) {
      const named = lineup.find((entry) => entry.playerId === change.captainId);
      if (named?.startsAt) return { ok: false as const, error: 'not_started' as const };
    }
    const reply = changeLineupRole(lineup, change, found.competition.rulesetJson.registration);
    if (!reply.ok) return reply;
    for (const after of reply.lineup) {
      const before = lineup.find((entry) => entry.playerId === after.playerId);
      if (!before || (before.role === after.role && before.captain === after.captain)) continue;
      tx.update(rosterEntry)
        .set({ role: after.role, captain: after.captain })
        .where(
          and(
            eq(rosterEntry.seasonId, seasonId),
            eq(rosterEntry.teamId, teamId),
            eq(rosterEntry.playerId, after.playerId),
            isNull(rosterEntry.validTo),
          ),
        )
        .run();
      tx.insert(auditLog)
        .values({
          actorPlayerId: by,
          actorKind: 'user',
          action: 'lineup.role',
          entity: 'team',
          entityId: String(teamId),
          beforeJson: { playerId: after.playerId, role: before.role, captain: before.captain },
          afterJson: { playerId: after.playerId, role: after.role, captain: after.captain },
          at: now,
        })
        .run();
    }
    return { ok: true as const };
  });
}
