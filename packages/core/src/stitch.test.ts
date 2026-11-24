import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ReplaySide, SegmentRound } from './replay-groups.ts';
import type { GameScoreSettings } from './settings.ts';
import { stitchGame, type StitchSegment } from './stitch.ts';

// Stitching re-hosted games (design doc section 8): a restart keeps the score, so the official
// map is the lobbies' complete rounds joined in order; a round cut short is void, and so is any
// round after the map was decided. The checks decide whether the plan applies by itself or waits
// for staff.

const R6: GameScoreSettings = { win_at: 7, overtime_rounds: 3 };
const other = (side: ReplaySide): ReplaySide => (side === 'A' ? 'B' : 'A');

/**
 * A map from a string: `A` or `B` is a round that team won, `-` a round cut short, `|` a re-host
 * into a new lobby. Team A attacks the first half; sides swap after `win_at - 1` rounds, and in
 * overtime they alternate. Each round lasts four minutes.
 */
function map(sequence: string, start = 0): StitchSegment[] {
  const segments: StitchSegment[] = [];
  let rounds: SegmentRound[] = [];
  let counted = 0;
  let number = 0;
  let time = start;
  let fileId = 1;
  const close = () => {
    segments.push({ lobbyId: `L${String(segments.length + 1)}`, rounds });
    rounds = [];
  };
  for (const char of sequence) {
    if (char === '|') {
      close();
      time += 120_000;
      continue;
    }
    const half = counted < 6 ? 0 : counted < 12 ? 1 : counted;
    const attacker: ReplaySide = half % 2 === 0 ? 'A' : 'B';
    rounds.push({
      fileId: fileId++,
      number,
      startedAt: time,
      winner: char === '-' ? null : (char as ReplaySide),
      attacker,
    });
    time += 240_000;
    if (char !== '-') {
      counted += 1;
      number += 1;
    }
  }
  close();
  return segments;
}

const stitch = (
  segments: StitchSegment[],
  options: { reported?: { A: number; B: number } | null; rehostsPerTeam?: number } = {},
) =>
  stitchGame({
    segments,
    rule: R6,
    rehostsPerTeam: options.rehostsPerTeam ?? 1,
    reported: options.reported === undefined ? null : options.reported,
  });
const check = (plan: ReturnType<typeof stitchGame>, code: string) =>
  plan.checks.find((c) => c.code === code)?.ok;

