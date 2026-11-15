import { randomBytes } from 'node:crypto';
import { changeLineup, type LineupChangeError, type RegistrationRole } from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { and, eq, isNull } from 'drizzle-orm';
import { lineupOf, lockedNow, waitingRegistration } from './registrations.ts';

// The filer builds the lineup of their registration (design doc section 7; maintainer, 14 and 15
// November 2026): starters, substitutes and the captain, a starter (O-30); a player removed; a
// new invitation link, which voids the old one; the registration withdrawn. Lineup changes stop
// once the lineup locks (M-29); withdrawing does not. Each change is audited.

const { auditLog, registrationInvite, registrationPlayer, request } = schema;

const DAY_MS = 86_400_000;

type Waiting = NonNullable<ReturnType<typeof waitingRegistration>>;
/** The database, or a transaction on it. */
type Tx = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;

/** The filer's own waiting registration; to anyone else, it does not exist. */
function filersRegistration(db: Tx, filerId: number, requestId: number): Waiting | null {
  const found = waitingRegistration(db, requestId);
  return found?.request.requestedBy === filerId ? found : null;
}

const membersOf = (db: Tx, found: Waiting) =>
  lineupOf(
    db,
    found.request.id,
    found.competition.title,
    found.competition.rulesetJson.registration,
    found.season.startsOn,
  );

function audit(
  db: Tx,
  filerId: number,
  requestId: number,
  action: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  now: number,
): void {
  db.insert(auditLog)
    .values({
      actorPlayerId: filerId,
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

type Refusal = { ok: false; error: 'not_found' | 'lineup_locked' };

/** Each player's role as given, and the captain, or nobody while the lineup is built. */
export function setLineup(
  db: Db,
  filerId: number,
  requestId: number,
  change: { roles: ReadonlyMap<number, RegistrationRole>; captainId: number | null },
  now: number,
): { ok: true } | Refusal | { ok: false; error: LineupChangeError } {
  return db.transaction((tx) => {
    const found = filersRegistration(tx, filerId, requestId);
    if (!found) return { ok: false, error: 'not_found' };
    if (lockedNow(found, now)) return { ok: false, error: 'lineup_locked' };
    const members = membersOf(tx, found);
    const changed = changeLineup(members, change, found.competition.rulesetJson.registration);
    if (!changed.ok) return changed;
    for (const entry of changed.members) {
      tx.update(registrationPlayer)
        .set({ role: entry.role, captain: entry.captain })
        .where(
          and(
            eq(registrationPlayer.requestId, requestId),
            eq(registrationPlayer.playerId, entry.playerId),
          ),
        )
        .run();
    }
    const summary = (list: typeof members) => ({
      captainId: list.find((entry) => entry.captain)?.playerId ?? null,
      subs: list.filter((entry) => entry.role === 'sub').map((entry) => entry.playerId),
    });
    audit(
      tx,
      filerId,
      requestId,
      'registration.lineup',
      summary(members),
      summary(changed.members),
      now,
    );
    return { ok: true };
  });
}

/** The filer takes a player out of the registration, until the lineup locks. */
export function removeFromRegistration(
  db: Db,
  filerId: number,
  requestId: number,
  playerId: number,
  now: number,
): { ok: true } | Refusal | { ok: false; error: 'not_joined' } {
  return db.transaction((tx) => {
    const found = filersRegistration(tx, filerId, requestId);
    if (!found) return { ok: false, error: 'not_found' };
    if (lockedNow(found, now)) return { ok: false, error: 'lineup_locked' };
    const entry = membersOf(tx, found).find((member) => member.playerId === playerId);
    if (!entry) return { ok: false, error: 'not_joined' };
    tx.delete(registrationPlayer)
      .where(
        and(eq(registrationPlayer.requestId, requestId), eq(registrationPlayer.playerId, playerId)),
      )
      .run();
    audit(
      tx,
      filerId,
      requestId,
      'registration.remove_player',
      { playerId, role: entry.role, captain: entry.captain },
      null,
      now,
    );
    return { ok: true };
  });
}

/**
 * A new invitation link: the one in use is revoked, so a link shared too widely stops working,
 * and the new one lasts the league's full time. Nobody can join a locked lineup, so no link then.
 */
export function renewInvite(
  db: Db,
  filerId: number,
  requestId: number,
  now: number,
): { ok: true } | Refusal {
  return db.transaction((tx) => {
    const found = filersRegistration(tx, filerId, requestId);
    if (!found) return { ok: false, error: 'not_found' };
    if (lockedNow(found, now)) return { ok: false, error: 'lineup_locked' };
    tx.update(registrationInvite)
      .set({ revokedAt: now })
      .where(and(eq(registrationInvite.requestId, requestId), isNull(registrationInvite.revokedAt)))
      .run();
    const created = tx
      .insert(registrationInvite)
      .values({
        requestId,
        nonce: randomBytes(32).toString('base64url'),
        createdAt: now,
        expiresAt: now + found.competition.rulesetJson.registration.invite_days * DAY_MS,
      })
      .returning({ id: registrationInvite.id })
      .get();
    audit(tx, filerId, requestId, 'registration.renew_invite', null, { inviteId: created.id }, now);
    return { ok: true };
  });
}

/**
 * The filer withdraws the registration while staff have not answered, locked or not: its link
 * stops working and its players are free to join another roster.
 */
export function withdrawRegistration(
  db: Db,
  filerId: number,
  requestId: number,
  now: number,
): { ok: true } | { ok: false; error: 'not_found' } {
  return db.transaction((tx) => {
    const found = filersRegistration(tx, filerId, requestId);
    if (!found) return { ok: false, error: 'not_found' };
    tx.update(request)
      .set({ status: 'withdrawn', decidedAt: now, decidedBy: filerId })
      .where(and(eq(request.id, requestId), eq(request.status, 'pending')))
      .run();
    audit(
      tx,
      filerId,
      requestId,
      'registration.withdraw',
      { status: 'pending' },
      { status: 'withdrawn' },
      now,
    );
    return { ok: true };
  });
}
