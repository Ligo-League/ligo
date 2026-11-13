import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VETO, vetoSchema, type VetoFormat } from './settings.ts';
import {
  applyVetoStep,
  timeoutChoice,
  vetoState,
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

type Turn = Extract<VetoState, { status: 'turn' }>;

function stateOf(format: VetoFormat, records: VetoRecord[], pool = POOL): VetoState {
  const view = vetoState(format, pool, records);
  if (!view.ok) throw new Error(`Expected a veto state, got ${view.error}`);
  return view.state;
}
function turnOf(format: VetoFormat, records: VetoRecord[]): Turn {
  const state = stateOf(format, records);
  if (state.status !== 'turn') throw new Error('Expected a turn');
  return state;
}

/** Plays one step, failing the test if the engine refuses it. */
function play(
  format: VetoFormat,
  records: VetoRecord[],
  team: VetoTeam,
  choice: string,
): VetoRecord[] {
  const result = applyVetoStep(format, POOL, records, { team, choice });
  if (!result.ok) throw new Error(`Refused ${team} ${choice}: ${result.error}`);
  return [...records, ...result.added];
}

/** Plays a whole veto, each team taking the first choice offered. */
function playOut(format: VetoFormat): VetoRecord[] {
  let records: VetoRecord[] = [];
  for (;;) {
    const state = stateOf(format, records);
    if (state.status === 'done') return records;
    records = play(format, records, state.team, state.choices[0] as string);
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

  it('leaves the decider’s sides to the round difference, after the earlier maps', () => {
    const records = playOut(BO3);
    const state = stateOf(BO3, records);
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

describe('applyVetoStep: refusals', () => {
  it('refuses the team whose turn it is not', () => {
    expect(applyVetoStep(BO1, POOL, [], { team: 'B', choice: 'Bank' })).toEqual({
      ok: false,
      error: 'not_your_turn',
    });
  });

  it('refuses a map already banned, a map outside the pool, and a side for a ban', () => {
    const records = play(BO1, [], 'A', 'Bank');
    for (const choice of ['Bank', 'Oregon', 'attack']) {
      expect(applyVetoStep(BO1, POOL, records, { team: 'B', choice })).toEqual({
        ok: false,
        error: 'invalid_choice',
      });
    }
  });

  it('refuses a map for a side step', () => {
    const records = playOut(BO1).slice(0, 9);
    expect(applyVetoStep(BO1, POOL, records, { team: 'A', choice: 'Bank' })).toEqual({
      ok: false,
      error: 'invalid_choice',
    });
  });

  it('refuses any step once the veto is over', () => {
    expect(applyVetoStep(BO1, POOL, playOut(BO1), { team: 'A', choice: 'attack' })).toEqual({
      ok: false,
      error: 'finished',
    });
  });

  it('refuses a pool that does not fit the sequence', () => {
    expect(vetoState(BO1, POOL.slice(0, 7), [])).toEqual({ ok: false, error: 'pool_size' });
    expect(applyVetoStep(BO1, [...POOL, 'Oregon'], [], { team: 'A', choice: 'Bank' })).toEqual({
      ok: false,
      error: 'pool_size',
    });
  });

  it('refuses stored steps that do not follow the sequence', () => {
    const records = play(BO1, [], 'A', 'Bank');
    const wrong = [{ ...records[0], team: 'B' } as VetoRecord];
    expect(vetoState(BO1, POOL, wrong)).toEqual({ ok: false, error: 'invalid_record' });
  });
});

describe('timeoutChoice', () => {
  it('takes the choice the random index points at, wrapping around', () => {
    const turn = turnOf(BO1, []);
    expect(timeoutChoice(turn, 0)).toBe('Bank');
    expect(timeoutChoice(turn, 10)).toBe('Chalet');
  });

  it('marks a step played by the clock as timed out', () => {
    const result = applyVetoStep(BO1, POOL, [], { team: 'A', choice: 'Villa', timedOut: true });
    expect(result.ok && result.added).toEqual([
      { team: 'A', action: 'ban', map: 'Villa', side: null, game: null, timedOut: true },
    ]);
  });
});

describe('veto: properties', () => {
  const formats = fc.constantFrom(
    ['bo1', BO1, 1] as const,
    ['bo3', BO3, 3] as const,
    ['bo5', BO5, 5] as const,
  );

  it('ends any run with best-of maps, no map twice, the turns of the sequence, the last map as decider', () => {
    fc.assert(
      fc.property(
        formats,
        fc.array(fc.nat(), { minLength: 40, maxLength: 40 }),
        ([, format, bestOf], picks) => {
          let records: VetoRecord[] = [];
          let state = stateOf(format, records);
          let index = 0;
          while (state.status === 'turn') {
            const choice = timeoutChoice(state, picks[index++] ?? 0);
            records = play(format, records, state.team, choice);
            state = stateOf(format, records);
          }
          expect(state.games).toHaveLength(bestOf);
          const maps = [
            ...state.bans.map((ban) => ban.map),
            ...state.games.map((game) => game.map),
          ];
          expect(new Set(maps).size).toBe(POOL.length);
          expect(maps.sort()).toEqual([...POOL].sort());
          // Bans and picks in stored order are the sequence, team for team.
          const chosen = records
            .filter((record) => record.action === 'ban' || record.action === 'pick')
            .map((record) => `${record.team ?? ''}_${record.action}`);
          expect(chosen).toEqual(format.sequence);
          const decider = records.find((record) => record.action === 'decider');
          expect(decider?.map).toBe(state.games.at(-1)?.map);
        },
      ),
    );
  });

  it('refuses every choice that is not offered, and every team whose turn it is not', () => {
    fc.assert(
      fc.property(
        formats,
        fc.nat({ max: 20 }),
        fc.constantFrom(...POOL, 'attack', 'defense', 'Oregon'),
        ([, format], steps, choice) => {
          let records: VetoRecord[] = [];
          for (let step = 0; step < steps; step += 1) {
            const state = stateOf(format, records);
            if (state.status === 'done') break;
            records = play(format, records, state.team, state.choices[0] as string);
          }
          const state = stateOf(format, records);
          if (state.status === 'done') return;
          const other = state.team === 'A' ? 'B' : 'A';
          expect(applyVetoStep(format, POOL, records, { team: other, choice })).toEqual({
            ok: false,
            error: 'not_your_turn',
          });
          const result = applyVetoStep(format, POOL, records, { team: state.team, choice });
          expect(result.ok).toBe(state.choices.includes(choice));
        },
      ),
    );
  });
});
