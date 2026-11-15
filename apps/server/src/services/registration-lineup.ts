import { chooseLineup, type LineupChoiceError, type RegistrationRole } from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { and, eq } from 'drizzle-orm';
import { leadsRegistration, unavailablePlayers } from './registration-players.ts';
import { lineupOf, lockedNow, waitingRegistration } from './registrations.ts';
import { rosterMembers } from './rosters.ts';

// The roster's officials pick the lineup of its registration among its players (design doc
// section 7; maintainer, 14 and 15 November 2026, M-33): the filer or any official who may
// register the roster (`leadsRegistration`). Starters, substitutes and the captain,
// a starter (O-30); a player in another roster of the competition cannot be picked (O-29). The
// lineup changes until it locks (M-29); withdrawing does not lock. Each change is audited.

const { auditLog, registrationPlayer, request } = schema;

type Waiting = NonNullable<ReturnType<typeof waitingRegistration>>;
/** The database, or a transaction on it. */
type Tx = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;

/** A waiting registration the player leads; to anyone else, it does not exist. */
function ledRegistration(db: Tx, playerId: number, requestId: number): Waiting | null {
  const found = waitingRegistration(db, requestId);
  return found && leadsRegistration(db, playerId, found.request) ? found : null;
}

function audit(
  db: Tx,
  byId: number,
  requestId: number,
  action: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  now: number,
): void {
  db.insert(auditLog)
    .values({
      actorPlayerId: byId,
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

export type SetLineupReply =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'lineup_locked' | LineupChoiceError }
  | { ok: false; error: 'unavailable'; playerIds: number[] };

/**
 * The lineup as one of the roster's officials picks it: each player given a role is in it, the others are not; the
 * captain, or nobody while the lineup is built. It replaces the lineup before.
 */
export function setLineup(
  db: Db,
  byId: number,
  requestId: number,
  choice: { roles: ReadonlyMap<number, RegistrationRole>; captainId: number | null },
  now: number,
): SetLineupReply {
  return db.transaction((tx): SetLineupReply => {
    const found = ledRegistration(tx, byId, requestId);
    if (!found) return { ok: false, error: 'not_found' };
    if (lockedNow(found, now)) return { ok: false, error: 'lineup_locked' };
    const { competition, season, team } = found;
    const settings = competition.rulesetJson.registration;
    const ids = rosterMembers(tx, team.id, competition.title).map((member) => member.playerId);
    const taken = new Set(
      unavailablePlayers(
        tx,
        { requestId, competitionId: competition.id, seasonId: season.id },
        ids,
      ),
    );
    const chosen = chooseLineup(
      ids.map((playerId) => ({ playerId, unavailable: taken.has(playerId) })),
      choice,
      settings,
    );
    if (!chosen.ok) return chosen;
    const before = lineupOf(tx, requestId, competition.title, settings, season.startsOn);
    tx.delete(registrationPlayer).where(eq(registrationPlayer.requestId, requestId)).run();
    for (const entry of chosen.lineup) {
      tx.insert(registrationPlayer)
        .values({ requestId, ...entry, joinedAt: now })
        .run();
    }
    const summary = (list: readonly { playerId: number; role: string; captain: boolean }[]) => ({
      starters: list.filter((entry) => entry.role === 'player').map((entry) => entry.playerId),
      subs: list.filter((entry) => entry.role === 'sub').map((entry) => entry.playerId),
      captainId: list.find((entry) => entry.captain)?.playerId ?? null,
    });
    audit(tx, byId, requestId, 'registration.lineup', summary(before), summary(chosen.lineup), now);
    return { ok: true };
  });
}

/**
 * The filer or another official of the roster withdraws the registration while staff have not answered, locked or not: its players
 * are free to be picked by another roster of the competition.
 */
export function withdrawRegistration(
  db: Db,
  byId: number,
  requestId: number,
  now: number,
): { ok: true } | { ok: false; error: 'not_found' } {
  return db.transaction((tx) => {
    const found = ledRegistration(tx, byId, requestId);
    if (!found) return { ok: false, error: 'not_found' };
    tx.update(request)
      .set({ status: 'withdrawn', decidedAt: now, decidedBy: byId })
      .where(and(eq(request.id, requestId), eq(request.status, 'pending')))
      .run();
    audit(
      tx,
      byId,
      requestId,
      'registration.withdraw',
      { status: 'pending' },
      { status: 'withdrawn' },
      now,
    );
    return { ok: true };
  });
}
