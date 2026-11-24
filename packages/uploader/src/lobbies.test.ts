import { normalizeR6, type R6Unit } from '@ligo/titles';
import { rawRound } from '@ligo/titles/testing';
import { describe, expect, it } from 'vitest';
import type { KnownAccount } from './config.ts';
import { previewLobbies } from './lobbies.ts';

const accounts = (prefix: string) =>
  [1, 2, 3, 4, 5].map((n) => `${prefix}${String(n)}00000-0000-4000-8000-000000000000`);
const alpha = accounts('a');
const bravo = accounts('b');

function unit(lobby: string, number: number, winner: 0 | 1 | null, startedAt = 0): R6Unit {
  const read = normalizeR6(
    rawRound({ lobby, number, winner, attacker: 0, startedAt, accounts: [alpha, bravo] }),
    { parser: 'r6-test', fileSha256: '0'.repeat(64), tradeWindowS: 10 },
  );
  if (!read.ok) throw new Error(read.message);
  return read.unit;
}

const knownAll = new Map<string, KnownAccount>([
  ...alpha.map((a, i): [string, KnownAccount] => [
    a,
    { hash: '', side: 'b', name: `Alpha ${String(i)}` },
  ]),
  ...bravo.map((b, i): [string, KnownAccount] => [
    b,
    { hash: '', side: 'a', name: `Bravo ${String(i)}` },
  ]),
]);

describe('previewLobbies', () => {
  it('shows each lobby’s rounds with the winning team, its sides resolved by known players', () => {
    const [lobby] = previewLobbies([unit('L1', 1, 1), unit('L1', 0, 0)], (a) => knownAll.get(a), 3);
    // Alpha's players are side B of the match: the file's side 0 is team B.
    expect(lobby?.sides.map((s) => s.team)).toEqual(['b', 'a']);
    expect(lobby?.rounds).toEqual([
      { number: 0, winner: 'b', complete: true },
      { number: 1, winner: 'a', complete: true },
    ]);
    expect(lobby?.customGame).toBe(true);
    expect(lobby?.sides[0].players[0]).toEqual({
      name: 'a100000',
      known: { name: 'Alpha 0', side: 'b' },
    });
  });

  it('leaves a side without its team when too few of its players are known', () => {
    const two = new Map(
      [...knownAll].filter(([account]) => account.startsWith('a1') || account.startsWith('a2')),
    );
    const [lobby] = previewLobbies([unit('L1', 0, null)], (a) => two.get(a), 3);
    expect(lobby?.sides.map((s) => s.team)).toEqual([null, null]);
    expect(lobby?.rounds).toEqual([{ number: 0, winner: null, complete: false }]);
  });

  it('orders lobbies by their start, and shows a complete recording of a round over a cut one', () => {
    const lobbies = previewLobbies(
      [unit('L2', 0, 0, 5_000), unit('L1', 0, null, 1_000), unit('L1', 0, 1, 1_000)],
      (a) => knownAll.get(a),
      3,
    );
    expect(lobbies.map((l) => [l.lobbyId, l.rounds[0]?.winner])).toEqual([
      ['L1', 'a'],
      ['L2', 'b'],
    ]);
  });
});
