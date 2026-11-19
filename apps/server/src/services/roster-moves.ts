import {
  changeLineupRole,
  checkMove,
  playerGaps,
  type MercatoSettings,
  type RegistrationRole,
  type RoleChange,
  type RoleChangeError,
} from '@ligo/core';
import { schema, type Db, type RosterMovePayload } from '@ligo/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { Actor } from './permissions.ts';
import { profilesOf } from './profiles.ts';
import { notOnServer, type MemberCheck } from './registration-players.ts';
import { lockedNow } from './registrations.ts';
import {
  applyMove,
  moveChannels,
  MOVE_REASON_MAX,
  type AppliedMove,
  type ApplyError,
} from './roster-move-apply.ts';
import {
  accessOf,
  auditMove,
  countedMoves,
  lineupOf,
  movesOf,
  nameOf,
  nextWindow,
  rosterPlayerIds,
  seasonOf,
  sourceOf,
  viewOf,
  windowAt,
  type LineupMember,
  type MoveView,
  type Reader,
} from './roster-move-data.ts';

export type { LineupMember, MoveView } from './roster-move-data.ts';

// A roster's mercato moves (design doc section 7; O-35 and M-22, maintainer, 16 and 19 November
// 2026). The officials who manage the roster's players file a move, one player out, one in from
// the roster's own players, or a swap; league staff answer it (phase 3f-12). Role and captain
// changes are no moves: they apply at once and are audited. Everything is checked from the
// database at each step, with the roles Discord gives the actor now.

const { auditLog, request, rosterEntry, team } = schema;

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
      window: typeof schema.mercatoWindow.$inferSelect | null;
      nextWindow: typeof schema.mercatoWindow.$inferSelect | null;
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
  /**
   * A staff exception (O-35): applied at once, at any time, not counted, with this reason.
   * League staff only.
   */
  exceptionReason?: string | null;
}

export type FileMoveError =
  | ApplyError
  | 'reason_required'
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
      mercatoChannelId: string | null;
      /** Applied at once: a staff exception, or a league that approves moves automatically. */
      applied: AppliedMove | null;
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
  const exception =
    input.exceptionReason === undefined || input.exceptionReason === null
      ? null
      : input.exceptionReason.trim().slice(0, MOVE_REASON_MAX);
  if (exception === '') return fail('reason_required');
  if (exception !== null && !access.staff) return fail('not_allowed');

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
      byStaff: exception !== null,
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
    exceptionReason: exception,
  };
  const approval = exception === null ? rulesetJson.requests.approval.roster_move : 'staff';
  // Set when an exception or an automatic approval cannot apply: the transaction then rolls back.
  const refused: { error: ApplyError | null } = { error: null };
  const store = () =>
    db.transaction((tx) => {
      // Discord took a moment: check the count again inside the transaction.
      const again = movesOf(tx, seasonId, input.teamId);
      const max =
        rulesetJson.mercato.mode === 'windows'
          ? (window?.maxMovesPerTeam ?? null)
          : rulesetJson.mercato.max_moves_per_team;
      if (
        exception === null &&
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
          approval,
          note,
          requestedBy: filer,
          requestedAt: now,
        })
        .returning()
        .get();
      auditMove(tx, 'request.file', stored.id, filer, null, { ...payload }, now);
      if (exception === null && approval === 'staff') return { row: stored, applied: null };
      const applied = applyMove(tx, { ...stored, payloadJson: payload }, found, filer, now);
      if (!applied.ok) {
        // Nothing of the move is kept when it cannot apply.
        refused.error = applied.error;
        tx.rollback();
      }
      const decided = movesOf(tx, seasonId, input.teamId).find((entry) => entry.id === stored.id);
      return { row: decided ?? stored, applied: applied.ok ? applied.applied : null };
    });
  let outcome: ReturnType<typeof store>;
  try {
    outcome = store();
  } catch (error) {
    if (refused.error !== null) return fail(refused.error);
    throw error;
  }
  if (!outcome) return fail('limit_reached');
  const row = outcome.row;
  return {
    ok: true,
    move: viewOf(db, { ...row, payloadJson: payload }),
    team: { teamId: teamRow.id, name: teamRow.name, slug: teamRow.slug },
    competition: { id: found.competition.id, name: found.competition.name },
    ...moveChannels(db, found.competition.id),
    applied: outcome.applied,
  };
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

/** The competition of the season under way the roster plays, if any: whose staff and server act. */
export function moveCompetitionOf(db: Reader, teamId: number): number | null {
  return seasonOf(db, teamId)?.competition.id ?? null;
}
