import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../services/permissions.ts';
import { reportResult } from '../services/reports.ts';
import { setTeamOwner } from '../services/team-staff.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, testSite } from './testing.ts';

// A division's staff on the website (phase 4; design doc section 7; M-05): Dina holds Ligue 1's
// staff role, not the league's. She sees Ligue 1's queue, its teams' sanctions and the staff
// panel of its matches; Ligue 2 and the admin panel stay closed to her.

const STAFF_L1 = '800000000000000020';
const STAFF_L2 = '800000000000000021';
const DINA = { id: '730000000000000001', displayName: 'Dina' };
const LEA: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const BRAVO: Actor = { guildId: TEST_GUILD, user: ANA, memberRoleIds: [] };

async function site(role = STAFF_L1) {
  const db = leagueDatabase();
  const set = (name: string, staffRoleId: string) =>
    db.update(schema.division).set({ staffRoleId }).where(eq(schema.division.name, name)).run();
  set('Ligue 1', STAFF_L1);
  set('Ligue 2', STAFF_L2);
  setTeamOwner(db, LEA, { teamId: 2, member: ANA }, 100);
  db.update(schema.leagueGuild).set({ alertsChannelId: '800000000000000001' }).run();
  const browser = testSite({ db, users: { 'code-dina': DINA } });
  const reported = await reportResult(
    db,
    browser.gateway,
    browser.evidence,
    BRAVO,
    {
      matchId: 3,
      scoreA: 7,
      scoreB: 5,
      screenshot: { url: 'https://cdn.discordapp.com/x.png', contentType: 'image/png', size: 9 },
    },
    () => ({ content: 'Résultat à valider', buttons: [] }),
    9000,
  );
  if (!reported.ok) throw new Error(reported.error);
  browser.setRoles([role], DINA.id);
  await browser.logIn('/staff', 'code-dina');
  return browser;
}

describe('a division’s staff on the website', () => {
  it('see their division’s queue, without registrations or mercato moves', async () => {
    const { request } = await site();
    const response = await request('/staff');
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain('Ligue 1, semaine 3 : Bravo 7–5 Charlie');
    expect(page).toContain('(Ligue 1)');
  });

  it('see nothing of another division’s queue', async () => {
    const { request } = await site(STAFF_L2);
    const page = await (await request('/staff')).text();
    expect(page).not.toContain('Bravo 7–5 Charlie');
    expect(page).toContain('(Ligue 2)');
  });

  it('get the staff panel on their division’s matches only', async () => {
    const { request } = await site();
    expect(await (await request('/matches/3')).text()).toContain('Actions du staff');
    expect(await (await request('/matches/4')).text()).not.toContain('Actions du staff');
  });

  it('see their division’s teams on the sanctions page, and never the admin panel', async () => {
    const { request } = await site();
    const page = await (await request('/staff/sanctions')).text();
    expect(page).toContain('Bravo');
    expect(page).not.toContain('Xray');
    expect((await request('/admin/mlb-group/lfr')).status).toBe(403);
  });
});
