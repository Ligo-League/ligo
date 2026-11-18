import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  changeLineupRole,
  checkMove,
  entryActiveAt,
  moveStart,
  windowOpenAt,
  type LineupPlace,
  type MoveContext,
  type MercatoWindow,
} from './mercato.ts';
import { mercatoSchema, registrationSchema } from './settings.ts';

// The mercato (design doc section 7; O-35 and M-22, maintainer, 16 and 19 November 2026).

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const REGISTRATION = registrationSchema.parse({}); // 5 starters, up to 2 substitutes
const LFR = mercatoSchema.parse({ mode: 'windows', max_moves_per_team: 3, lock_hours: 24 });
const OPEN = mercatoSchema.parse({});

const WINDOW: MercatoWindow = {
  opensAt: NOW - HOUR,
  closesAt: NOW + 48 * HOUR,
  closedEarlyAt: null,
  maxMovesPerTeam: 3,
  lockHours: 24,
};

// Players 1 to 5 start, 1 is captain, 6 is a substitute; 7, 8 and 9 are on the roster's own list.
const LINEUP: LineupPlace[] = [
  { playerId: 1, role: 'player', captain: true },
  { playerId: 2, role: 'player', captain: false },
  { playerId: 3, role: 'player', captain: false },
  { playerId: 4, role: 'player', captain: false },
  { playerId: 5, role: 'player', captain: false },
  { playerId: 6, role: 'sub', captain: false },
];

function context(overrides: Partial<MoveContext> = {}): MoveContext {
  return {
    settings: LFR,
    registration: REGISTRATION,
    lineupLocked: true,
    window: WINDOW,
    filedAt: NOW,
    movesCounted: 0,
    lineup: LINEUP,
    rosterPlayerIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    from: null,
    byStaff: false,
    ...overrides,
  };
}

describe('mercato windows', () => {
  it('is open from its opening to its close, or until staff close it early', () => {
    expect(windowOpenAt(WINDOW, NOW)).toBe(true);
    expect(windowOpenAt(WINDOW, WINDOW.opensAt - 1)).toBe(false);
    expect(windowOpenAt(WINDOW, WINDOW.closesAt)).toBe(false);
    expect(windowOpenAt({ ...WINDOW, closedEarlyAt: NOW }, NOW)).toBe(false);
    expect(windowOpenAt({ ...WINDOW, closedEarlyAt: NOW + 1 }, NOW)).toBe(true);
  });

  it('has lenient defaults: always open, no limit, no block, moves inside a club counted', () => {
    expect(OPEN).toEqual({
      mode: 'open',
      max_moves_per_team: null,
      lock_hours: 0,
      intra_club_moves: 'counted',
    });
  });
});

