import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { helpFacts } from './help.ts';

const MEMBER = {
  guildId: TEST_GUILD,
  user: { id: '700000000000000001', displayName: 'Member' },
  memberRoleIds: [],
};
const STAFF = { ...MEMBER, memberRoleIds: [TEST_STAFF_ROLE] };

describe('helpFacts', () => {
  it("reads the league's rules that the explanations depend on", () => {
    expect(helpFacts(leagueDatabase(), MEMBER)).toEqual({
      staff: false,
      rules: {
        validation: 'staff',
        teamRoles: { managers_max: 3, coaches_max: 1 },
        requestHours: 24,
        forfeits: { warning_at: 2, exclusion_at: 3 },
        extensionWeeks: 1,
        autoSlot: { weekday: 7, time: '21:00' },
      },
    });
  });

  it('knows staff from the stored staff role', () => {
    expect(helpFacts(leagueDatabase(), STAFF).staff).toBe(true);
  });

  it('has no rules on a server linked to no league, nor a staff member', () => {
    expect(helpFacts(leagueDatabase(), { ...STAFF, guildId: '999999999999999999' })).toEqual({
      staff: false,
      rules: null,
    });
    expect(helpFacts(leagueDatabase(), { ...STAFF, guildId: null })).toEqual({
      staff: false,
      rules: null,
    });
  });

  it('has no forfeit thresholds before a season starts', () => {
    const db = leagueDatabase();
    db.update(schema.season).set({ status: 'registration' }).run();
    expect(helpFacts(db, MEMBER).rules?.forfeits).toBeNull();
  });
});
