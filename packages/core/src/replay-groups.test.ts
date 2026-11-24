import { describe, expect, it } from 'vitest';
import { groupReplays, type ReplayRound, type ReplaySide } from './replay-groups.ts';

// From round files to games (design doc section 8, "From files to a game"): files group into
// segments by lobby, segments into the match's games by map; each side of a lobby is a team when
// enough of its players are in that team's lineup; one recording per round is canonical, and
// two recordings of a round must agree.

const A = ['a1', 'a2', 'a3', 'a4', 'a5'];
const B = ['b1', 'b2', 'b3', 'b4', 'b5'];
const TEAM_OF = new Map<string, ReplaySide>([
  ...A.map((p): [string, ReplaySide] => [p, 'A']),
  ...B.map((p): [string, ReplaySide] => [p, 'B']),
]);
const GAMES = [{ n: 1, map: 'Clubhouse' }];
let nextId = 1;

/** A round file: team A on file side 0 unless `swapped`. */
function file(lobbyId: string, number: number, rest: Partial<ReplayRound> = {}): ReplayRound {
  return {
    fileId: nextId++,
    lobbyId,
    number,
    startedAt: 1_000_000 + number * 240_000,
    map: 'Clubhouse',
    complete: true,
    winner: 0,
    attacker: 0,
    accounts: [A, B],
    fingerprint: `${lobbyId}-${String(number)}`,
    ...rest,
  };
}
const group = (files: ReplayRound[], games = GAMES, minKnown = 3) =>
  groupReplays({ files, games, teamOf: TEAM_OF, minKnown });

describe('groupReplays', () => {
  it('makes one segment per lobby, its rounds in number order, in the game of its map', () => {
    const result = group([file('L1', 1), file('L1', 0, { winner: 1, attacker: 1 })]);
    expect(result.unassigned).toEqual([]);
    expect(result.games).toEqual([
      {
        n: 1,
        segments: [
          {
            lobbyId: 'L1',
            teams: ['A', 'B'],
            rounds: [
              {
                fileId: expect.any(Number) as number,
                number: 0,
                startedAt: 1_000_000,
                winner: 'B',
                attacker: 'B',
              },
              {
                fileId: expect.any(Number) as number,
                number: 1,
                startedAt: 1_240_000,
                winner: 'A',
                attacker: 'A',
              },
            ],
          },
        ],
        issues: [],
      },
    ]);
  });

  it('turns file sides into the match’s teams from the players, whatever the side order', () => {
    const result = group([file('L1', 0, { accounts: [B, A], winner: 0, attacker: 1 })]);
    expect(result.games[0]?.segments[0]?.teams).toEqual(['B', 'A']);
    expect(result.games[0]?.segments[0]?.rounds[0]).toMatchObject({ winner: 'B', attacker: 'A' });
  });

  it('needs enough known players on each side, and the two teams', () => {
    const few = [['a1', 'a2', 'x1', 'x2', 'x3'], B] as [string[], string[]];
    expect(group([file('L1', 0, { accounts: few })]).unassigned).toEqual([
      { kind: 'teams_unresolved', lobbyId: 'L1' },
    ]);
    expect(group([file('L1', 0, { accounts: few })], GAMES, 2).unassigned).toEqual([]);
    const sameTeam = [A, ['a1', 'a2', 'a3', 'b4', 'b5']] as [string[], string[]];
    expect(group([file('L1', 0, { accounts: sameTeam })]).unassigned).toEqual([
      { kind: 'teams_unresolved', lobbyId: 'L1' },
    ]);
  });

  it('refuses a lobby whose recordings name the teams differently', () => {
    const result = group([file('L1', 0), file('L1', 0, { accounts: [B, A] })]);
    expect(result.unassigned).toEqual([{ kind: 'teams_differ', lobbyId: 'L1' }]);
  });

  it('reports players outside both lineups, and a lineup’s player on the other side', () => {
    const accounts = [
      ['a1', 'a2', 'a3', 'a4', 'ringer'],
      ['b1', 'b2', 'b3', 'b4', 'a5'],
    ] as [string[], string[]];
    const issues = group([file('L1', 0, { accounts }), file('L1', 1, { accounts })]).games[0]
      ?.issues;
    expect(issues).toEqual([
      { kind: 'unlisted_player', lobbyId: 'L1', account: 'ringer', side: 'A' },
      { kind: 'crossed_player', lobbyId: 'L1', account: 'a5', side: 'B' },
    ]);
  });

  it('keeps one recording per round: a complete one first, then the first stored', () => {
    const cut = file('L1', 3, { complete: false, winner: null });
    const first = file('L1', 3);
    const second = file('L1', 3);
    const rounds = group([cut, second, first]).games[0]?.segments[0]?.rounds;
    expect(rounds).toHaveLength(1);
    expect(rounds?.[0]?.fileId).toBe(first.fileId);
  });

  it('flags two complete recordings of a round that disagree', () => {
    const result = group([file('L1', 2), file('L1', 2, { fingerprint: 'other feed' })]);
    expect(result.games[0]?.issues).toEqual([
      { kind: 'recordings_differ', lobbyId: 'L1', round: 2 },
    ]);
    const winners = group([file('L1', 2), file('L1', 2, { winner: 1 })]);
    expect(winners.games[0]?.issues).toEqual([
      { kind: 'recordings_differ', lobbyId: 'L1', round: 2 },
    ]);
  });

  it('puts each lobby in the game of its map, in a series', () => {
    const games = [
      { n: 1, map: 'Clubhouse' },
      { n: 2, map: 'Bank' },
      { n: 3, map: 'Chalet' },
    ];
    const result = group(
      [file('L1', 0), file('L2', 0, { map: 'Bank' }), file('L3', 0, { map: 'Bank' })],
      games,
    );
    expect(result.games.map((g) => [g.n, g.segments.map((s) => s.lobbyId)])).toEqual([
      [1, ['L1']],
      [2, ['L2', 'L3']],
      [3, []],
    ]);
  });

  it('leaves a lobby on a map outside the match, or shared by two games, to staff', () => {
    const shared = [
      { n: 1, map: 'Bank' },
      { n: 2, map: 'Bank' },
    ];
    expect(
      group([file('L1', 0, { map: null }), file('L2', 0, { map: 'Chalet' })]).unassigned,
    ).toEqual([
      { kind: 'unknown_map', lobbyId: 'L1' },
      { kind: 'unknown_map', lobbyId: 'L2' },
    ]);
    expect(group([file('L1', 0, { map: 'Bank' })], shared).unassigned).toEqual([
      { kind: 'ambiguous_map', lobbyId: 'L1' },
    ]);
  });
});
