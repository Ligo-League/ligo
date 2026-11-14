import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VETO, vetoSchema, type VetoFormat } from './settings.ts';
import {
  applyVetoStep,
  timeoutChoice,
  vetoState,
  type VetoConfig,
  type VetoOpening,
  type VetoRecord,
  type VetoState,
  type VetoTeam,
} from './veto.ts';

// The current competitive pool (seeded for Season 3).
const POOL = [
  'Bank',
  'Chalet',
  'Clubhouse',
  'Nighthaven Labs',
  'Lair',
  'Villa',
  'Kafe Dostoyevsky',
  'Border',
  'Fortress',
];
const BO1 = DEFAULT_VETO.formats.bo1 as VetoFormat;
const BO3 = DEFAULT_VETO.formats.bo3 as VetoFormat;
const BO5 = DEFAULT_VETO.formats.bo5 as VetoFormat;
const BO3_BY_ROUNDS: VetoFormat = { ...BO3, decider_side: 'round_difference' };

const config = (
  format: VetoFormat,
  opening: VetoOpening = 'ranked',
  pool: readonly string[] = POOL,
): VetoConfig => ({ format, pool, opening });

type Turn = Extract<VetoState, { status: 'turn' }>;

function stateOf(
  format: VetoFormat,
  records: VetoRecord[],
  opening: VetoOpening = 'ranked',
): VetoState {
  const view = vetoState(config(format, opening), records);
  if (!view.ok) throw new Error(`Expected a veto state, got ${view.error}`);
  return view.state;
}
function turnOf(format: VetoFormat, records: VetoRecord[], opening: VetoOpening = 'ranked'): Turn {
  const state = stateOf(format, records, opening);
  if (state.status !== 'turn') throw new Error('Expected a turn');
  return state;
}

/** Plays one step, failing the test if the engine refuses it. */
function play(
  format: VetoFormat,
  records: VetoRecord[],
  team: VetoTeam,
  choice: string,
  opening: VetoOpening = 'ranked',
  coin: VetoTeam = 'A',
): VetoRecord[] {
  const result = applyVetoStep(config(format, opening), records, { team, choice, coin });
  if (!result.ok) throw new Error(`Refused ${team} ${choice}: ${result.error}`);
  return [...records, ...result.added];
}

/** Plays a whole veto, each team taking the first choice offered. */
function playOut(format: VetoFormat, opening: VetoOpening = 'ranked'): VetoRecord[] {
  let records: VetoRecord[] = [];
  for (;;) {
    const state = stateOf(format, records, opening);
    if (state.status === 'done') return records;
    records = play(format, records, state.team, state.choices[0] as string, opening);
  }
}

describe('vetoSchema', () => {
  it('holds the sequences of design doc section 5 by default, 4 minutes per step', () => {
    expect(vetoSchema.parse({})).toEqual(DEFAULT_VETO);
    expect(BO1.sequence).toEqual(Array.from({ length: 4 }, () => ['A_ban', 'B_ban']).flat());
    expect(BO3.sequence).toEqual([
      ...['A_ban', 'B_ban', 'A_ban', 'B_ban', 'A_pick', 'B_pick', 'A_ban', 'B_ban'],
    ]);
    expect(BO5.sequence).toEqual([
      ...['A_ban', 'B_ban', 'A_pick', 'B_pick', 'A_ban', 'B_ban', 'A_pick', 'B_pick'],
    ]);
    expect(DEFAULT_VETO.step_seconds).toBe(240);
    // BLAST: a new coin toss gives the decider's side (O-11).
    expect([BO1.decider_side, BO3.decider_side, BO5.decider_side]).toEqual([
      'team_a',
      'coin',
      'coin',
    ]);
  });

  it.each([
    ['a BO3 with one pick', { formats: { bo3: { sequence: ['A_pick'], decider_side: 'team_a' } } }],
    ['an unknown step', { formats: { bo1: { sequence: ['C_ban'], decider_side: 'team_a' } } }],
    [
      'a format that is not a best-of',
      { formats: { final: { sequence: [], decider_side: 'team_a' } } },
    ],
    ['a step shorter than 30 seconds', { step_seconds: 10 }],
  ])('refuses %s', (_label, value) => {
    expect(vetoSchema.safeParse(value).success).toBe(false);
  });
});

