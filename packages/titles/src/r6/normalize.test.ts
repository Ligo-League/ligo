import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { R6_STATS } from './stats.ts';
import { normalizeR6, type R6Unit, type R6UnitPlayer } from './normalize.ts';

// The R6 normaliser (design doc sections 9 and 10): one round of the r6-dissect fork's JSON
// becomes a ParsedUnit. These rounds are built by hand in the fork's shape; the golden tests run
// the same code on real rounds.

const ZERO = '00000000-0000-0000-0000-000000000000';
const CTX = { parser: 'r6-0123456789abcdef', fileSha256: 'ab'.repeat(32), tradeWindowS: 10 };

/** Team 0 attacks with a1..a5, team 1 defends with d1..d5. */
const NAMES = ['a1', 'a2', 'a3', 'a4', 'a5', 'd1', 'd2', 'd3', 'd4', 'd5'];
const sideOf = (name: string) => (name.startsWith('a') ? 0 : 1);

type Feed = Record<string, unknown>;
const at = (type: string, elapsed: number, rest: Feed = {}): Feed => ({
  type: { name: type, id: 0 },
  // The countdown runs from 180 in the action phase: never an order (CLAUDE.md).
  time: '0:00',
  timeInSeconds: Math.max(0, 180 - elapsed),
  phase: 'Action',
  elapsedSeconds: elapsed,
  ...rest,
});
const kill = (actor: string, target: string, elapsed: number, rest: Feed = {}) =>
  at('Kill', elapsed, { username: actor, target, headshot: false, ...rest });
const death = (target: string, elapsed: number) => at('Death', elapsed, { username: target });
const leave = (target: string, elapsed: number) => at('PlayerLeave', elapsed, { username: target });
const swap = (actor: string, operator: string) =>
  at('OperatorSwap', -10, { username: actor, phase: 'Prep', operator: { name: operator, id: 1 } });

interface RoundSpec {
  feed?: Feed[];
  /** The winning team, or null for a round that never ended. */
  winner?: 0 | 1 | null;
  winCondition?: string;
  names?: string[];
  accounts?: Record<string, string>;
  /** Scoreboard values that differ from the feed. */
  scoreboard?: Record<string, { kills?: number; died?: boolean; assists?: number }>;
}

/** A round in the fork's JSON shape; the scoreboard agrees with the feed unless told otherwise. */
function round(spec: RoundSpec = {}): Record<string, unknown> {
  const names = spec.names ?? NAMES;
  const feed = spec.feed ?? [];
  const winner = spec.winner === undefined ? 0 : spec.winner;
  const kills = (name: string) =>
    feed.filter((e) => isType(e, 'Kill') && e.username === name && e.teamKill !== true).length;
  const died = (name: string) =>
    feed.some(
      (e) =>
        (isType(e, 'Kill') && e.target === name) || (isType(e, 'Death') && e.username === name),
    );
  return {
    gameVersion: 'Y11S3_Alpha04',
    codeVersion: 9_700_000,
    timestamp: '2026-11-10T20:31:05Z',
    matchType: { name: 'CustomGameOnline', id: 2 },
    map: { name: 'ClubHouseY10', id: 1 },
    site: '2F Bar, 2F Cash Room',
    recordingPlayerID: 1,
    recordingProfileID: 'feedf00d-0000-4000-8000-000000000001',
    gamemode: { name: 'Bomb', id: 1 },
    roundsPerMatch: 12,
    roundsPerMatchOvertime: 3,
    roundNumber: 4,
    overtimeRoundNumber: 0,
    matchID: 'lobby-1',
    teams: [0, 1].map((idx) => ({
      name: idx === 0 ? 'ALPHA' : 'BRAVO',
      startingScore: idx === 0 ? 3 : 1,
      score: idx === 0 ? 3 + Number(winner === 0) : 1 + Number(winner === 1),
      won: winner === idx,
      ...(winner === idx ? { winCondition: spec.winCondition ?? 'KilledOpponents' } : {}),
      role: idx === 0 ? 'Attack' : 'Defense',
    })),
    players: names.map((name, index) => ({
      id: index,
      profileID: spec.accounts?.[name] ?? ZERO,
      username: name,
      teamIndex: sideOf(name),
      operator: { name: sideOf(name) === 0 ? 'Ash' : 'Mute', id: 1 },
    })),
    matchFeedback: feed,
    stats: names.map((name) => ({
      username: name,
      score: 0,
      kills: spec.scoreboard?.[name]?.kills ?? kills(name),
      died: spec.scoreboard?.[name]?.died ?? died(name),
      assists: spec.scoreboard?.[name]?.assists ?? 0,
      headshots: 0,
    })),
  };
}
function isType(event: Feed, name: string): boolean {
  return (event.type as { name: string }).name === name;
}

