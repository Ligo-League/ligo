import { describe, expect, it } from 'vitest';
import { approvalFor, decideRequest, mayFile, reminderAt, requestDeadline } from './requests.ts';
import { requestsSchema } from './settings.ts';

// Team requests (design doc section 5, "Team requests"; maintainer, 13 November 2026): a team's
// owner and managers ask, the league approves what its rules restrict, the rest applies at once.

const SETTINGS = requestsSchema.parse({});

describe('mayFile', () => {
  it('lets the owner and managers ask to add a manager or a coach, not the coach', () => {
    expect(mayFile('team_member_add', 'owner', false)).toEqual({ ok: true });
    expect(mayFile('team_member_add', 'manager', false)).toEqual({ ok: true });
    expect(mayFile('team_member_add', 'coach', false)).toEqual({ ok: false, error: 'not_allowed' });
  });

  it('lets only the owner hand the team over', () => {
    expect(mayFile('team_owner', 'owner', false)).toEqual({ ok: true });
    expect(mayFile('team_owner', 'manager', false)).toEqual({ ok: false, error: 'owner_only' });
  });

  it('lets the owner remove anyone, and anyone but the owner leave', () => {
    expect(mayFile('team_member_remove', 'owner', false)).toEqual({ ok: true });
    expect(mayFile('team_member_remove', 'manager', false)).toEqual({
      ok: false,
      error: 'owner_only',
    });
    expect(mayFile('team_member_remove', 'manager', true)).toEqual({ ok: true });
    expect(mayFile('team_member_remove', 'coach', true)).toEqual({ ok: true });
    // A team always has someone answerable to the league: the owner hands it over first.
    expect(mayFile('team_member_remove', 'owner', true)).toEqual({
      ok: false,
      error: 'owner_cannot_leave',
    });
  });
});

describe('approvalFor', () => {
  it('follows the league settings: additions and handovers by staff, removals at once', () => {
    expect(approvalFor('team_member_add', SETTINGS, false)).toBe('staff');
    expect(approvalFor('team_owner', SETTINGS, false)).toBe('staff');
    expect(approvalFor('team_member_remove', SETTINGS, false)).toBe('auto');
  });

  it('lets a league ask for its approval of removals too, but never of someone leaving', () => {
    const strict = requestsSchema.parse({ approval: { team_member_remove: 'staff' } });
    expect(approvalFor('team_member_remove', strict, false)).toBe('staff');
    expect(approvalFor('team_member_remove', strict, true)).toBe('auto');
  });
});

describe('decideRequest', () => {
  it('moves a pending request once, and only once', () => {
    expect(decideRequest('pending', 'approve')).toEqual({ ok: true, status: 'approved' });
    expect(decideRequest('pending', 'reject')).toEqual({ ok: true, status: 'rejected' });
    expect(decideRequest('pending', 'withdraw')).toEqual({ ok: true, status: 'withdrawn' });
    for (const status of ['approved', 'rejected', 'withdrawn'] as const) {
      for (const decision of ['approve', 'reject', 'withdraw'] as const) {
        expect(decideRequest(status, decision)).toEqual({ ok: false, error: 'not_pending' });
      }
    }
  });
});

describe('deadline and reminder', () => {
  const HOUR = 3_600_000;

  it('gives staff 24 hours and reminds them 6 hours before, by default', () => {
    expect(requestDeadline(1000, SETTINGS)).toBe(1000 + 24 * HOUR);
    expect(reminderAt(1000, SETTINGS)).toBe(1000 + 18 * HOUR);
  });

  it('can remind at the deadline itself, or not at all', () => {
    expect(reminderAt(0, requestsSchema.parse({ remind_before_hours: 0 }))).toBe(24 * HOUR);
    expect(reminderAt(0, requestsSchema.parse({ remind_before_hours: null }))).toBeNull();
  });

  it('refuses a reminder before the request is even filed', () => {
    expect(
      requestsSchema.safeParse({ answer_within_hours: 6, remind_before_hours: 6 }).success,
    ).toBe(false);
  });
});
