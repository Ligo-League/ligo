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
  it('reads how the league validates results', () => {
    expect(helpFacts(leagueDatabase(), MEMBER)).toEqual({ staff: false, validation: 'opponent' });
  });

  it('knows staff from the stored staff role', () => {
    expect(helpFacts(leagueDatabase(), STAFF).staff).toBe(true);
  });

  it('has no rules on a server linked to no league, nor a staff member', () => {
    const none = { staff: false, validation: null };
    expect(helpFacts(leagueDatabase(), { ...STAFF, guildId: '999999999999999999' })).toEqual(none);
    expect(helpFacts(leagueDatabase(), { ...STAFF, guildId: null })).toEqual(none);
  });
});