function unit(spec: RoundSpec = {}, tradeWindowS = 10): R6Unit {
  const result = normalizeR6(round(spec), { ...CTX, tradeWindowS });
  if (!result.ok) throw new Error(result.message);
  return result.unit;
}
function player(of: R6Unit, name: string): R6UnitPlayer {
  const found = of.players.find((p) => p.name === name);
  if (!found) throw new Error(`no player ${name}`);
  return found;
}
const stat = (of: R6Unit, name: string, key: keyof R6UnitPlayer['stats']) =>
  player(of, name).stats[key];

describe('normalizeR6: the round', () => {
  it('reads the header, the parser build and the file hash', () => {
    const u = unit();
    expect(u).toMatchObject({
      schema: 1,
      title: 'r6',
      parser: CTX.parser,
      file_sha256: CTX.fileSha256,
      lobby_id: 'lobby-1',
      unit: { kind: 'round', number: 4 },
      started_at: '2026-11-10T20:31:05Z',
      game_version: 'Y11S3_Alpha04',
      match_type: 'CustomGameOnline',
      map: 'ClubHouseY10',
      site: '2F Bar, 2F Cash Room',
      mode: 'Bomb',
      recorded_by: 'feedf00d-0000-4000-8000-000000000001',
      params: { trade_window_s: 10 },
      warnings: [],
    });
  });

  it('names each side: role, winner, win condition and score before the round', () => {
    expect(unit({ winner: 1, winCondition: 'Time' }).sides).toEqual([
      { idx: 0, role: 'Attack', won: false, win_condition: null, score_before: 3 },
      { idx: 1, role: 'Defense', won: true, win_condition: 'Time', score_before: 1 },
    ]);
  });

  it('marks a round without a winner incomplete', () => {
    const u = unit({ winner: null });
    expect(u.complete).toBe(false);
    expect(u.sides.map((s) => s.won)).toEqual([false, false]);
    expect(unit().complete).toBe(true);
  });

  it('marks a round planted from its win condition only (M-50)', () => {
    expect(unit({ winner: 0, winCondition: 'DefusedBomb' }).planted).toBe(true);
    expect(unit({ winner: 1, winCondition: 'DisabledDefuser' }).planted).toBe(true);
    const plantedThenKilled = unit({
      winner: 0,
      feed: [
        at('DefuserPlantStart', 60, { username: 'a1' }),
        at('DefuserPlantComplete', 67, { username: 'a1' }),
      ],
    });
    expect(plantedThenKilled.planted).toBe(false);
    expect(plantedThenKilled.events).toEqual([]);
  });

  it('identifies players by profileID, and a zeroed one as unknown', () => {
    const u = unit({ accounts: { a1: 'ee63564b-1111-4222-8333-444455556666' } });
    expect(player(u, 'a1').account).toBe('ee63564b-1111-4222-8333-444455556666');
    expect(player(u, 'd1').account).toBeNull();
    expect(unit({ names: NAMES }).recorded_by).not.toBeNull();
  });

  it('gives the final operator, and each swap as an event', () => {
    const u = unit({ feed: [swap('a1', 'Thermite'), swap('a1', 'Ash')] });
    expect(player(u, 'a1').operator).toBe('Ash');
    expect(u.events).toEqual([
      { seq: 0, type: 'swap', elapsed_s: -10, actor: 0, operator: 'Thermite' },
      { seq: 1, type: 'swap', elapsed_s: -10, actor: 0, operator: 'Ash' },
    ]);
  });

  it('gives every R6 metric except plants and defuses (M-50)', () => {
    const keys = R6_STATS.metrics
      .map((m) => m.key)
      .filter((key) => key !== 'plants' && key !== 'defuses');
    expect(Object.keys(player(unit(), 'a1').stats).sort()).toEqual(keys.sort());
  });
});