describe('a move', () => {
  it('counts a swap once, and blocks the incoming player for the window’s hours', () => {
    expect(checkMove({ outId: 2, in: { playerId: 7, role: 'player' } }, context())).toEqual({
      ok: true,
      counted: true,
      lockHours: 24,
      transferFrom: null,
    });
  });

  it('takes one player out, or brings one in, as one move each', () => {
    expect(checkMove({ outId: 6, in: null }, context())).toMatchObject({ ok: true, counted: true });
    expect(checkMove({ outId: null, in: { playerId: 7, role: 'sub' } }, context())).toMatchObject({
      ok: true,
      counted: true,
    });
    expect(checkMove({ outId: null, in: null }, context())).toEqual({
      ok: false,
      error: 'empty_move',
    });
  });

  it('needs an open window in a league with windows, at the time it was filed', () => {
    const move = { outId: 2, in: { playerId: 7, role: 'player' as const } };
    expect(checkMove(move, context({ window: null }))).toEqual({
      ok: false,
      error: 'window_closed',
    });
    expect(checkMove(move, context({ filedAt: WINDOW.closesAt }))).toEqual({
      ok: false,
      error: 'window_closed',
    });
    // Staff answer after the window closed: the move was filed inside it.
    expect(checkMove(move, context({ filedAt: NOW }))).toMatchObject({ ok: true });
  });

  it('stops at the window’s limit, pending moves included', () => {
    const move = { outId: 2, in: { playerId: 7, role: 'player' as const } };
    expect(checkMove(move, context({ movesCounted: 2 }))).toMatchObject({ ok: true });
    expect(checkMove(move, context({ movesCounted: 3 }))).toEqual({
      ok: false,
      error: 'limit_reached',
    });
    const unlimited = context({ movesCounted: 40, window: { ...WINDOW, maxMovesPerTeam: null } });
    expect(checkMove(move, unlimited)).toMatchObject({ ok: true });
  });

  it('needs no window when the mercato is always open, with the season’s limit and block', () => {
    const open = mercatoSchema.parse({ mode: 'open', max_moves_per_team: 2, lock_hours: 12 });
    const move = { outId: 2, in: { playerId: 7, role: 'player' as const } };
    expect(checkMove(move, context({ settings: open, window: null }))).toEqual({
      ok: true,
      counted: true,
      lockHours: 12,
      transferFrom: null,
    });
    expect(checkMove(move, context({ settings: open, window: null, movesCounted: 2 }))).toEqual({
      ok: false,
      error: 'limit_reached',
    });
  });

  it('is free before the lineups lock: no window, no count, no block', () => {
    const move = { outId: 2, in: { playerId: 7, role: 'player' as const } };
    expect(
      checkMove(move, context({ lineupLocked: false, window: null, movesCounted: 9 })),
    ).toEqual({ ok: true, counted: false, lockHours: 0, transferFrom: null });
  });

  it('brings in only a player of the roster’s own list, not already in the lineup', () => {
    expect(checkMove({ outId: null, in: { playerId: 10, role: 'sub' } }, context())).toEqual({
      ok: false,
      error: 'not_on_roster',
    });
    expect(checkMove({ outId: null, in: { playerId: 6, role: 'player' } }, context())).toEqual({
      ok: false,
      error: 'already_in_lineup',
    });
  });

  it('takes out only a player of the lineup, never the captain', () => {
    expect(checkMove({ outId: 8, in: null }, context())).toEqual({
      ok: false,
      error: 'not_in_lineup',
    });
    expect(checkMove({ outId: 1, in: { playerId: 7, role: 'player' } }, context())).toEqual({
      ok: false,
      error: 'captain_leaving',
    });
  });

  it('keeps the lineup within the league’s starters and substitutes', () => {
    expect(checkMove({ outId: null, in: { playerId: 7, role: 'player' } }, context())).toEqual({
      ok: false,
      error: 'too_many_starters',
    });
    const full = context({ lineup: [...LINEUP, { playerId: 7, role: 'sub', captain: false }] });
    expect(checkMove({ outId: null, in: { playerId: 8, role: 'sub' } }, full)).toEqual({
      ok: false,
      error: 'too_many_subs',
    });
    // A swap frees the place it fills.
    expect(checkMove({ outId: 6, in: { playerId: 8, role: 'sub' } }, full)).toMatchObject({
      ok: true,
    });
  });

  it('takes a player from another roster of the competition, counted for this one only', () => {
    const from = { teamId: 40, sameClub: false };
    expect(checkMove({ outId: 2, in: { playerId: 7, role: 'player' } }, context({ from }))).toEqual(
      { ok: true, counted: true, lockHours: 24, transferFrom: 40 },
    );
  });
});

describe('a move inside a club (M-22)', () => {
  const from = { teamId: 41, sameClub: true };
  const move = { outId: 2, in: { playerId: 7, role: 'player' as const } };

  it('is an ordinary move by default', () => {
    expect(checkMove(move, context({ from }))).toMatchObject({ ok: true, counted: true });
  });

  it('may be free: no window, no count, the block still applies', () => {
    const settings = { ...LFR, intra_club_moves: 'free' as const };
    expect(checkMove(move, context({ from, settings, window: null, movesCounted: 3 }))).toEqual({
      ok: true,
      counted: false,
      lockHours: 24,
      transferFrom: 41,
    });
  });

  it('may be closed', () => {
    const settings = { ...LFR, intra_club_moves: 'closed' as const };
    expect(checkMove(move, context({ from, settings }))).toEqual({
      ok: false,
      error: 'intra_club_closed',
    });
  });
});

