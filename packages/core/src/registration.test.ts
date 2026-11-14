import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkGameProfile,
  checkRosterDetails,
  lineupStatus,
  mayJoin,
  ROSTER_COLORS_MAX,
  type LineupMember,
} from './registration.ts';
import { registrationSchema } from './settings.ts';

// Registering a roster (design doc section 7, "Registration"; maintainer, 14 November 2026). The
// filer gives the roster's name, tag and colours, then invites players, who join with their own
// account: each keeps their Ubisoft name, profileID and rank on their own profile. The roster is
// complete with the league's number of starters, a captain, and every player ready.

const SETTINGS = registrationSchema.parse({});
const RANKS = ['unranked', 'gold', 'platinum', 'diamond', 'champion'] as const;

describe('checkRosterDetails', () => {
  it('tidies the details: name trimmed, tag and colours in capitals', () => {
    expect(
      checkRosterDetails({
        rosterName: '  Greed Academy ',
        tag: 'greed2',
        colors: ['#5b2c83', '#000000'],
      }),
    ).toEqual({
      ok: true,
      value: { rosterName: 'Greed Academy', tag: 'GREED2', colors: ['#5B2C83', '#000000'] },
    });
  });

  it('takes up to five colours', () => {
    const colors = ['#000000', '#111111', '#222222', '#333333', '#444444'];
    expect(ROSTER_COLORS_MAX).toBe(5);
    expect(checkRosterDetails({ rosterName: 'Greed Academy', tag: 'GREED2', colors })).toEqual({
      ok: true,
      value: { rosterName: 'Greed Academy', tag: 'GREED2', colors },
    });
  });

  it.each([
    ['a name too short', { rosterName: 'X' }, 'rosterName', 'invalid_roster_name'],
    ['a name too long', { rosterName: 'x'.repeat(41) }, 'rosterName', 'invalid_roster_name'],
    ['a tag too short', { tag: 'A' }, 'tag', 'invalid_tag'],
    ['a tag with a space', { tag: 'GR 2' }, 'tag', 'invalid_tag'],
    ['a tag too long', { tag: 'ABCDEFGHIJKLM' }, 'tag', 'invalid_tag'],
    ['one colour only', { colors: ['#000000'] }, 'colors', 'invalid_colors'],
    [
      'six colours',
      { colors: ['#000000', '#111111', '#222222', '#333333', '#444444', '#555555'] },
      'colors',
      'invalid_colors',
    ],
    ['a colour by name', { colors: ['violet', '#000000'] }, 'colors', 'invalid_colors'],
  ] as const)('refuses %s', (_label, overrides, field, error) => {
    const input = { rosterName: 'Greed Academy', tag: 'GREED2', colors: ['#000000', '#FFFFFF'] };
    expect(checkRosterDetails({ ...input, ...overrides })).toEqual({
      ok: false,
      errors: [{ field, error }],
    });
  });
});

describe('checkGameProfile', () => {
  it('tidies a profile: name trimmed, profileID in lower case or none', () => {
    expect(
      checkGameProfile(
        {
          ubisoftName: ' Nivalem.RCK ',
          profileId: 'A1B2C3D4-0000-4000-8000-00000000000F',
          rank: 'diamond',
        },
        RANKS,
      ),
    ).toEqual({
      ok: true,
      value: {
        ubisoftName: 'Nivalem.RCK',
        profileId: 'a1b2c3d4-0000-4000-8000-00000000000f',
        rank: 'diamond',
      },
    });
    expect(
      checkGameProfile({ ubisoftName: 'Nivalem', profileId: ' ', rank: 'gold' }, RANKS),
    ).toEqual({ ok: true, value: { ubisoftName: 'Nivalem', profileId: null, rank: 'gold' } });
  });

  it.each([
    ['a name too short', { ubisoftName: 'ab' }, 'ubisoftName', 'invalid_name'],
    ['a name with a space', { ubisoftName: 'Ni valem' }, 'ubisoftName', 'invalid_name'],
    ['a name too long', { ubisoftName: 'x'.repeat(21) }, 'ubisoftName', 'invalid_name'],
    ['a profileID that is no UUID', { profileId: '12345' }, 'profileId', 'invalid_profile_id'],
    ['a rank the title does not have', { rank: 'wood' }, 'rank', 'invalid_rank'],
  ] as const)('refuses %s', (_label, overrides, field, error) => {
    const input = { ubisoftName: 'Nivalem', profileId: null, rank: 'gold', ...overrides };
    expect(checkGameProfile(input, RANKS)).toEqual({ ok: false, errors: [{ field, error }] });
  });
});

