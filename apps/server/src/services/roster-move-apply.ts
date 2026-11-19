import { checkMove, moveStart, playerGaps, type MoveError } from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { and, eq, isNull } from 'drizzle-orm';
import { requireStaff, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';
import { profilesOf } from './profiles.ts';
import { lockedNow } from './registrations.ts';
import {
  auditMove,
  countedMoves,
  lineupOf,
  movesOf,
  rosterPlayerIds,
  seasonOf,
  sourceOf,
  viewOf,
  type MoveRow,
  type MoveSeason,
  type MoveView,
  type Reader,
  type Tx,
} from './roster-move-data.ts';
import { listTeamStaff } from './team-staff.ts';

// Deciding a mercato move (design doc section 7; O-35): league staff approve or refuse it with
// a reason; a staff exception and a move the league approves automatically are applied as they
// are filed. Approval checks everything again, ends the outgoing player's roster entry, ends the
// incoming player's entry in another roster of the competition (a transfer), and starts their
// entry here after the block (`lock_hours`).

const { leagueGuild, mercatoWindow, request, rosterEntry, team } = schema;

export const MOVE_REASON_MAX = 500;

/** What an applied move changed, for Discord. */
export interface AppliedMove {
  /** When the incoming player may play; null when nobody comes in. */
  startsAt: number | null;
  /** The roster a transferred player left, its officials to tell, and whether it lost its captain. */
  fromTeam: { teamId: number; name: string; officials: string[]; lostCaptain: boolean } | null;
}

export type ApplyError = MoveError | 'player_incomplete';

/**
 * Applies a move inside the caller's transaction, after checking it again against the lineup
 * and the rules as they are now. The window and the count are those of when it was filed.
 */
export function applyMove(
  tx: Tx,
  row: MoveRow,
  found: MoveSeason,
  by: number,
  now: number,
): { ok: true; applied: AppliedMove } | { ok: false; error: ApplyError } {
  const payload = row.payloadJson;
  const teamId = row.teamId ?? 0;
  const seasonId = found.season.id;
  const { rulesetJson } = found.competition;
  const window =
    payload.windowId === null
      ? null
      : (tx.select().from(mercatoWindow).where(eq(mercatoWindow.id, payload.windowId)).get() ??
        null);
  const source = payload.in ? sourceOf(tx, seasonId, payload.in.playerId, teamId) : null;
  const verdict = checkMove(
    { outId: payload.outId, in: payload.in },
    {
      settings: rulesetJson.mercato,
      registration: rulesetJson.registration,
      lineupLocked: lockedNow(found, now),
      window,
      filedAt: row.requestedAt,
      movesCounted: countedMoves(
        movesOf(tx, seasonId, teamId),
        rulesetJson.mercato,
        payload.windowId,
        row.id,
      ),
      lineup: lineupOf(tx, seasonId, teamId, now),
      rosterPlayerIds: rosterPlayerIds(tx, teamId),
      from: source,
      byStaff: payload.exceptionReason !== null,
    },
  );
  if (!verdict.ok) return verdict;
  if (payload.in) {
    const title = tx.select({ title: team.title }).from(team).where(eq(team.id, teamId)).get();
    const profile = profilesOf(tx, [payload.in.playerId], title?.title ?? 'r6').get(
      payload.in.playerId,
    );
    const gaps = profile
      ? playerGaps(profile, rulesetJson.registration, found.season.startsOn)
      : ['game_account' as const];
    if (gaps.length > 0) return { ok: false, error: 'player_incomplete' };
  }

  const current = (forTeam: number, playerId: number) =>
    and(
      eq(rosterEntry.seasonId, seasonId),
      eq(rosterEntry.teamId, forTeam),
      eq(rosterEntry.playerId, playerId),
      isNull(rosterEntry.validTo),
    );
  if (payload.outId !== null) {
    tx.update(rosterEntry).set({ validTo: now }).where(current(teamId, payload.outId)).run();
  }
  let fromTeam: AppliedMove['fromTeam'] = null;
  let startsAt: number | null = null;
  if (payload.in) {
    if (source) {
      const leaving = tx
        .select({ captain: rosterEntry.captain })
        .from(rosterEntry)
        .where(current(source.teamId, payload.in.playerId))
        .get();
      tx.update(rosterEntry)
        .set({ validTo: now })
        .where(current(source.teamId, payload.in.playerId))
        .run();
      fromTeam = {
        teamId: source.teamId,
        name: source.name,
        officials: listTeamStaff(tx, source.teamId).flatMap((member) =>
          member.discordUserId === null ? [] : [member.discordUserId],
        ),
        lostCaptain: leaving?.captain ?? false,
      };
    }
    startsAt = moveStart(now, verdict.lockHours);
    tx.insert(rosterEntry)
      .values({
        seasonId,
        teamId,
        playerId: payload.in.playerId,
        role: payload.in.role,
        captain: false,
        validFrom: startsAt,
      })
      .run();
  }
  tx.update(request)
    .set({ status: 'approved', decidedBy: by, decidedAt: now })
    .where(eq(request.id, row.id))
    .run();
  auditMove(
    tx,
    'request.approve',
    row.id,
    by,
    { status: row.status },
    { status: 'approved', startsAt, fromTeamId: fromTeam?.teamId ?? null },
    now,
  );
  return { ok: true, applied: { startsAt, fromTeam } };
}

/** The league's channels a decided move is told in. */
export function moveChannels(
  db: Reader,
  competitionId: number,
): { queueChannelId: string | null; mercatoChannelId: string | null } {
  const row = db
    .select({ queue: leagueGuild.alertsChannelId, mercato: leagueGuild.mercatoChannelId })
    .from(leagueGuild)
    .where(eq(leagueGuild.competitionId, competitionId))
    .get();
  return { queueChannelId: row?.queue ?? null, mercatoChannelId: row?.mercato ?? null };
}

export type DecideMoveError =
  ApplyError | 'not_linked' | 'not_staff' | 'not_found' | 'not_pending' | 'reason_required';

export type DecideMoveReply =
  | {
      ok: true;
      decision: 'approve' | 'reject';
      move: MoveView;
      team: { teamId: number; name: string; slug: string };
      competition: { name: string };
      season: { name: string };
      /** Null when refused. */
      applied: AppliedMove | null;
      /** Who asked, told of the decision. */
      requesterDiscordId: string | null;
      queueChannelId: string | null;
      mercatoChannelId: string | null;
    }
  | { ok: false; error: DecideMoveError };

/** The move waiting, if league staff of its competition may answer it. */
function waitingMove(db: Reader, actor: Actor, requestId: number) {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const row = db.select().from(request).where(eq(request.id, requestId)).get();
  if (
    row?.kind !== 'roster_move' ||
    row.teamId === null ||
    row.competitionId !== staff.league.competition.id
  ) {
    return { ok: false as const, error: 'not_found' as const };
  }
  if (row.status !== 'pending') return { ok: false as const, error: 'not_pending' as const };
  const found = seasonOf(db, row.teamId);
  if (!found || found.season.id !== row.seasonId) {
    return { ok: false as const, error: 'not_found' as const };
  }
  return { ok: true as const, league: staff.league, teamId: row.teamId, found };
}

/** Whether staff may answer the move now: for the Refuse button, before its form opens. */
export function checkMoveAnswer(
  db: Reader,
  actor: Actor,
  requestId: number,
): { ok: true } | { ok: false; error: DecideMoveError } {
  const waiting = waitingMove(db, actor, requestId);
  return waiting.ok ? { ok: true } : waiting;
}

/** League staff approve a move waiting, or refuse it with a reason the team reads. */
export function decideMove(
  db: Db,
  actor: Actor,
  input: { requestId: number; decision: 'approve' | 'reject'; reason: string | null },
  now: number,
): DecideMoveReply {
  const waiting = waitingMove(db, actor, input.requestId);
  if (!waiting.ok) return waiting;
  const { league, teamId, found } = waiting;
  const reason = input.reason?.trim().slice(0, MOVE_REASON_MAX) ?? '';
  if (input.decision === 'reject' && reason === '') {
    return { ok: false, error: 'reason_required' };
  }
  const staffPlayer = ensurePlayer(
    db,
    { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
    now,
  );

  const outcome = db.transaction((tx) => {
    const row = movesOf(tx, found.season.id, teamId).find((entry) => entry.id === input.requestId);
    if (row?.status !== 'pending') return { ok: false as const, error: 'not_pending' as const };
    if (input.decision === 'reject') {
      tx.update(request)
        .set({ status: 'rejected', decidedBy: staffPlayer.id, decidedAt: now, reason })
        .where(eq(request.id, row.id))
        .run();
      auditMove(
        tx,
        'request.reject',
        row.id,
        staffPlayer.id,
        { status: 'pending' },
        { status: 'rejected', reason },
        now,
      );
      return { ok: true as const, row, applied: null };
    }
    const applied = applyMove(tx, row, found, staffPlayer.id, now);
    return applied.ok ? { ok: true as const, row, applied: applied.applied } : applied;
  });
  if (!outcome.ok) return outcome;
  const decided = movesOf(db, found.season.id, teamId).find(
    (entry) => entry.id === input.requestId,
  );
  const teamRow = db.select().from(team).where(eq(team.id, teamId)).get();
  const requester = db
    .select({ discordUserId: schema.player.discordUserId })
    .from(schema.player)
    .where(eq(schema.player.id, outcome.row.requestedBy))
    .get();
  return {
    ok: true,
    decision: input.decision,
    move: viewOf(db, decided ?? outcome.row),
    team: { teamId, name: teamRow?.name ?? '?', slug: teamRow?.slug ?? '' },
    competition: { name: league.competition.name },
    season: { name: found.season.name },
    applied: outcome.applied,
    requesterDiscordId: requester?.discordUserId ?? null,
    ...moveChannels(db, league.competition.id),
  };
}

/** A move waiting for staff, with its roster, for the staff queue. */
export interface MoveToDecide {
  move: MoveView;
  team: { name: string; slug: string };
}

/** The competition's moves waiting for staff, oldest first. */
export function movesToDecide(db: Reader, competitionId: number): MoveToDecide[] {
  return db
    .select({ id: request.id, teamId: request.teamId, seasonId: request.seasonId })
    .from(request)
    .where(
      and(
        eq(request.competitionId, competitionId),
        eq(request.kind, 'roster_move'),
        eq(request.status, 'pending'),
      ),
    )
    .orderBy(request.requestedAt, request.id)
    .all()
    .flatMap((row) => {
      if (row.teamId === null || row.seasonId === null) return [];
      const found = movesOf(db, row.seasonId, row.teamId).find((entry) => entry.id === row.id);
      const teamRow = db.select().from(team).where(eq(team.id, row.teamId)).get();
      return found && teamRow
        ? [{ move: viewOf(db, found), team: { name: teamRow.name, slug: teamRow.slug } }]
        : [];
    });
}

/** The competition a move belongs to, whose staff answer it; null for anything else. */
export function moveCompetition(db: Reader, requestId: number): number | null {
  const row = db
    .select({ competitionId: request.competitionId, kind: request.kind })
    .from(request)
    .where(eq(request.id, requestId))
    .get();
  return row?.kind === 'roster_move' ? row.competitionId : null;
}