describe('normalizeR6: the feed', () => {
  it('keeps feed order and the elapsed time, never the countdown', () => {
    // After a plant the countdown restarts: 3 s left of the action phase, then 40 s of defuser.
    const u = unit({
      feed: [
        kill('a1', 'd1', 177),
        { ...kill('d2', 'a2', 185), timeInSeconds: 40, phase: 'PostPlant' },
        { ...kill('a3', 'd2', 190), timeInSeconds: 35, phase: 'PostPlant' },
      ],
    });
    expect(u.events.map((e) => [e.seq, e.elapsed_s])).toEqual([
      [0, 177],
      [1, 185],
      [2, 190],
    ]);
  });

  it('counts kills, headshots and deaths from the feed, and assists from the scoreboard', () => {
    const u = unit({
      feed: [kill('a1', 'd1', 20, { headshot: true }), kill('a1', 'd2', 30)],
      scoreboard: { a2: { assists: 2 } },
    });
    expect(player(u, 'a1').stats).toMatchObject({ kills: 2, headshots: 1, deaths: 0 });
    expect(stat(u, 'd1', 'deaths')).toBe(1);
    expect(stat(u, 'a2', 'assists')).toBe(2);
    expect(u.events[0]).toEqual({
      seq: 0,
      type: 'kill',
      elapsed_s: 20,
      actor: 0,
      target: 5,
      headshot: true,
      team_kill: false,
      trade: false,
    });
  });

  it('counts a team kill as the victim’s death, and no kill for its author', () => {
    const u = unit({ feed: [kill('a1', 'a2', 20, { teamKill: true, headshot: true })] });
    expect(player(u, 'a1').stats).toMatchObject({ kills: 0, headshots: 0 });
    expect(stat(u, 'a2', 'deaths')).toBe(1);
    expect(u.events[0]).toMatchObject({ type: 'kill', team_kill: true });
  });

  it('reads a kill between teammates as a team kill even without the flag', () => {
    const u = unit({ feed: [kill('d1', 'd2', 20)], scoreboard: { d1: { kills: 0 } } });
    expect(stat(u, 'd1', 'kills')).toBe(0);
    expect(u.events[0]).toMatchObject({ team_kill: true });
  });

  it('counts a Death event as a death without a killer', () => {
    const u = unit({ feed: [death('d1', 15)] });
    expect(stat(u, 'd1', 'deaths')).toBe(1);
    expect(u.events[0]).toEqual({ seq: 0, type: 'death', elapsed_s: 15, target: 5 });
  });

  it('takes a player who left out of the round without a death', () => {
    const u = unit({ feed: [leave('a3', 50)] });
    expect(player(u, 'a3').stats).toMatchObject({ deaths: 0, rounds_survived: 0, rounds_kost: 0 });
    expect(player(u, 'a3').detail.left).toBe(true);
    expect(u.events[0]).toEqual({ seq: 0, type: 'leave', elapsed_s: 50, target: 2 });
  });

  it('keeps an unknown name in the feed without a player, and warns', () => {
    const u = unit({ feed: [kill('ghost', 'd1', 20)] });
    expect(u.events[0]).toMatchObject({ actor: null, target: 5 });
    expect(stat(u, 'd1', 'deaths')).toBe(1);
    expect(u.warnings).toEqual([{ code: 'unknown_player', name: 'ghost' }]);
  });

  it('warns when the scoreboard disagrees with the feed', () => {
    const u = unit({
      feed: [kill('a1', 'd1', 20)],
      scoreboard: { a1: { kills: 2 }, d2: { died: true } },
    });
    expect(stat(u, 'a1', 'kills')).toBe(1);
    expect(u.warnings).toEqual([
      { code: 'scoreboard_kills', name: 'a1' },
      { code: 'scoreboard_deaths', name: 'd2' },
    ]);
  });
});

