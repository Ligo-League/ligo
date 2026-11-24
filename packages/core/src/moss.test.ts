import { describe, expect, it } from 'vitest';
import { mossGaps, mossSideOf, type MossPlayer } from './moss.ts';

// MOSS before validation (M-47, maintainer 20 and 24 November 2026): the players the replays
// show on each side send one file each, normally 5 per team; only they may send one.

const player = (n: number, extra: Partial<MossPlayer> = {}): MossPlayer => ({
  account: `acc-${String(n)}`,
  name: `Player ${String(n)}`,
  playerId: n,
  hasFile: true,
  ...extra,
});
const five = (from: number, extra: Partial<MossPlayer> = {}) =>
  [0, 1, 2, 3, 4].map((i) => player(from + i, extra));

describe('mossGaps', () => {
  it('finds nothing missing when every player the replays show has a file', () => {
    expect(mossGaps({ sides: { a: five(1), b: five(11) }, teamSize: 5 })).toEqual([]);
  });

  it('names each player without a file, a substitute who came in included', () => {
    const b = [...five(11), player(16, { hasFile: false })];
    const a = five(1);
    a[2] = player(3, { hasFile: false });
    expect(mossGaps({ sides: { a, b }, teamSize: 5 })).toEqual([
      { kind: 'missing', side: 'a', account: 'acc-3', name: 'Player 3', playerId: 3 },
      { kind: 'missing', side: 'b', account: 'acc-16', name: 'Player 16', playerId: 16 },
    ]);
  });

  it('waits for a side whose replays show fewer players than a team', () => {
    expect(mossGaps({ sides: { a: five(1), b: five(11).slice(0, 3) }, teamSize: 5 })).toEqual([
      { kind: 'too_few_players', side: 'b', seen: 3 },
    ]);
    expect(mossGaps({ sides: { a: [], b: five(11) }, teamSize: 5 })).toEqual([
      { kind: 'too_few_players', side: 'a', seen: 0 },
    ]);
  });

  it('leaves a player Ligo does not know to staff: nobody can send their file', () => {
    const a = five(1);
    a[4] = player(5, { playerId: null, hasFile: false });
    expect(mossGaps({ sides: { a, b: five(11) }, teamSize: 5 })).toEqual([
      { kind: 'unknown_player', side: 'a', account: 'acc-5', name: 'Player 5' },
    ]);
  });
});

describe('mossSideOf', () => {
  it('gives the side of a player the replays show, and nothing for anyone else', () => {
    const sides = { a: five(1), b: five(11) };
    expect(mossSideOf(sides, 12)).toBe('b');
    expect(mossSideOf(sides, 3)).toBe('a');
    expect(mossSideOf(sides, 99)).toBeNull();
  });
});