describe('vetoState: BO1', () => {
  it('starts with team A banning, any map of the pool', () => {
    expect(turnOf(BO1, [])).toEqual({
      status: 'turn',
      step: 0,
      team: 'A',
      action: 'ban',
      game: null,
      map: null,
      choices: POOL,
      firstBan: 'A',
      sideSelection: 'A',
    });
  });

  it('alternates bans and leaves banned maps out of the choices', () => {
    const records = play(BO1, [], 'A', 'Bank');
    expect(turnOf(BO1, records)).toMatchObject({ step: 1, team: 'B', action: 'ban' });
    expect(turnOf(BO1, records).choices).not.toContain('Bank');
  });

  it('plays the remaining map, then A picks the starting side and B the overtime side', () => {
    let records: VetoRecord[] = [];
    for (const [index, map] of POOL.slice(0, 8).entries()) {
      records = play(BO1, records, index % 2 === 0 ? 'A' : 'B', map);
    }
    expect(records.at(-1)).toEqual({
      team: null,
      action: 'decider',
      map: 'Fortress',
      side: null,
      choice: null,
      game: 1,
      timedOut: false,
    });
    expect(turnOf(BO1, records)).toMatchObject({
      team: 'A',
      action: 'side',
      game: 1,
      map: 'Fortress',
      choices: ['attack', 'defense'],
    });
    records = play(BO1, records, 'A', 'defense');
    expect(turnOf(BO1, records)).toMatchObject({ team: 'B', action: 'ot_side', game: 1 });
    records = play(BO1, records, 'B', 'attack');
    expect(stateOf(BO1, records)).toEqual({
      status: 'done',
      bans: POOL.slice(0, 8).map((map, index) => ({ team: index % 2 === 0 ? 'A' : 'B', map })),
      games: [
        {
          n: 1,
          map: 'Fortress',
          pickedBy: null,
          side: { team: 'A', side: 'defense' },
          otSide: { team: 'B', side: 'attack' },
        },
      ],
      firstBan: 'A',
      sideSelection: 'A',
    });
  });
});

describe('vetoState: BO3 and BO5', () => {
  it("lets the picker's opponent pick the starting side, the picker the overtime side", () => {
    let records: VetoRecord[] = [];
    for (const [index, map] of POOL.slice(0, 4).entries()) {
      records = play(BO3, records, index % 2 === 0 ? 'A' : 'B', map);
    }
    records = play(BO3, records, 'A', 'Lair');
    expect(turnOf(BO3, records)).toMatchObject({ team: 'B', action: 'side', game: 1, map: 'Lair' });
    records = play(BO3, records, 'B', 'attack');
    expect(turnOf(BO3, records)).toMatchObject({ team: 'A', action: 'ot_side', game: 1 });
    records = play(BO3, records, 'A', 'defense');
    expect(turnOf(BO3, records)).toMatchObject({ team: 'B', action: 'pick', game: 2 });
  });

  it('tosses a new coin for the decider: its winner picks the starting side (BLAST, O-11)', () => {
    let records: VetoRecord[] = [];
    while (!records.some((record) => record.action === 'decider')) {
      const state = turnOf(BO3, records);
      records = play(BO3, records, state.team, state.choices[0] as string, 'ranked', 'B');
    }
    expect(records.slice(-2)).toEqual([
      {
        team: null,
        action: 'decider',
        map: 'Fortress',
        side: null,
        choice: null,
        game: 3,
        timedOut: false,
      },
      { team: 'B', action: 'toss', map: null, side: null, choice: null, game: 3, timedOut: false },
    ]);
    expect(turnOf(BO3, records)).toMatchObject({
      team: 'B',
      action: 'side',
      game: 3,
      map: 'Fortress',
    });
    records = play(BO3, records, 'B', 'defense');
    expect(turnOf(BO3, records)).toMatchObject({ team: 'A', action: 'ot_side', game: 3 });
    records = play(BO3, records, 'A', 'attack');
    const state = stateOf(BO3, records);
    expect(state.status === 'done' && state.games[2]).toMatchObject({
      pickedBy: null,
      side: { team: 'B', side: 'defense' },
      otSide: { team: 'A', side: 'attack' },
    });
  });

  it('needs a coin from the caller when a toss falls due', () => {
    let records: VetoRecord[] = [];
    let state = turnOf(BO3, records);
    // The last ban leaves the decider, whose toss is then due.
    while (!(state.action === 'ban' && state.choices.length === 2)) {
      records = play(BO3, records, state.team, state.choices[0] as string);
      state = turnOf(BO3, records);
    }
    const last = { team: state.team, choice: state.choices[0] as string };
    expect(() => applyVetoStep(config(BO3), records, last)).toThrow(/coin/);
  });

  it('can leave the decider’s sides to the round difference, after the earlier maps', () => {
    const records = playOut(BO3_BY_ROUNDS);
    const state = stateOf(BO3_BY_ROUNDS, records);
    expect(state.status === 'done' && state.games.map((game) => game.n)).toEqual([1, 2, 3]);
    expect(state.status === 'done' && state.games[2]).toMatchObject({
      pickedBy: null,
      side: null,
      otSide: null,
    });
  });

  it('plays five maps in a BO5', () => {
    const state = stateOf(BO5, playOut(BO5));
    expect(state.status === 'done' && state.games).toHaveLength(5);
  });
});

