import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mayJoinRoster, mayManagePlayers, rosterGaps, rosterOpen } from './rosters.ts';
import { TEAM_ROLES } from './team-roles.ts';

// A roster's own players, before any competition (M-33, M-34, maintainer, 15 November 2026):
// they join through the roster's invitation link with their own account, up to the group's
// maximum (10 by default). The league's own conditions (age, stats consent, its Discord server,
// one roster per competition) are checked when the roster registers.

const PROFILE = { gameAccount: true, nationality: 'FR', statsConsent: false, birthDate: null };
const JOINER = { onRoster: false, gaps: [], count: 4, max: 10, open: true };

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
  it('lets a player with a complete profile join an open roster with room', () => {
    expect(mayJoinRoster(JOINER)).toEqual({ ok: true });
  });

  it('refuses, in this order: already on it, closed, full, profile to complete', () => {
    expect(mayJoinRoster({ ...JOINER, onRoster: true, open: false })).toEqual({
      ok: false,
      error: 'already_on_roster',
    });
    expect(mayJoinRoster({ ...JOINER, open: false, count: 10 })).toEqual({
      ok: false,
      error: 'roster_closed',
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

describe('rosterOpen', () => {
  it('closes a roster’s players while it plays in a season under way (mercato, 3f)', () => {
    expect(rosterOpen([])).toBe(true);
    expect(rosterOpen(['registration', 'closed'])).toBe(true);
    expect(rosterOpen(['closed', 'active'])).toBe(false);
    expect(rosterOpen(['cup'])).toBe(false);
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