describe('stitchGame', () => {
  it('counts every round of a single lobby, and applies when the reported score matches', () => {
    const plan = stitch(map('AABABAAABA'), { reported: { A: 7, B: 3 } });
    expect(plan.score).toEqual({ A: 7, B: 3 });
    expect(plan.rounds.every((r) => r.void_reason === null)).toBe(true);
    expect(plan.rounds.at(-1)?.score).toEqual({ A: 7, B: 3 });
    expect(plan.checks).toEqual([
      { code: 'decided', ok: true },
      { code: 'no_overlap', ok: true },
      { code: 'sides', ok: true },
      { code: 'rehosts', ok: true },
      { code: 'reported_score', ok: true },
    ]);
    expect(plan.ok).toBe(true);
  });

  it('joins re-hosted lobbies in order, voiding the round cut short', () => {
    // 4-2 in the first lobby, a round cut, then 3-3 in the second: 7-5.
    const plan = stitch(map('AABABA-|BBABAA'), { reported: { A: 7, B: 5 } });
    expect(plan.score).toEqual({ A: 7, B: 5 });
    expect(plan.lobbies).toEqual([
      { lobbyId: 'L1', score: { A: 4, B: 2 } },
      { lobbyId: 'L2', score: { A: 3, B: 3 } },
    ]);
    expect(plan.rounds.filter((r) => r.void_reason !== null)).toEqual([
      expect.objectContaining({ lobbyId: 'L1', number: 6, void_reason: 'interrupted' }),
    ]);
    expect(plan.ok).toBe(true);
  });

  it('voids the rounds played after the map was decided', () => {
    const plan = stitch(map('AAAAAAABB'), { reported: { A: 7, B: 0 } });
    expect(plan.score).toEqual({ A: 7, B: 0 });
    expect(plan.rounds.slice(7).map((r) => r.void_reason)).toEqual(['after_end', 'after_end']);
    expect(plan.ok).toBe(true);
  });

  it('goes through overtime to a possible final score', () => {
    const plan = stitch(map('AAAAAABBBBBBABA'), { reported: { A: 8, B: 7 } });
    expect(plan.score).toEqual({ A: 8, B: 7 });
    expect(check(plan, 'decided')).toBe(true);
    expect(check(plan, 'sides')).toBe(true);
  });

  it('waits for staff when the map never reached a final score', () => {
    const plan = stitch(map('AABAB-'), { reported: { A: 7, B: 2 } });
    expect(plan.score).toEqual({ A: 3, B: 2 });
    expect(check(plan, 'decided')).toBe(false);
    expect(check(plan, 'reported_score')).toBe(false);
    expect(plan.ok).toBe(false);
  });

  it('refuses lobbies that overlap in time', () => {
    const [first, second] = map('AAAA|AAA');
    if (!first || !second) throw new Error('two lobbies');
    const early = {
      ...second,
      rounds: second.rounds.map((r) => ({ ...r, startedAt: r.startedAt - 900_000 })),
    };
    const plan = stitch([first, early]);
    expect(check(plan, 'no_overlap')).toBe(false);
  });

  it('orders lobbies by their first round, whatever order they come in', () => {
    const [first, second] = map('AABA|AAAB-|AA');
    const [, , third] = map('AABA|AAAB-|AA');
    if (!first || !second || !third) throw new Error('three lobbies');
    expect(stitch([third, first, second]).lobbies.map((l) => l.lobbyId)).toEqual([
      'L1',
      'L2',
      'L3',
    ]);
  });

  it('checks the sides swap at half time; overtime is not checked', () => {
    const segments = map('AAAAAA' + 'BBBBBB' + 'AA');
    expect(check(stitch(segments), 'sides')).toBe(true);
    const [only] = segments;
    if (!only) throw new Error('one lobby');
    const wrong = (index: number) => [
      {
        ...only,
        rounds: only.rounds.map((r, i) =>
          i === index ? { ...r, attacker: other(r.attacker) } : r,
        ),
      },
    ];
    expect(check(stitch(wrong(3)), 'sides')).toBe(false);
    expect(check(stitch(wrong(8)), 'sides')).toBe(false);
    expect(check(stitch(wrong(12)), 'sides')).toBe(true);
  });

  it('allows each team its re-hosts in the game, in all: one each by default (O-14)', () => {
    const twice = map('AAA-|AAB|BAA');
    expect(check(stitch(twice), 'rehosts')).toBe(true);
    const thrice = map('AA-|AAB|BA|AA');
    expect(check(stitch(thrice), 'rehosts')).toBe(false);
    expect(check(stitch(thrice, { rehostsPerTeam: 2 }), 'rehosts')).toBe(true);
    expect(check(stitch(map('AA-|AAAAA'), { rehostsPerTeam: 0 }), 'rehosts')).toBe(false);
  });

  it('holds each team to its share when the teams said who called each re-host', () => {
    const [first, second, third] = map('AAA-|AAB|BAA');
    if (!first || !second || !third) throw new Error('three lobbies');
    const called = (a: ReplaySide | null, b: ReplaySide | null) => [
      first,
      { ...second, calledBy: a },
      { ...third, calledBy: b },
    ];
    expect(check(stitch(called('A', 'B')), 'rehosts')).toBe(true);
    expect(check(stitch(called('A', null)), 'rehosts')).toBe(true);
    expect(check(stitch(called('B', 'B')), 'rehosts')).toBe(false);
    // The first lobby was no re-host, whatever it says.
    expect(
      check(
        stitch([
          { ...first, calledBy: 'A' },
          { ...second, calledBy: 'A' },
        ]),
        'rehosts',
      ),
    ).toBe(true);
  });

  it('cannot check the score before it is reported, so does not apply yet', () => {
    const plan = stitch(map('AAAAAAA'));
    expect(check(plan, 'reported_score')).toBeNull();
    expect(plan.ok).toBe(false);
    expect(check(stitch(map('AAAAAAA'), { reported: { A: 0, B: 7 } }), 'reported_score')).toBe(
      false,
    );
  });

  it('gives an empty plan for a game without rounds', () => {
    const plan = stitch([]);
    expect(plan).toMatchObject({ rounds: [], lobbies: [], score: { A: 0, B: 0 }, ok: false });
  });

  it('rebuilds the true score from any re-hosts and cut rounds', () => {
    // A map played to a possible final score, cut and re-hosted at random places.
    const arbitrary = fc
      .array(fc.constantFrom<ReplaySide>('A', 'B'), { minLength: 30, maxLength: 30 })
      .chain((winners) => {
        const played: ReplaySide[] = [];
        const score = { A: 0, B: 0 };
        for (const side of winners) {
          played.push(side);
          score[side] += 1;
          if (isDecided(score)) break;
        }
        return fc.record({
          played: fc.constant(played),
          score: fc.constant(score),
          cuts: fc.uniqueArray(fc.nat(played.length - 1), { maxLength: 3 }),
        });
      });
    fc.assert(
      fc.property(arbitrary, ({ played, score, cuts }) => {
        if (!isDecided(score)) return;
        const sequence = played.map((side, i) => (cuts.includes(i) ? `-|${side}` : side)).join('');
        const plan = stitch(map(sequence), { reported: score, rehostsPerTeam: 2 });
        expect(plan.score).toEqual(score);
        expect(plan.lobbies).toHaveLength(cuts.length + 1);
        expect(plan.ok).toBe(true);
      }),
    );
  });
});

/** An R6 map is over at 7 with a lead of two or more, or at 8 after 6-6. */
function isDecided({ A, B }: { A: number; B: number }): boolean {
  const [high, low] = A > B ? [A, B] : [B, A];
  return (high === 7 && low <= 5) || (high === 8 && low >= 6);
}