// BLAST R6 global rulebook 2025, 5.1.3.2, between teams of equal rank (O-12): team A is the
// winner of the coin toss the server made before the veto.
describe('vetoState: the coin toss opening', () => {
  it('lets the BO1 winner take side selection or the first-ban decision', () => {
    expect(turnOf(BO1, [], 'coin')).toEqual({
      status: 'turn',
      step: 0,
      team: 'A',
      action: 'toss_choice',
      game: null,
      map: null,
      choices: ['side_selection', 'first_ban'],
      firstBan: null,
      sideSelection: null,
    });
  });

  it('gives the other decision to the loser: side selection taken, B says who bans first', () => {
    let records = play(BO1, [], 'A', 'side_selection', 'coin');
    expect(turnOf(BO1, records, 'coin')).toMatchObject({
      team: 'B',
      action: 'first_ban',
      choices: ['B', 'A'],
      sideSelection: 'A',
      firstBan: null,
    });
    records = play(BO1, records, 'B', 'A', 'coin');
    expect(turnOf(BO1, records, 'coin')).toMatchObject({
      team: 'A',
      action: 'ban',
      firstBan: 'A',
      sideSelection: 'A',
    });
  });

  it('lets the side selection go to the loser when the winner decides who bans first', () => {
    let records = play(BO1, [], 'A', 'first_ban', 'coin');
    expect(turnOf(BO1, records, 'coin')).toMatchObject({
      team: 'A',
      action: 'first_ban',
      choices: ['A', 'B'],
      sideSelection: 'B',
    });
    // A sends B to ban first: the sequence's "A ban" steps are B's.
    records = play(BO1, records, 'A', 'B', 'coin');
    expect(turnOf(BO1, records, 'coin')).toMatchObject({ team: 'B', action: 'ban', step: 2 });
    for (;;) {
      const state = turnOf(BO1, records, 'coin');
      if (state.action === 'side') {
        expect(state.team).toBe('B');
        break;
      }
      records = play(BO1, records, state.team, state.choices[0] as string, 'coin');
    }
    records = play(BO1, records, 'B', 'attack', 'coin');
    expect(turnOf(BO1, records, 'coin')).toMatchObject({ team: 'A', action: 'ot_side' });
  });

  it('stores the two decisions as steps of their own', () => {
    const result = applyVetoStep(config(BO1, 'coin'), [], { team: 'A', choice: 'first_ban' });
    expect(result.ok && result.added).toEqual([
      {
        team: 'A',
        action: 'toss_choice',
        map: null,
        side: null,
        choice: 'first_ban',
        game: null,
        timedOut: false,
      },
    ]);
  });

  it('lets the BO3 and BO5 winner decide who bans first, with no side selection to take', () => {
    for (const format of [BO3, BO5]) {
      expect(turnOf(format, [], 'coin')).toMatchObject({
        team: 'A',
        action: 'first_ban',
        choices: ['A', 'B'],
        sideSelection: null,
      });
    }
  });

  it('refuses a decision that is not offered', () => {
    for (const choice of ['Bank', 'attack', 'A']) {
      expect(applyVetoStep(config(BO1, 'coin'), [], { team: 'A', choice })).toEqual({
        ok: false,
        error: 'invalid_choice',
      });
    }
    expect(applyVetoStep(config(BO1, 'coin'), [], { team: 'B', choice: 'first_ban' })).toEqual({
      ok: false,
      error: 'not_your_turn',
    });
  });
});