const member = (playerId: number, overrides: Partial<LineupMember> = {}): LineupMember => ({
  playerId,
  role: 'player',
  captain: playerId === 1,
  ready: true,
  ...overrides,
});
const FIVE = [1, 2, 3, 4, 5].map((id) => member(id));

describe('lineupStatus', () => {
  it('is complete with the starters, a captain, and every player ready', () => {
    expect(lineupStatus(FIVE, SETTINGS)).toEqual({ complete: true, gaps: [] });
    const withSubs = [...FIVE, member(6, { role: 'sub' }), member(7, { role: 'sub' })];
    expect(lineupStatus(withSubs, SETTINGS).complete).toBe(true);
  });

  it('says what is missing, all at once', () => {
    const members = [
      member(1, { captain: false }),
      member(2, { ready: false }),
      member(3),
      member(4, { role: 'sub' }),
      member(5, { role: 'sub' }),
      member(6, { role: 'sub', ready: false }),
    ];
    expect(lineupStatus(members, SETTINGS)).toEqual({
      complete: false,
      gaps: [
        { gap: 'starters', have: 3, want: 5 },
        { gap: 'subs', have: 3, max: 2 },
        { gap: 'captain', have: 0 },
        { gap: 'not_ready', playerIds: [2, 6] },
      ],
    });
  });

  it('wants exactly the starters asked for, and one captain', () => {
    expect(lineupStatus([...FIVE, member(6)], SETTINGS).gaps).toEqual([
      { gap: 'starters', have: 6, want: 5 },
    ]);
    const two = FIVE.map((entry, index) => ({ ...entry, captain: index < 2 }));
    expect(lineupStatus(two, SETTINGS).gaps).toEqual([{ gap: 'captain', have: 2 }]);
  });

  it('is complete for the lineups the league’s numbers allow, and only those', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 2 }),
        (starters, subs, captains) => {
          const members = [
            ...Array.from({ length: starters }, (_, index) => member(index + 1)),
            ...Array.from({ length: subs }, (_, index) => member(100 + index, { role: 'sub' })),
          ].map((entry, index) => ({ ...entry, captain: index < captains }));
          const allowed =
            starters === SETTINGS.starters &&
            subs <= SETTINGS.subs_max &&
            Math.min(captains, members.length) === 1;
          expect(lineupStatus(members, SETTINGS).complete).toBe(allowed);
        },
      ),
    );
  });
});

describe('mayJoin', () => {
  it('lets a player join while places are left, once', () => {
    expect(mayJoin(FIVE, 6, SETTINGS)).toEqual({ ok: true });
    expect(mayJoin(FIVE, 3, SETTINGS)).toEqual({ ok: false, error: 'already_joined' });
    const full = [...FIVE, member(6, { role: 'sub' }), member(7, { role: 'sub' })];
    expect(mayJoin(full, 8, SETTINGS)).toEqual({ ok: false, error: 'roster_full' });
  });
});

describe('registration settings', () => {
  it('asks for 5 starters and up to 2 substitutes, with 7 days to use an invitation', () => {
    expect(registrationSchema.parse({})).toEqual({
      starters: 5,
      subs_max: 2,
      stats_consent_required: false,
      invite_days: 7,
    });
    expect(registrationSchema.safeParse({ starters: 0 }).success).toBe(false);
  });
});
