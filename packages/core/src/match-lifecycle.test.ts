import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MATCH_ACTIONS,
  MATCH_ACTORS,
  nextMatchStatus,
  type MatchAction,
  type MatchActor,
  type MatchLifecycleStatus,
} from './match-lifecycle.ts';

const STATUSES: MatchLifecycleStatus[] = [
  'scheduled',
  'reported',
  'confirmed',
  'disputed',
  'validated',
  'forfeit',
  'void',
];
const step = (
  status: MatchLifecycleStatus,
  action: MatchAction,
  actor: MatchActor,
  validation: 'staff' | 'opponent' = 'staff',
) => nextMatchStatus({ status, action, actor, validation });
const to = (status: MatchLifecycleStatus) => ({ ok: true, status });

describe('nextMatchStatus: the LFR path, where staff validate', () => {
  it('goes from scheduled to validated through report, confirmation and validation', () => {
    expect(step('scheduled', 'report', 'reporting_team')).toEqual(to('reported'));
    expect(step('reported', 'confirm', 'opposing_team')).toEqual(to('confirmed'));
    expect(step('confirmed', 'validate', 'staff')).toEqual(to('validated'));
  });

  it('lets the opponent dispute a report, which staff then settle', () => {
    expect(step('reported', 'dispute', 'opposing_team')).toEqual(to('disputed'));
    expect(step('disputed', 'validate', 'staff')).toEqual(to('validated'));
    expect(step('disputed', 'reject', 'staff')).toEqual(to('scheduled'));
  });

  it('lets staff validate or reject a report the opponent has not answered', () => {
    expect(step('reported', 'validate', 'staff')).toEqual(to('validated'));
    expect(step('reported', 'reject', 'staff')).toEqual(to('scheduled'));
    expect(step('confirmed', 'reject', 'staff')).toEqual(to('scheduled'));
  });
});

describe('nextMatchStatus: leagues where the opponent validates', () => {
  it('counts the result as soon as the opponent confirms', () => {
    expect(step('reported', 'confirm', 'opposing_team', 'opponent')).toEqual(to('validated'));
  });

  it('still sends a dispute to staff', () => {
    expect(step('reported', 'dispute', 'opposing_team', 'opponent')).toEqual(to('disputed'));
    expect(step('disputed', 'validate', 'staff', 'opponent')).toEqual(to('validated'));
  });
});

describe('nextMatchStatus: staff decisions', () => {
  it.each(['scheduled', 'reported', 'confirmed', 'disputed', 'validated'] as const)(
    'lets staff record a forfeit on a %s match',
    (status) => {
      expect(step(status, 'forfeit', 'staff')).toEqual(to('forfeit'));
    },
  );

  it.each(['scheduled', 'reported', 'confirmed', 'disputed', 'validated', 'forfeit'] as const)(
    'lets staff annul a %s match',
    (status) => {
      expect(step(status, 'void', 'staff')).toEqual(to('void'));
    },
  );

  it('changes nothing on an annulled match, and cannot forfeit a forfeit', () => {
    for (const action of MATCH_ACTIONS) {
      expect(step('void', action, 'staff')).toEqual({ ok: false, error: 'wrong_status' });
    }
    expect(step('forfeit', 'forfeit', 'staff')).toEqual({ ok: false, error: 'wrong_status' });
  });
});

describe('nextMatchStatus: who may do what', () => {
  it.each([
    ['report', 'opposing_team', 'scheduled'],
    ['report', 'staff', 'scheduled'],
    ['confirm', 'reporting_team', 'reported'],
    ['confirm', 'staff', 'reported'],
    ['dispute', 'reporting_team', 'reported'],
    ['validate', 'reporting_team', 'reported'],
    ['validate', 'opposing_team', 'confirmed'],
    ['reject', 'opposing_team', 'reported'],
    ['forfeit', 'reporting_team', 'scheduled'],
    ['forfeit', 'opposing_team', 'scheduled'],
    ['void', 'reporting_team', 'validated'],
  ] as const)('refuses %s by the %s', (action, actor, status) => {
    expect(step(status, action, actor)).toEqual({ ok: false, error: 'not_allowed' });
  });

  it.each([
    ['report', 'reporting_team', 'reported'],
    ['report', 'reporting_team', 'validated'],
    ['confirm', 'opposing_team', 'scheduled'],
    ['confirm', 'opposing_team', 'confirmed'],
    ['dispute', 'opposing_team', 'confirmed'],
    ['dispute', 'opposing_team', 'validated'],
    ['validate', 'staff', 'scheduled'],
    ['validate', 'staff', 'validated'],
    ['reject', 'staff', 'scheduled'],
    ['reject', 'staff', 'validated'],
  ] as const)('refuses %s by the %s on a %s match', (action, actor, status) => {
    expect(step(status, action, actor)).toEqual({ ok: false, error: 'wrong_status' });
  });

  it('only ever lets staff make a result count or stop counting, unless the opponent validates', () => {
    const counted = (status: MatchLifecycleStatus) =>
      status === 'validated' || status === 'forfeit';
    fc.assert(
      fc.property(
        fc.constantFrom(...STATUSES),
        fc.constantFrom(...MATCH_ACTIONS),
        fc.constantFrom(...MATCH_ACTORS),
        (status, action, actor) => {
          const result = step(status, action, actor, 'staff');
          if (result.ok && counted(result.status) !== counted(status)) expect(actor).toBe('staff');
        },
      ),
    );
  });
});