describe('applyVetoStep: refusals', () => {
  it('refuses the team whose turn it is not', () => {
    expect(applyVetoStep(config(BO1), [], { team: 'B', choice: 'Bank' })).toEqual({
      ok: false,
      error: 'not_your_turn',
    });
  });

  it('refuses a map already banned, a map outside the pool, and a side for a ban', () => {
    const records = play(BO1, [], 'A', 'Bank');
    for (const choice of ['Bank', 'Oregon', 'attack']) {
      expect(applyVetoStep(config(BO1), records, { team: 'B', choice })).toEqual({
        ok: false,
        error: 'invalid_choice',
      });
    }
  });

  it('refuses a map for a side step', () => {
    const records = playOut(BO1).slice(0, 9);
    expect(applyVetoStep(config(BO1), records, { team: 'A', choice: 'Bank' })).toEqual({
      ok: false,
      error: 'invalid_choice',
    });
  });

  it('refuses any step once the veto is over', () => {
    expect(applyVetoStep(config(BO1), playOut(BO1), { team: 'A', choice: 'attack' })).toEqual({
      ok: false,
      error: 'finished',
    });
  });

  it('refuses a pool that does not fit the sequence', () => {
    expect(vetoState(config(BO1, 'ranked', POOL.slice(0, 7)), [])).toEqual({
      ok: false,
      error: 'pool_size',
    });
    expect(
      applyVetoStep(config(BO1, 'ranked', [...POOL, 'Oregon']), [], { team: 'A', choice: 'Bank' }),
    ).toEqual({
      ok: false,
      error: 'pool_size',
    });
  });

  it('refuses stored steps that do not follow the sequence', () => {
    const records = play(BO1, [], 'A', 'Bank');
    const wrong = [{ ...records[0], team: 'B' } as VetoRecord];
    expect(vetoState(config(BO1), wrong)).toEqual({ ok: false, error: 'invalid_record' });
  });
});

describe('timeoutChoice', () => {
  it('takes the choice the random index points at, wrapping around', () => {
    const turn = turnOf(BO1, []);
    expect(timeoutChoice(turn, 0)).toBe('Bank');
    expect(timeoutChoice(turn, 10)).toBe('Chalet');
  });

  it('marks a step played by the clock as timed out', () => {
    const result = applyVetoStep(config(BO1), [], { team: 'A', choice: 'Villa', timedOut: true });
    expect(result.ok && result.added).toEqual([
      {
        team: 'A',
        action: 'ban',
        map: 'Villa',
        side: null,
        choice: null,
        game: null,
        timedOut: true,
      },
    ]);
  });
});

