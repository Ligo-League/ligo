import { schema } from '@ligo/db';
import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import type { Actor } from './permissions.ts';
import { setTeamManager } from './team-staff.ts';
import { chooseVetoStep, readVeto, runVetoTick, startVeto, type VetoView } from './veto.ts';
import { leagueMatch } from './reports.ts';
import { findGuildLeague } from '@ligo/db';

const { auditLog, game, match, season, vetoStep } = schema;

const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const member = (n: number): Actor => ({
  guildId: TEST_GUILD,
  user: { id: `70000000000000000${n}`, displayName: `Member ${n}` },
  memberRoleIds: [],
});
// Match 3 is Bravo (side A) v Charlie (side B), Ligue 1 week 3. Before it, Charlie is 2nd
// (a forfeit against Alpha, 0 rounds) and Bravo 3rd (lost 4-7): Bravo picks the starting side
// and starts the veto, Charlie hosts and picks the overtime side.
const BRAVO = member(1);
const CHARLIE = member(2);
const OUTSIDER = member(4);
const NOW = Date.parse('2026-11-03T12:00:00Z');
const STEP_MS = 240_000;
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

function league() {
  const db = leagueDatabase();
  setTeamManager(db, STAFF, { teamId: 2, member: BRAVO.user }, 100);
  setTeamManager(db, STAFF, { teamId: 3, member: CHARLIE.user }, 100);
  const start = (actor: Actor = BRAVO, coin: 'a' | 'b' = 'b') =>
    startVeto(db, actor, { matchId: 3 }, NOW, () => coin);
  const choose = (actor: Actor, step: number, choice: string, now = NOW) =>
    chooseVetoStep(db, actor, { matchId: 3, step, choice }, now);
  const stored = () => db.select().from(match).where(eq(match.id, 3)).get();
  const steps = () => db.select().from(vetoStep).where(eq(vetoStep.matchId, 3)).all();
  return { db, start, choose, stored, steps };
}
const viewOf = (reply: { ok: true; view: VetoView } | { ok: false; error: string }) => {
  if (!reply.ok) throw new Error(reply.error);
  return reply.view;
};

describe('startVeto', () => {
  it('freezes sides and host from live standings, and the format, pool and timer', () => {
    const { start, stored, db } = league();
    const reply = start();
    expect(reply).toMatchObject({ ok: true, ranks: { a: 3, b: 2 } });
    const view = viewOf(reply);
    expect(view).toMatchObject({ teamA: 'a', host: 'b', byCoin: false, deadline: NOW + STEP_MS });
    expect(view.state).toMatchObject({ status: 'turn', step: 0, team: 'A', action: 'ban' });
    expect(stored()).toMatchObject({
      sideChooser: 'a',
      otSideChooser: 'b',
      hostSide: 'b',
      vetoStartedAt: NOW,
      vetoJson: { pool: POOL, step_seconds: 240 },
    });
    expect(
      db.select().from(auditLog).where(eq(auditLog.action, 'match.veto_start')).get(),
    ).toMatchObject({ entityId: '3', afterJson: { byCoin: false, ranks: { a: 3, b: 2 } } });
  });

  it('flips a coin when both teams share a rank, and says so after every step', () => {
    const { db, start, choose } = league();
    // Without results, everyone shares first place.
    db.update(match)
      .set({ status: 'void' })
      .where(inArray(match.id, [1, 2]))
      .run();
    expect(viewOf(start(BRAVO, 'b'))).toMatchObject({ teamA: 'b', host: 'a', byCoin: true });
    expect(viewOf(choose(CHARLIE, 0, 'Bank'))).toMatchObject({ byCoin: true });
  });

  it('pings both teams', () => {
    const { start } = league();
    const reply = start();
    expect(reply.ok && reply.mentionUserIds.sort()).toEqual([BRAVO.user.id, CHARLIE.user.id]);
  });

  it('refuses someone with no team, and a team outside the match', () => {
    const { db, start } = league();
    expect(start(OUTSIDER)).toEqual({ ok: false, error: 'no_team' });
    setTeamManager(db, STAFF, { teamId: 1, member: OUTSIDER.user }, 100);
    expect(start(OUTSIDER)).toEqual({ ok: false, error: 'not_your_match' });
  });

  it('lets league staff start it, but not choose for a team', () => {
    const { start, choose } = league();
    expect(start(STAFF).ok).toBe(true);
    expect(choose(STAFF, 0, 'Bank')).toEqual({ ok: false, error: 'not_your_match' });
  });

  it('refuses a second start, a match already reported, and a pool that does not fit', () => {
    const first = league();
    first.start();
    expect(first.start(CHARLIE)).toEqual({ ok: false, error: 'already_started' });

    const reported = league();
    reported.db.update(match).set({ status: 'reported' }).where(eq(match.id, 3)).run();
    expect(reported.start()).toEqual({ ok: false, error: 'not_schedulable' });

    const small = league();
    const row = small.db.select().from(season).get();
    if (!row) throw new Error('No season');
    small.db
      .update(season)
      .set({ settingsJson: { ...row.settingsJson, map_pool: POOL.slice(0, 7) } })
      .run();
    expect(small.start()).toEqual({ ok: false, error: 'pool_size' });
  });
});

