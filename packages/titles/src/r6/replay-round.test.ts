import { describe, expect, it } from 'vitest';
import teamKill from './golden/team-kill.round.json' with { type: 'json' };
import { normalizeR6, type R6Unit } from './normalize.ts';
import { r6Fingerprint, r6MapInPool, r6ReplayRound } from './replay-round.ts';

// An R6 round's unit as stitching reads it (design doc section 8): the map named as in the
// league's pool, the teams' accounts, and a fingerprint every recording of the round shares.

const POOL = ['Bank', 'Clubhouse', 'Kafe Dostoyevsky', 'Nighthaven Labs', 'Chalet'];

function unit(): R6Unit {
  const result = normalizeR6(teamKill, { parser: 'p', fileSha256: '00', tradeWindowS: 10 });
  if (!result.ok) throw new Error(result.message);
  return result.unit;
}

describe('r6MapInPool', () => {
  it.each([
    ['ClubHouseY10', 'Clubhouse'],
    ['KafeDostoyevskyY10', 'Kafe Dostoyevsky'],
    ['NighthavenLabsY10', 'Nighthaven Labs'],
    ['Bank', 'Bank'],
  ])('finds %s as %s', (parser, pool) => {
    expect(r6MapInPool(parser, POOL)).toBe(pool);
  });

  it('gives null for a map outside the pool', () => {
    expect(r6MapInPool('VillaY10', POOL)).toBeNull();
  });
});

describe('r6Fingerprint', () => {
  it('is the same whatever order the recording lists the players in', () => {
    const original = unit();
    const reversed = [...original.players].reverse();
    const reindex = (i: number | null) =>
      i === null ? null : reversed.indexOf(original.players[i] as R6Unit['players'][number]);
    const other: R6Unit = {
      ...original,
      players: reversed,
      events: original.events.map((e) =>
        e.type === 'kill'
          ? { ...e, actor: reindex(e.actor), target: reindex(e.target) }
          : e.type === 'swap'
            ? { ...e, actor: reindex(e.actor) }
            : { ...e, target: reindex(e.target) },
      ),
    };
    expect(r6Fingerprint(other)).toBe(r6Fingerprint(original));
  });

  it('changes with the kill feed, not with operator swaps', () => {
    const original = unit();
    const kills = original.events.filter((e) => e.type === 'kill');
    expect(r6Fingerprint({ ...original, events: kills })).toBe(r6Fingerprint(original));
    expect(r6Fingerprint({ ...original, events: kills.slice(1) })).not.toBe(
      r6Fingerprint(original),
    );
  });
});

describe('r6ReplayRound', () => {
  it('gives stitching the round, its sides and their accounts', () => {
    const result = r6ReplayRound(unit(), 42, POOL);
    if (!result.ok) throw new Error(result.error);
    const { round } = result;
    expect(round).toMatchObject({
      fileId: 42,
      lobbyId: unit().lobby_id,
      number: 3,
      startedAt: Date.parse(unit().started_at),
      map: null, // Lair is not in this pool
      complete: true,
      winner: 1,
      attacker: 0,
      fingerprint: r6Fingerprint(unit()),
    });
    expect(round.accounts.map((side) => side.length)).toEqual([5, 5]);
    expect(result.customGame).toBe(true);
    expect(r6ReplayRound(unit(), 42, [...POOL, 'Lair'])).toMatchObject({
      round: { map: 'Lair' },
    });
  });

  it('refuses a mode other than Bomb, and warns of a match outside a custom game', () => {
    expect(r6ReplayRound({ ...unit(), mode: 'Hostage' }, 1, POOL)).toEqual({
      ok: false,
      error: 'not_bomb',
    });
    expect(r6ReplayRound({ ...unit(), match_type: 'Ranked' }, 1, POOL)).toMatchObject({
      ok: true,
      customGame: false,
    });
  });

  it('leaves out the accounts a LAN build hides', () => {
    const hidden = { ...unit(), players: unit().players.map((p) => ({ ...p, account: null })) };
    const result = r6ReplayRound(hidden, 1, POOL);
    expect(result.ok && result.round.accounts).toEqual([[], []]);
  });
});