describe('veto: properties', () => {
  const formats = fc.constantFrom(
    ['bo1', BO1, 1] as const,
    ['bo3', BO3, 3] as const,
    ['bo3', BO3_BY_ROUNDS, 3] as const,
    ['bo5', BO5, 5] as const,
  );
  const openings = fc.constantFrom<VetoOpening>('ranked', 'coin');
  const teams = fc.constantFrom<VetoTeam>('A', 'B');
  const other = (team: VetoTeam): VetoTeam => (team === 'A' ? 'B' : 'A');

  it('ends any run with best-of maps, no map twice, the turns of the sequence, the last map as decider', () => {
    fc.assert(
      fc.property(
        formats,
        openings,
        fc.array(fc.nat(), { minLength: 40, maxLength: 40 }),
        teams,
        ([, format, bestOf], opening, picks, coin) => {
          let records: VetoRecord[] = [];
          let state = stateOf(format, records, opening);
          let index = 0;
          while (state.status === 'turn') {
            const choice = timeoutChoice(state, picks[index++] ?? 0);
            records = play(format, records, state.team, choice, opening, coin);
            state = stateOf(format, records, opening);
          }
          expect(state.games).toHaveLength(bestOf);
          const maps = [
            ...state.bans.map((ban) => ban.map),
            ...state.games.map((game) => game.map),
          ];
          expect(new Set(maps).size).toBe(POOL.length);
          expect(maps.sort()).toEqual([...POOL].sort());
          // Bans and picks in stored order are the sequence, its "A" being the first banner.
          const chosen = records
            .filter((record) => record.action === 'ban' || record.action === 'pick')
            .map((record) => `${record.team === state.firstBan ? 'A' : 'B'}_${record.action}`);
          expect(chosen).toEqual(format.sequence);
          const decider = records.find((record) => record.action === 'decider');
          expect(decider?.map).toBe(state.games.at(-1)?.map);
          if (opening === 'ranked') expect(state.firstBan).toBe('A');
        },
      ),
    );
  });

  it('gives each map’s starting side to one team and its overtime side to the other', () => {
    fc.assert(
      fc.property(
        formats,
        openings,
        fc.array(fc.nat(), { minLength: 40, maxLength: 40 }),
        teams,
        ([, format], opening, picks, coin) => {
          let records: VetoRecord[] = [];
          let state = stateOf(format, records, opening);
          let index = 0;
          while (state.status === 'turn') {
            const choice = timeoutChoice(state, picks[index++] ?? 0);
            records = play(format, records, state.team, choice, opening, coin);
            state = stateOf(format, records, opening);
          }
          for (const game of state.games) {
            if (game.side === null) {
              expect(format.decider_side).toBe('round_difference');
              continue;
            }
            expect(game.otSide?.team).toBe(other(game.side.team));
            if (game.pickedBy !== null) expect(game.side.team).toBe(other(game.pickedBy));
          }
          // Side selection is a BO1's prize: it decides the one map's starting side.
          if (format.decider_side === 'team_a') {
            expect(state.sideSelection).not.toBeNull();
            expect(state.games.at(-1)?.side?.team).toBe(state.sideSelection);
          }
          // A new coin, never a choice, gives the decider's side.
          if (format.decider_side === 'coin') {
            expect(records.find((record) => record.action === 'toss')?.team).toBe(coin);
            expect(state.games.at(-1)?.side?.team).toBe(coin);
          }
        },
      ),
    );
  });

  it('refuses every choice that is not offered, and every team whose turn it is not', () => {
    fc.assert(
      fc.property(
        formats,
        openings,
        fc.nat({ max: 22 }),
        fc.constantFrom(
          ...POOL,
          'attack',
          'defense',
          'Oregon',
          'side_selection',
          'first_ban',
          'A',
          'B',
        ),
        ([, format], opening, steps, choice) => {
          let records: VetoRecord[] = [];
          for (let step = 0; step < steps; step += 1) {
            const state = stateOf(format, records, opening);
            if (state.status === 'done') break;
            records = play(format, records, state.team, state.choices[0] as string, opening);
          }
          const state = stateOf(format, records, opening);
          if (state.status === 'done') return;
          const setup = config(format, opening);
          expect(
            applyVetoStep(setup, records, { team: other(state.team), choice, coin: 'A' }),
          ).toEqual({
            ok: false,
            error: 'not_your_turn',
          });
          const result = applyVetoStep(setup, records, { team: state.team, choice, coin: 'A' });
          expect(result.ok).toBe(state.choices.includes(choice));
        },
      ),
    );
  });
});
