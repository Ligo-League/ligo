import type { ReplayRound } from '@ligo/core';
import type { R6Unit } from './normalize.ts';

// An R6 round's unit as stitching reads it (design doc section 8, "From files to a game").

/** Letters and digits only, without the parser's season suffix: `ClubHouseY10` → `clubhouse`. */
const mapKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/y\d+$/, '');

/** The pool's name for the parser's map, or null when the pool does not have it. */
export function r6MapInPool(parserMap: string, pool: readonly string[]): string | null {
  const key = mapKey(parserMap);
  return pool.find((name) => mapKey(name) === key) ?? null;
}

/**
 * The round's kill feed by player name, which every recording of the round shares: the players'
 * order in each file may differ. Operator swaps stay out, since a recording may start late.
 */
export function r6Fingerprint(unit: R6Unit): string {
  const name = (i: number | null) => (i === null ? '?' : (unit.players[i]?.name ?? '?'));
  return unit.events
    .flatMap((e) => {
      if (e.type === 'kill')
        return [`K ${name(e.actor)}>${name(e.target)}${e.team_kill ? '!' : ''}`];
      if (e.type === 'death') return [`D ${name(e.target)}`];
      if (e.type === 'leave') return [`L ${name(e.target)}`];
      return [];
    })
    .join('\n');
}

export type R6ReplayRoundResult =
  | { ok: true; round: ReplayRound; customGame: boolean }
  | { ok: false; error: 'not_bomb' | 'bad_time' };

/**
 * The round for stitching, its map named as in the pool. Only Bomb counts; a match type other
 * than a custom game is accepted, and the caller warns staff (`customGame` false).
 */
export function r6ReplayRound(
  unit: R6Unit,
  fileId: number,
  pool: readonly string[],
): R6ReplayRoundResult {
  if (unit.mode !== 'Bomb') return { ok: false, error: 'not_bomb' };
  const startedAt = Date.parse(unit.started_at);
  if (Number.isNaN(startedAt)) return { ok: false, error: 'bad_time' };
  const winner = unit.sides.find((side) => side.won)?.idx ?? null;
  const attacker = unit.sides.find((side) => side.role === 'Attack')?.idx ?? 0;
  const accounts = (side: 0 | 1) =>
    unit.players.flatMap((p) => (p.side === side && p.account !== null ? [p.account] : []));
  return {
    ok: true,
    customGame: unit.match_type.startsWith('CustomGame'),
    round: {
      fileId,
      lobbyId: unit.lobby_id,
      number: unit.unit.number,
      startedAt,
      map: r6MapInPool(unit.map, pool),
      complete: unit.complete,
      winner,
      attacker,
      accounts: [accounts(0), accounts(1)],
      fingerprint: r6Fingerprint(unit),
    },
  };
}