describe('chooseVetoStep', () => {
  it("stores the turn's choice and moves to the other team", () => {
    const { start, choose, steps } = league();
    start();
    const view = viewOf(choose(BRAVO, 0, 'Bank'));
    expect(view.state).toMatchObject({ step: 1, team: 'B', action: 'ban' });
    expect(view.steps).toMatchObject([{ team: 'A', matchSide: 'a', action: 'ban', map: 'Bank' }]);
    expect(steps()).toMatchObject([
      { seq: 0, side: 'a', action: 'ban', map: 'Bank', at: NOW, timedOut: false },
    ]);
  });

  it.each([
    ['a team out of turn', CHARLIE, 0, 'Bank', 'not_your_turn'],
    ['someone outside the match', OUTSIDER, 0, 'Bank', 'not_your_match'],
    ['a click on an older message', BRAVO, 3, 'Bank', 'stale'],
    ['a map outside the pool', BRAVO, 0, 'Oregon', 'invalid_choice'],
  ])('refuses %s', (_label, actor, step, choice, error) => {
    const { start, choose, steps } = league();
    start();
    expect(choose(actor, step, choice)).toEqual({ ok: false, error });
    expect(steps()).toEqual([]);
  });

  it('refuses a choice before the veto starts', () => {
    expect(league().choose(BRAVO, 0, 'Bank')).toEqual({ ok: false, error: 'not_started' });
  });

  it('creates the game with its map and bans when the veto ends', () => {
    const { db, start, choose } = league();
    start();
    POOL.slice(0, 8).forEach((map, step) => {
      expect(choose(step % 2 === 0 ? BRAVO : CHARLIE, step, map).ok).toBe(true);
    });
    // Step 8 is the decider, stored on its own; then the two side steps.
    viewOf(choose(BRAVO, 9, 'defense'));
    const view = viewOf(choose(CHARLIE, 10, 'attack'));
    expect(view.state).toMatchObject({
      status: 'done',
      games: [{ n: 1, map: 'Fortress', side: { team: 'A', side: 'defense' } }],
    });
    expect(view.deadline).toBeNull();
    expect(db.select().from(game).where(eq(game.matchId, 3)).all()).toMatchObject([
      {
        n: 1,
        map: 'Fortress',
        status: 'pending',
        bansJson: POOL.slice(0, 8).map((map, index) => ({
          side: index % 2 === 0 ? 'a' : 'b',
          map,
        })),
      },
    ]);
    expect(choose(BRAVO, 11, 'attack')).toEqual({ ok: false, error: 'finished' });
  });
});

describe('runVetoTick', () => {
  it('plays a random choice for a team out of time, once per step time', () => {
    const { db, start, steps } = league();
    start();
    expect(runVetoTick(db, NOW + STEP_MS - 1, () => 0)).toEqual([]);
    const [view] = runVetoTick(db, NOW + STEP_MS, () => 4);
    expect(view?.state).toMatchObject({ step: 1, team: 'B' });
    expect(steps()).toMatchObject([
      { seq: 0, side: 'a', map: 'Lair', timedOut: true, byPlayerId: null },
    ]);
    // The next step's time starts now.
    expect(runVetoTick(db, NOW + STEP_MS + 1, () => 0)).toEqual([]);
  });

  it('leaves a finished veto alone', () => {
    const { db, start } = league();
    start();
    let now = NOW;
    for (let step = 0; step < 12; step += 1) {
      now += STEP_MS;
      runVetoTick(db, now, () => 0);
    }
    const found = leagueMatch(db, findGuildLeague(db, TEST_GUILD) ?? fail(), 3) ?? fail();
    expect(readVeto(db, found)?.state.status).toBe('done');
    expect(runVetoTick(db, now + 10 * STEP_MS, () => 0)).toEqual([]);
  });
});

function fail(): never {
  throw new Error('Missing test data');
}
