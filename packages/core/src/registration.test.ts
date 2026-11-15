import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ageOn,
  checkBirthDate,
  changeLineup,
  checkGameProfile,
  checkRosterDetails,
  lineupLocked,
  lineupStatus,
  mayApprove,
  mayJoin,
  mayLeave,
  playerGaps,
  ROSTER_COLORS_MAX,
  type LineupMember,
  type PlayerProfile,
} from './registration.ts';
import { registrationSchema } from './settings.ts';

// Registering a roster (design doc section 7, "Registration"; maintainer, 14 November 2026). The
// filer gives the roster's name, tag and colours, then invites players, who join with their own
// account: each keeps their Ubisoft name, profileID and rank on their own profile. The roster is
// complete with the league's number of starters, a captain, and every player ready.
// Joining (maintainer, 14 November 2026): one roster per competition (O-29), the captain a starter
// (O-30), a minimum age as a setting, counted on the season's first day (O-31, O-33), and lineups
// locked a set number of days before the season (M-29, O-32).

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

  it('wants the captain among the starters', () => {
    const members = [
      ...FIVE.map((entry) => ({ ...entry, captain: false })),
      member(6, { role: 'sub', captain: true }),
    ];
    expect(lineupStatus(members, SETTINGS).gaps).toEqual([{ gap: 'captain_not_starter' }]);
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

const READY: PlayerProfile = {
  gameAccount: true,
  nationality: 'FR',
  statsConsent: true,
  birthDate: '2000-05-17',
};
const LFR = registrationSchema.parse({ stats_consent_required: true, min_age: 16 });
const STARTS_ON = '2027-01-04';

describe('ageOn', () => {
  it('counts full years, a birthday counting from its own day', () => {
    expect(ageOn('2011-01-04', '2027-01-04')).toBe(16);
    expect(ageOn('2011-01-05', '2027-01-04')).toBe(15);
    expect(ageOn('2010-12-31', '2027-01-04')).toBe(16);
  });

  it('turns a 29 February birthday a year older on 1 March of other years', () => {
    expect(ageOn('2008-02-29', '2025-02-28')).toBe(16);
    expect(ageOn('2008-02-29', '2025-03-01')).toBe(17);
    expect(ageOn('2008-02-29', '2028-02-29')).toBe(20);
  });

  it('never goes down as the date moves on', () => {
    const date = fc
      .date({ min: new Date('1950-01-01'), max: new Date('2060-12-31'), noInvalidDate: true })
      .map((value) => value.toISOString().slice(0, 10));
    fc.assert(
      fc.property(date, date, date, (birth, first, second) => {
        const [early, late] = first <= second ? [first, second] : [second, first];
        expect(ageOn(birth, late)).toBeGreaterThanOrEqual(ageOn(birth, early));
      }),
    );
  });
});

describe('checkBirthDate', () => {
  it('takes a real date, not after today', () => {
    expect(checkBirthDate(' 2008-02-29 ', '2026-11-15')).toEqual({ ok: true, value: '2008-02-29' });
    expect(checkBirthDate('2026-11-15', '2026-11-15')).toEqual({ ok: true, value: '2026-11-15' });
  });

  it.each(['', '2007-02-29', '2008-13-01', '17/05/2000', '2026-11-16', '1899-12-31'])(
    'refuses %j',
    (input) => {
      expect(checkBirthDate(input, '2026-11-15')).toEqual({
        ok: false,
        error: 'invalid_birth_date',
      });
    },
  );
});

describe('lineupLocked', () => {
  it('locks lineups the set number of days before the season’s first day', () => {
    expect(lineupLocked('2027-01-03', STARTS_ON, 0)).toBe(false);
    expect(lineupLocked('2027-01-04', STARTS_ON, 0)).toBe(true);
    expect(lineupLocked('2026-12-31', STARTS_ON, 3)).toBe(false);
    expect(lineupLocked('2027-01-01', STARTS_ON, 3)).toBe(true);
  });
});

describe('playerGaps', () => {
  it('finds nothing missing in a complete profile', () => {
    expect(playerGaps(READY, LFR, STARTS_ON)).toEqual([]);
  });

  it('says everything that is missing, all at once', () => {
    const empty = { gameAccount: false, nationality: null, statsConsent: false, birthDate: null };
    expect(playerGaps(empty, LFR, STARTS_ON)).toEqual([
      'game_account',
      'nationality',
      'stats_consent',
      'birth_date',
    ]);
  });

  it('counts the age on the season’s first day', () => {
    expect(playerGaps({ ...READY, birthDate: '2011-01-04' }, LFR, STARTS_ON)).toEqual([]);
    expect(playerGaps({ ...READY, birthDate: '2011-01-05' }, LFR, STARTS_ON)).toEqual([
      'too_young',
    ]);
  });

  it('asks neither consent nor a birth date of a league that does not require them', () => {
    const profile = { ...READY, statsConsent: false, birthDate: null };
    expect(playerGaps(profile, SETTINGS, STARTS_ON)).toEqual([]);
  });
});

describe('mayJoin', () => {
  const joiner = (playerId: number, overrides = {}) => ({
    playerId,
    gaps: [],
    inOtherRegistration: false,
    locked: false,
    ...overrides,
  });

  it('lets a player join while places are left, once: as a starter, then as a substitute', () => {
    expect(mayJoin([], joiner(1), SETTINGS)).toEqual({ ok: true, role: 'player' });
    expect(mayJoin(FIVE, joiner(6), SETTINGS)).toEqual({ ok: true, role: 'sub' });
    expect(mayJoin(FIVE, joiner(3), SETTINGS)).toEqual({ ok: false, error: 'already_joined' });
    const full = [...FIVE, member(6, { role: 'sub' }), member(7, { role: 'sub' })];
    expect(mayJoin(full, joiner(8), SETTINGS)).toEqual({ ok: false, error: 'roster_full' });
  });

  it('refuses a player already in another roster of the competition', () => {
    expect(mayJoin(FIVE, joiner(6, { inOtherRegistration: true }), SETTINGS)).toEqual({
      ok: false,
      error: 'in_other_registration',
    });
  });

  it('refuses once the lineup is locked', () => {
    expect(mayJoin(FIVE, joiner(6, { locked: true }), SETTINGS)).toEqual({
      ok: false,
      error: 'lineup_locked',
    });
  });

  it('sends a player with something missing to complete their profile first', () => {
    expect(mayJoin(FIVE, joiner(6, { gaps: ['nationality', 'too_young'] }), SETTINGS)).toEqual({
      ok: false,
      error: 'not_eligible',
      gaps: ['nationality', 'too_young'],
    });
  });
});

describe('changeLineup', () => {
  const roles = (entries: [number, 'player' | 'sub'][]) => new Map(entries);

  it('sets each player’s role and the captain, keeping the others as they are', () => {
    const members = [
      ...FIVE.map((entry) => ({ ...entry, captain: false })),
      member(6, { role: 'sub' }),
    ];
    const reply = changeLineup(
      members,
      {
        roles: roles([
          [5, 'sub'],
          [6, 'player'],
        ]),
        captainId: 6,
      },
      SETTINGS,
    );
    expect(reply).toEqual({
      ok: true,
      members: [
        member(1, { captain: false }),
        member(2, { captain: false }),
        member(3, { captain: false }),
        member(4, { captain: false }),
        member(5, { role: 'sub', captain: false }),
        member(6, { role: 'player', captain: true }),
      ],
    });
    expect(lineupStatus(reply.ok ? reply.members : [], SETTINGS).complete).toBe(true);
  });

  it('may leave the captain unchosen while the lineup is built', () => {
    const reply = changeLineup(FIVE, { roles: roles([]), captainId: null }, SETTINGS);
    expect(reply.ok && reply.members.every((entry) => !entry.captain)).toBe(true);
  });

  it.each([
    [
      'a player who did not join',
      { roles: roles([[9, 'sub']]), captainId: null },
      'unknown_player',
    ],
    ['a captain who did not join', { roles: roles([]), captainId: 9 }, 'unknown_player'],
    [
      'a substitute as captain',
      { roles: roles([[1, 'sub']]), captainId: 1 },
      'captain_not_starter',
    ],
  ] as const)('refuses %s', (_label, change, error) => {
    expect(changeLineup(FIVE, change, SETTINGS)).toEqual({ ok: false, error });
  });

  it('keeps the starters and substitutes within the league’s numbers', () => {
    const six = [...FIVE, member(6, { role: 'sub' })];
    expect(changeLineup(six, { roles: roles([[6, 'player']]), captainId: 1 }, SETTINGS)).toEqual({
      ok: false,
      error: 'too_many_starters',
    });
    const allSubs = roles([
      [1, 'sub'],
      [2, 'sub'],
      [3, 'sub'],
    ]);
    expect(changeLineup(FIVE, { roles: allSubs, captainId: 4 }, SETTINGS)).toEqual({
      ok: false,
      error: 'too_many_subs',
    });
  });
});

describe('mayApprove', () => {
  const complete = lineupStatus(FIVE, SETTINGS);

  it('approves a complete lineup into a division with room, its players on no other roster', () => {
    expect(
      mayApprove({ lineup: complete, onOtherRoster: [], divisionTeams: 11 }, SETTINGS),
    ).toEqual({ ok: true });
  });

  it('says every reason to wait, all at once', () => {
    const incomplete = lineupStatus(FIVE.slice(0, 4), SETTINGS);
    expect(
      mayApprove({ lineup: incomplete, onOtherRoster: [3, 4], divisionTeams: 12 }, SETTINGS),
    ).toEqual({
      ok: false,
      errors: [
        { error: 'lineup_incomplete' },
        { error: 'player_on_other_roster', playerIds: [3, 4] },
        { error: 'division_full', max: 12 },
      ],
    });
  });

  it('takes the division maximum from the settings', () => {
    const small = registrationSchema.parse({ division_max: 8 });
    expect(mayApprove({ lineup: complete, onOtherRoster: [], divisionTeams: 8 }, small)).toEqual({
      ok: false,
      errors: [{ error: 'division_full', max: 8 }],
    });
  });
});

describe('mayLeave', () => {
  it('lets a player leave until the lineup locks', () => {
    expect(mayLeave(FIVE, 3, false)).toEqual({ ok: true });
    expect(mayLeave(FIVE, 3, true)).toEqual({ ok: false, error: 'lineup_locked' });
    expect(mayLeave(FIVE, 9, false)).toEqual({ ok: false, error: 'not_joined' });
  });
});

describe('registration settings', () => {
  it('asks for 5 starters and up to 2 substitutes, with 7 days to use an invitation, and no age', () => {
    expect(registrationSchema.parse({})).toEqual({
      starters: 5,
      subs_max: 2,
      stats_consent_required: false,
      invite_days: 7,
      min_age: null,
      lineup_lock_days: 0,
      division_max: 12,
    });
    expect(registrationSchema.safeParse({ min_age: -1 }).success).toBe(false);
    expect(registrationSchema.safeParse({ starters: 0 }).success).toBe(false);
  });
});
