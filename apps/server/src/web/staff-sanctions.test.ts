import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../services/permissions.ts';
import { setTeamOwner } from '../services/team-staff.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { testSite } from './testing.ts';

// The staff's sanctions page (phase 3f-4, design doc section 3): each team's status, forfeits and
// automatic exclusion, the season's sanctions, and the forms that give a sanction, exclude a
// team, reinstate it on appeal and switch its automatic exclusion, each with a reason. In
// leagueDatabase(): competition 1 is LFR; team 3 is Charlie, which forfeited match 2.

const QUEUE = '800000000000000001';
const RESULTS = '800000000000000002';
const LEA = { id: '222222222222222222', displayName: 'Léa Staff' };
const MANAGER = { id: '700000000000000002', displayName: 'Manager' };
const STAFF: Actor = { guildId: TEST_GUILD, user: LEA, memberRoleIds: [TEST_STAFF_ROLE] };

function site() {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 3, member: MANAGER }, 100);
  db.update(schema.leagueGuild).set({ alertsChannelId: QUEUE, resultsChannelId: RESULTS }).run();
  const browser = testSite({ db, users: { 'code-lea': LEA } });
  browser.setRoles([TEST_STAFF_ROLE], LEA.id);
  const act = (action: string, fields: Record<string, string>) =>
    browser.post(`/staff/sanctions/1/${action}`, fields);
  const slotOf = (teamId: number) =>
    db.select().from(schema.slot).where(eq(schema.slot.teamId, teamId)).get();
  return { ...browser, act, slotOf };
}
const where = (response: Response) => response.headers.get('location');

describe('the staff sanctions page', () => {
  it('shows each team with its status and forfeits, for league staff only', async () => {
    const { request, logIn, jar } = site();
    expect(where(await request('/staff/sanctions'))).toBe('/auth/login?next=/staff/sanctions');
    await logIn('/me');
    expect((await request('/staff/sanctions')).status).toBe(403);
    jar.clear();
    await logIn('/staff/sanctions', 'code-lea');
    const page = await (await request('/staff/sanctions')).text();
    expect(page).toContain('Sanctions et exclusions');
    expect(page).toMatch(/Charlie<\/td>\s*<td>Ligue 1<\/td>\s*<td>Active<\/td>\s*<td>1<\/td>/);
    expect(page).toContain('action="/staff/sanctions/1/add"');
    // The queue links to it.
    expect(await (await request('/staff')).text()).toContain('href="/staff/sanctions"');
  });

  it('gives a sanction, which the standings apply and the page lists', async () => {
    const { request, logIn, act, db } = site();
    await logIn('/staff/sanctions', 'code-lea');
    expect(
      where(await act('add', { team: '3', kind: 'points', points: '-2', reason: 'Retard' })),
    ).toBe('/staff/sanctions?done=added#c1');
    expect(db.select().from(schema.sanction).all()).toMatchObject([
      { kind: 'points', pointsDelta: -2, reason: 'Retard' },
    ]);
    expect(await (await request('/staff/sanctions')).text()).toContain('Retard');
    expect(where(await act('add', { team: '3', kind: 'points', points: '', reason: 'x' }))).toBe(
      '/staff/sanctions?error=points_required#c1',
    );
    expect(where(await act('add', { team: '3', kind: 'warning', points: '', reason: ' ' }))).toBe(
      '/staff/sanctions?error=reason_required#c1',
    );
  });

  it('excludes a team, tells it directly, then reinstates it on appeal', async () => {
    const { logIn, act, slotOf, gateway } = site();
    await logIn('/staff/sanctions', 'code-lea');
    expect(where(await act('exclude', { team: '3', reason: 'Triche avérée' }))).toBe(
      '/staff/sanctions?done=excluded#c1',
    );
    expect(slotOf(3)?.status).toBe('excluded');
    expect(gateway.direct[0]?.message.content).toContain('Triche avérée');
    expect(gateway.posted[0]?.channelId).toBe(RESULTS);
    expect(where(await act('exclude', { team: '3', reason: 'Encore' }))).toBe(
      '/staff/sanctions?error=already_excluded#c1',
    );
    expect(where(await act('reinstate', { team: '3', reason: 'Appel accepté' }))).toBe(
      '/staff/sanctions?done=reinstated#c1',
    );
    expect(slotOf(3)?.status).toBe('active');
    expect(gateway.posted.at(-1)?.message.content).toBe('Charlie est réintégrée dans la saison.');
  });

  it('switches the automatic exclusion off with a reason, and back on', async () => {
    const { request, logIn, act, slotOf } = site();
    await logIn('/staff/sanctions', 'code-lea');
    expect(where(await act('auto', { team: '3', enabled: 'off', reason: 'Absence prévue' }))).toBe(
      '/staff/sanctions?done=auto_off#c1',
    );
    expect(slotOf(3)?.autoExclusionOffReason).toBe('Absence prévue');
    expect(await (await request('/staff/sanctions')).text()).toContain('Absence prévue');
    expect(where(await act('auto', { team: '3', enabled: 'on', reason: 'Fin' }))).toBe(
      '/staff/sanctions?done=auto_on#c1',
    );
    expect(slotOf(3)?.autoExclusionOffReason).toBeNull();
  });

  it('refuses anyone who is not staff of that league, on every POST', async () => {
    const { logIn, act, slotOf } = site();
    await logIn('/me');
    expect((await act('exclude', { team: '3', reason: 'x' })).status).toBe(403);
    expect(slotOf(3)?.status).toBe('active');
  });
});