describe('normalizeR6: opening, trades and KOST', () => {
  it('makes the first kill the opening kill and death, and only that one', () => {
    const u = unit({ feed: [kill('a1', 'd1', 20), kill('d2', 'a2', 25)] });
    expect(player(u, 'a1').stats).toMatchObject({ opening_kills: 1, opening_deaths: 0 });
    expect(stat(u, 'd1', 'opening_deaths')).toBe(1);
    expect(stat(u, 'd2', 'opening_kills')).toBe(0);
    expect(stat(u, 'a2', 'opening_deaths')).toBe(0);
  });

  it('makes a first death without an opposing killer an opening death only', () => {
    for (const first of [death('d1', 10), kill('d2', 'd1', 10, { teamKill: true })]) {
      const u = unit({ feed: [first, kill('a1', 'd3', 20)] });
      expect(stat(u, 'd1', 'opening_deaths')).toBe(1);
      expect(u.players.reduce((sum, p) => sum + p.stats.opening_kills, 0)).toBe(0);
    }
  });

  it('a teammate killing the killer within the window trades the death', () => {
    const u = unit({ feed: [kill('d1', 'a1', 30), kill('a2', 'd1', 40)] });
    expect(player(u, 'a1').stats).toMatchObject({ traded_deaths: 1, rounds_kost: 1 });
    expect(stat(u, 'a2', 'trade_kills')).toBe(1);
    expect(u.events[1]).toMatchObject({ trade: true });
  });

  it('does not trade past the window, which is a parameter', () => {
    const late = unit({ feed: [kill('d1', 'a1', 30), kill('a2', 'd1', 40.5)] });
    expect(stat(late, 'a1', 'traded_deaths')).toBe(0);
    expect(stat(late, 'a2', 'trade_kills')).toBe(0);
    const narrow = unit({ feed: [kill('d1', 'a1', 30), kill('a2', 'd1', 35)] }, 3);
    expect(stat(narrow, 'a1', 'traded_deaths')).toBe(0);
    expect(narrow.params.trade_window_s).toBe(3);
  });

  it('only a teammate of the victim trades, never by a team kill', () => {
    const u = unit({ feed: [kill('d1', 'a1', 30), kill('d2', 'd1', 32, { teamKill: true })] });
    expect(stat(u, 'a1', 'traded_deaths')).toBe(0);
    expect(stat(u, 'd2', 'trade_kills')).toBe(0);
  });

  it('one kill trades every death its target caused in the window, and counts once', () => {
    const u = unit({
      feed: [kill('d1', 'a1', 30), kill('d1', 'a2', 33), kill('a3', 'd1', 38)],
    });
    expect(stat(u, 'a1', 'traded_deaths')).toBe(1);
    expect(stat(u, 'a2', 'traded_deaths')).toBe(1);
    expect(stat(u, 'a3', 'trade_kills')).toBe(1);
  });

  it('counts KOST from a kill, a survival or a trade, without objectives yet (M-50)', () => {
    const u = unit({
      winner: 1,
      winCondition: 'DisabledDefuser',
      feed: [
        at('DefuserPlantComplete', 60, { username: 'a1' }),
        kill('d1', 'a1', 70),
        kill('a2', 'd2', 75),
        kill('d3', 'a2', 90),
        kill('d3', 'a3', 91),
        kill('d3', 'a4', 92),
        kill('d3', 'a5', 93),
      ],
    });
    // The planter died untraded without a kill.
    expect(stat(u, 'a1', 'rounds_kost')).toBe(0);
    expect(player(u, 'a2').stats).toMatchObject({ rounds_kost: 1, rounds_survived: 0 });
    expect(player(u, 'd1').stats).toMatchObject({ rounds_kost: 1, rounds_survived: 1 });
    expect(stat(u, 'd2', 'rounds_kost')).toBe(0);
  });
});

describe('normalizeR6: clutches', () => {
  const downTo = (alive: string, opponentsKilled: string[]) => [
    ...['a1', 'a2', 'a3', 'a4', 'a5']
      .filter((name) => name !== alive)
      .map((name, i) => kill('d1', name, 20 + i * 20)),
    ...opponentsKilled.map((name, i) => kill(alive, name, 200 + i)),
  ];

  it('gives the last player alive one attempt against the opponents left, won with the round', () => {
    const u = unit({ winner: 0, feed: downTo('a5', ['d1', 'd2', 'd3', 'd4', 'd5']) });
    expect(player(u, 'a5').stats).toMatchObject({ clutch_attempts: 1, clutch_wins: 1 });
    expect(player(u, 'a5').detail.clutch_vs).toBe(5);
    // Once a5 has taken four, d5 is the last defender against one: an attempt, lost.
    expect(player(u, 'd5').stats).toMatchObject({ clutch_attempts: 1, clutch_wins: 0 });
    expect(player(u, 'd5').detail.clutch_vs).toBe(1);
  });

  it('records a lost attempt', () => {
    const u = unit({ winner: 1, feed: [...downTo('a5', ['d1']), kill('d2', 'a5', 230)] });
    expect(player(u, 'a5').stats).toMatchObject({ clutch_attempts: 1, clutch_wins: 0 });
    expect(player(u, 'a5').detail.clutch_vs).toBe(5);
  });

  it('gives both last players an attempt in a one-on-one', () => {
    // Two against two: a2 is left against two, kills d1, and d2 is then left against a2.
    const u = unit({
      winner: 1,
      names: ['a1', 'a2', 'd1', 'd2'],
      feed: [kill('d1', 'a1', 20), kill('a2', 'd1', 30), kill('d2', 'a2', 40)],
    });
    expect(player(u, 'a2').detail.clutch_vs).toBe(2);
    expect(player(u, 'd2').detail.clutch_vs).toBe(1);
    expect(player(u, 'd2').stats).toMatchObject({ clutch_attempts: 1, clutch_wins: 1 });
    expect(player(u, 'a2').stats).toMatchObject({ clutch_attempts: 1, clutch_wins: 0 });
  });

  it('counts a player who left as gone, and wins no clutch in a round that never ended', () => {
    const u = unit({
      winner: null,
      feed: [leave('a1', 10), death('a2', 11), kill('d1', 'a3', 12), kill('d1', 'a4', 13)],
    });
    expect(player(u, 'a5').stats).toMatchObject({ clutch_attempts: 1, clutch_wins: 0 });
  });
});

