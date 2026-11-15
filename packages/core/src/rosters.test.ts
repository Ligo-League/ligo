import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mayJoinRoster, mayManagePlayers, playsSeasonUnderWay, rosterGaps } from './rosters.ts';
import { TEAM_ROLES } from './team-roles.ts';

// A roster's own players, before any competition (M-33, M-34, maintainer, 15 November 2026):
// they join through the roster's invitation link with their own account, up to the group's
// maximum (10 by default). The league's own conditions (age, stats consent, its Discord server,
// one roster per competition) are checked when the roster registers.

const PROFILE = { gameAccount: true, nationality: 'FR', statsConsent: false, birthDate: null };
const JOINER = { onRoster: false, gaps: [], count: 4, max: 10 };

describe('rosterGaps', () => {
  it('asks for the player’s own game account and nationality only', () => {
    expect(rosterGaps(PROFILE)).toEqual([]);
    expect(rosterGaps({ ...PROFILE, gameAccount: false, nationality: null })).toEqual([
      'game_account',
      'nationality',
    ]);
  });
});

describe('mayJoinRoster', () => {
  it('lets a player with a complete profile join a roster with room, even one playing a season', () => {
    expect(mayJoinRoster(JOINER)).toEqual({ ok: true });
  });

  it('refuses, in this order: already on it, full, profile to complete', () => {
    expect(mayJoinRoster({ ...JOINER, onRoster: true, count: 10 })).toEqual({
      ok: false,
      error: 'already_on_roster',
    });
    expect(mayJoinRoster({ ...JOINER, count: 10, gaps: ['nationality'] })).toEqual({
      ok: false,
      error: 'roster_full',
    });
    expect(mayJoinRoster({ ...JOINER, gaps: ['game_account'] })).toEqual({
      ok: false,
      error: 'incomplete_profile',
    });
  });

  it('never lets a roster grow past its maximum', () => {
    fc.assert(
      fc.property(fc.nat(30), fc.nat(30), (count, max) => {
        const reply = mayJoinRoster({ ...JOINER, count, max });
        expect(reply.ok).toBe(count < max);
      }),
    );
  });
});

describe('playsSeasonUnderWay', () => {
  it('names a roster with a place in a season under way, whose lineup is the mercato’s', () => {
    expect(playsSeasonUnderWay([])).toBe(false);
    expect(playsSeasonUnderWay(['registration', 'closed'])).toBe(false);
    expect(playsSeasonUnderWay(['closed', 'active'])).toBe(true);
    expect(playsSeasonUnderWay(['cup'])).toBe(true);
  });
});

describe('mayManagePlayers', () => {
  it('lets the officials who may add officials manage players: not the coach', () => {
    expect(TEAM_ROLES.filter((role) => mayManagePlayers(role))).toEqual([
      'owner',
      'club_manager',
      'manager',
    ]);
  });
});
