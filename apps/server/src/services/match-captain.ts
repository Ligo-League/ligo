import { mayNameMatchCaptain, type MatchCaptainError } from '@ligo/core';
import { findGuildLeague, schema, type Db, type LeagueMatch } from '@ligo/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { matchActorOf, type Actor } from './permissions.ts';
import { leagueMatch } from './reports.ts';

// The captain for one match (O-30, O-30b, maintainer, 14 and 15 November 2026): when a side's
// captain cannot play, its officials or its usual captain name a starter or a substitute of the
// season's lineup for that match, until the result is reported. The stand-in then acts in that
// match like a captain (`matchRolesOf`); the usual captain keeps acting too.

const { auditLog, matchCaptain, player, rosterEntry } = schema;

type Side = 'a' | 'b';
type Reader = Pick<Db, 'select'>;

export interface LineupPlayer {
  playerId: number;
  name: string;
  role: 'player' | 'sub';
  captain: boolean;
}

/** A side's season lineup, as it stands now: starters first, then substitutes, by name. */
export function matchLineup(db: Reader, found: LeagueMatch, side: Side): LineupPlayer[] {
  const rows = db
    .select({
      playerId: rosterEntry.playerId,
      name: player.displayName,
      role: rosterEntry.role,
      captain: rosterEntry.captain,
    })
    .from(rosterEntry)
    .innerJoin(player, eq(rosterEntry.playerId, player.id))
    .where(
      and(
        eq(rosterEntry.seasonId, found.seasonId),
        eq(rosterEntry.teamId, found[side].teamId),
        isNull(rosterEntry.validTo),
      ),
    )
    .orderBy(asc(player.displayName))
    .all();
  return rows
    .flatMap((row): LineupPlayer[] =>
      row.role === 'player' || row.role === 'sub' ? [{ ...row, role: row.role }] : [],
    )
    .sort((x, y) => Number(x.role === 'sub') - Number(y.role === 'sub'));
}

type Named = { playerId: number; name: string } | null;

/** Each side's usual captain and its captain for this match, if one was named. */
export function matchCaptains(
  db: Reader,
  found: LeagueMatch,
): Record<Side, { usual: Named; standIn: Named }> {
  const standIns = db
    .select({ side: matchCaptain.side, playerId: matchCaptain.playerId, name: player.displayName })
    .from(matchCaptain)
    .innerJoin(player, eq(matchCaptain.playerId, player.id))
    .where(eq(matchCaptain.matchId, found.id))
    .all();
  const of = (side: Side) => {
    const usual = matchLineup(db, found, side).find((entry) => entry.captain);
    const standIn = standIns.find((row) => row.side === side);
    return {
      usual: usual ? { playerId: usual.playerId, name: usual.name } : null,
      standIn: standIn ? { playerId: standIn.playerId, name: standIn.name } : null,
    };
  };
  return { a: of('a'), b: of('b') };
}

export type NameMatchCaptainReply =
  | { ok: true; match: LeagueMatch; side: Side; standIn: Named }
  | { ok: false; error: 'not_linked' | 'match_not_found' | MatchCaptainError };

/**
 * Names the captain of one side for one match, replacing any named before; `playerId: null`
 * names nobody, leaving the usual captain alone. Checked and written in one transaction.
 */
export function nameMatchCaptain(
  db: Db,
  actor: Actor,
  request: { matchId: number; side: Side; playerId: number | null },
  now: number,
): NameMatchCaptainReply {
  const league = actor.guildId === null ? undefined : findGuildLeague(db, actor.guildId);
  if (!league) return { ok: false, error: 'not_linked' };
  return db.transaction((tx): NameMatchCaptainReply => {
    const found = leagueMatch(tx, league, request.matchId);
    if (!found) return { ok: false, error: 'match_not_found' };
    const acting = matchActorOf(tx, actor, found.seasonId);
    const lineup = matchLineup(tx, found, request.side);
    const picked =
      request.playerId === null
        ? null
        : (lineup.find((entry) => entry.playerId === request.playerId) ?? null);
    const verdict = mayNameMatchCaptain(
      acting.teams,
      found,
      request.side,
      request.playerId === null
        ? null
        : { inLineup: picked !== null, usualCaptain: picked?.captain ?? false },
    );
    if (!verdict.ok) return verdict;
    // `mayNameMatchCaptain` let them act for the side: they are a known player.
    if (acting.playerId === null) return { ok: false, error: 'not_allowed' };

    const where = and(eq(matchCaptain.matchId, found.id), eq(matchCaptain.side, request.side));
    const before = tx.select().from(matchCaptain).where(where).get();
    tx.delete(matchCaptain).where(where).run();
    if (picked) {
      tx.insert(matchCaptain)
        .values({
          matchId: found.id,
          side: request.side,
          playerId: picked.playerId,
          namedBy: acting.playerId,
          namedAt: now,
        })
        .run();
    }
    tx.insert(auditLog)
      .values({
        actorPlayerId: acting.playerId,
        actorKind: 'user',
        action: 'match.captain',
        entity: 'match',
        entityId: String(found.id),
        beforeJson: { side: request.side, playerId: before?.playerId ?? null },
        afterJson: { side: request.side, playerId: picked?.playerId ?? null },
        at: now,
      })
      .run();
    return {
      ok: true,
      match: found,
      side: request.side,
      standIn: picked && { playerId: picked.playerId, name: picked.name },
    };
  });
}