describe('normalizeR6: refusals', () => {
  it('refuses what is not a round of the fork', () => {
    for (const raw of [null, {}, { ...round(), teams: [] }, { ...round(), players: 'x' }]) {
      expect(normalizeR6(raw, CTX)).toMatchObject({ ok: false, error: 'invalid' });
    }
  });

  it('refuses two players with the same name, since the feed names them', () => {
    expect(normalizeR6(round({ names: ['a1', 'a1', 'd1'] }), CTX)).toMatchObject({
      ok: false,
      error: 'duplicate_player',
    });
  });
});

describe('normalizeR6: properties', () => {
  // Any sequence of kills, deaths and departures among the players still in the round.
  const steps = fc.array(
    fc.record({
      kind: fc.constantFrom('kill', 'death', 'leave'),
      actor: fc.nat(9),
      target: fc.nat(9),
      gap: fc.integer({ min: 0, max: 15 }),
    }),
    { maxLength: 12 },
  );

  it('keeps every count within what a round allows', () => {
    fc.assert(
      fc.property(steps, fc.constantFrom<0 | 1 | null>(0, 1, null), (plan, winner) => {
        const gone = new Set<string>();
        const feed: Feed[] = [];
        let elapsed = 0;
        for (const step of plan) {
          const actor = NAMES[step.actor] ?? 'a1';
          const target = NAMES[step.target] ?? 'd1';
          elapsed += step.gap;
          if (gone.has(target)) continue;
          if (step.kind === 'kill') {
            if (gone.has(actor) || actor === target) continue;
            const teamKill = sideOf(actor) === sideOf(target);
            feed.push(kill(actor, target, elapsed, teamKill ? { teamKill: true } : {}));
          } else feed.push(step.kind === 'death' ? death(target, elapsed) : leave(target, elapsed));
          gone.add(target);
        }
        const u = unit({ winner, feed });
        const total = (key: keyof R6UnitPlayer['stats']) =>
          u.players.reduce((sum, p) => sum + p.stats[key], 0);
        expect(u.warnings).toEqual([]);
        expect(total('opening_kills')).toBeLessThanOrEqual(1);
        expect(total('opening_deaths')).toBe(feed.some((e) => !isType(e, 'PlayerLeave')) ? 1 : 0);
        expect(total('trade_kills')).toBeLessThanOrEqual(total('kills'));
        expect(total('traded_deaths')).toBeLessThanOrEqual(total('deaths'));
        for (const p of u.players) {
          const s = p.stats;
          expect(s.rounds_played).toBe(1);
          expect(s.deaths + s.rounds_survived + Number(p.detail.left)).toBe(1);
          expect(s.rounds_kost).toBe(
            Number(s.kills > 0 || s.rounds_survived === 1 || s.traded_deaths === 1),
          );
          expect(s.clutch_wins).toBeLessThanOrEqual(s.clutch_attempts);
        }
        for (const side of [0, 1]) {
          const attempts = u.players.filter((p) => p.side === side && p.stats.clutch_attempts);
          expect(attempts.length).toBeLessThanOrEqual(1);
        }
        if (winner === null) expect(total('clutch_wins')).toBe(0);
      }),
    );
  });
});