describe('a staff exception (O-35)', () => {
  const move = { outId: 2, in: { playerId: 7, role: 'player' as const } };

  it('needs no window, is not counted, and still blocks the incoming player', () => {
    expect(checkMove(move, context({ byStaff: true, window: null, movesCounted: 3 }))).toEqual({
      ok: true,
      counted: false,
      lockHours: 24,
      transferFrom: null,
    });
  });

  it('may move a player between rosters of a club whose moves are closed', () => {
    const settings = { ...LFR, intra_club_moves: 'closed' as const };
    const from = { teamId: 41, sameClub: true };
    expect(checkMove(move, context({ byStaff: true, settings, from }))).toMatchObject({
      ok: true,
    });
  });

  it('keeps the lineup’s own rules', () => {
    expect(checkMove({ outId: 1, in: null }, context({ byStaff: true }))).toEqual({
      ok: false,
      error: 'captain_leaving',
    });
  });

  it('blocks by the season’s hours when no window is open', () => {
    const open = mercatoSchema.parse({ mode: 'windows', lock_hours: 6 });
    expect(checkMove(move, context({ byStaff: true, settings: open, window: null }))).toMatchObject(
      { ok: true, lockHours: 6 },
    );
  });
});

describe('the block and the lineup at a time', () => {
  it('starts the incoming player lock_hours after approval', () => {
    expect(moveStart(NOW, 24)).toBe(NOW + 24 * HOUR);
    expect(moveStart(NOW, 0)).toBe(NOW);
  });

  it('counts a roster entry from its start until its end', () => {
    const entry = { validFrom: NOW, validTo: NOW + HOUR };
    expect(entryActiveAt(entry, NOW - 1)).toBe(false);
    expect(entryActiveAt(entry, NOW)).toBe(true);
    expect(entryActiveAt(entry, NOW + HOUR)).toBe(false);
    expect(entryActiveAt({ validFrom: NOW, validTo: null }, NOW + 1_000 * HOUR)).toBe(true);
  });
});

describe('role and captain changes, which are no moves', () => {
  it('turns a starter into a substitute and back', () => {
    const reply = changeLineupRole(LINEUP, { playerId: 5, role: 'sub' }, REGISTRATION);
    expect(reply).toMatchObject({ ok: true });
    if (!reply.ok) return;
    expect(reply.lineup.find((place) => place.playerId === 5)?.role).toBe('sub');
    expect(changeLineupRole(reply.lineup, { playerId: 5, role: 'player' }, REGISTRATION)).toEqual({
      ok: true,
      lineup: LINEUP,
    });
  });

  it('names a new captain among the starters, and the old one is captain no more', () => {
    const reply = changeLineupRole(LINEUP, { captainId: 3 }, REGISTRATION);
    expect(reply.ok && reply.lineup.filter((place) => place.captain)).toEqual([
      { playerId: 3, role: 'player', captain: true },
    ]);
    expect(changeLineupRole(LINEUP, { captainId: 6 }, REGISTRATION)).toEqual({
      ok: false,
      error: 'captain_not_starter',
    });
  });

  it('keeps the captain a starter and the numbers within the league’s', () => {
    expect(changeLineupRole(LINEUP, { playerId: 1, role: 'sub' }, REGISTRATION)).toEqual({
      ok: false,
      error: 'captain_not_starter',
    });
    expect(changeLineupRole(LINEUP, { playerId: 6, role: 'player' }, REGISTRATION)).toEqual({
      ok: false,
      error: 'too_many_starters',
    });
    expect(changeLineupRole(LINEUP, { playerId: 9, role: 'sub' }, REGISTRATION)).toEqual({
      ok: false,
      error: 'not_in_lineup',
    });
  });
});

describe('the limit, whatever order moves come in', () => {
  it('never lets a team have more counted moves than the window allows', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.array(fc.boolean(), { maxLength: 20 }),
        (limit, refusals) => {
          // Each filing is checked against the moves pending or approved; a refused one frees
          // its place.
          let held = 0;
          const window = { ...WINDOW, maxMovesPerTeam: limit };
          for (const refused of refusals) {
            const reply = checkMove(
              { outId: 6, in: { playerId: 7, role: 'sub' } },
              context({ window, movesCounted: held }),
            );
            if (reply.ok && reply.counted) held += 1;
            if (refused && held > 0) held -= 1;
            expect(held).toBeLessThanOrEqual(limit);
          }
        },
      ),
    );
  });
});
