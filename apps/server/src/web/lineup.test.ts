import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { TeamRole } from '@ligo/core';
import { ensurePlayer } from '../services/players.ts';
import { fileRegistration } from '../services/registrations.ts';
import { kairosRoster, registrationDatabase } from '../testing.ts';
import { openLineups, TEST_NOW, testSite } from './testing.ts';

// The registration's page beyond picking the lineup (register.test.ts): withdrawing, who may
// change it (the filer or any official who may register the roster; maintainer, 15 November
// 2026), and the lock before the season (M-29). Ana registered her roster Kairos.

const BEN = { id: '700000000000000002', displayName: 'Ben' };

async function site() {
  const db = openLineups(registrationDatabase());
  const kairos = await kairosRoster(db, 6);
  fileRegistration(
    db,
    kairos.owner,
    'lfr',
    { teamId: kairos.teamId, rulesVersionId: 1, rulesAccepted: true },
    TEST_NOW,
  );
  const browser = testSite({ db, users: { 'code-ben': BEN } });
  const lineup = () => db.select().from(schema.registrationPlayer).all();
  /** Ben becomes one of Kairos's officials. */
  const official = (role: Extract<TeamRole, 'manager' | 'coach'>) => {
    const ben = ensurePlayer(
      db,
      { orgId: 1, discordUserId: BEN.id, displayName: BEN.displayName },
      1,
    );
    db.insert(schema.teamStaff)
      .values({ teamId: kairos.teamId, playerId: ben.id, role, since: 1 })
      .run();
  };
  return { ...browser, ...kairos, lineup, official };
}
const where = (response: Response) => response.headers.get('location');

describe('the registration’s page', () => {
  it('withdraws, after a confirmation', async () => {
    const { request, logIn, post } = await site();
    await logIn('/registrations/1');
    expect(where(await post('/registrations/1/withdraw', {}))).toBe(
      '/registrations/1?error=confirm',
    );
    expect(where(await post('/registrations/1/withdraw', { confirm: '1' }))).toBe(
      '/registrations/1?done=withdrawn',
    );
    const withdrawn = await (await request('/registrations/1')).text();
    expect(withdrawn).toContain('Inscription retirée');
    expect(withdrawn).not.toContain('action="/registrations/1/lineup"');
  });

  it('is for any official who may register the roster, each change audited as theirs', async () => {
    const { db, request, logIn, post, playerIds, lineup, official } = await site();
    official('manager');
    await logIn('/me', 'code-ben');
    expect(await (await request('/me')).text()).toContain('<a href="/registrations/1">');
    expect((await request('/registrations/1')).status).toBe(200);
    const fields = { [`role_${String(playerIds[0])}`]: 'player' };
    expect(where(await post('/registrations/1/lineup', fields))).toBe(
      '/registrations/1?done=lineup',
    );
    expect(lineup()).toHaveLength(1);
    const ben = db
      .select()
      .from(schema.player)
      .where(eq(schema.player.discordUserId, BEN.id))
      .get();
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'registration.lineup',
      actorPlayerId: ben?.id,
    });
    expect(where(await post('/registrations/1/withdraw', { confirm: '1' }))).toBe(
      '/registrations/1?done=withdrawn',
    );
  });

  it('is nobody else’s, a coach of the roster included', async () => {
    const { request, logIn, post, playerIds, lineup, official } = await site();
    official('coach');
    await logIn('/me', 'code-ben');
    expect(await (await request('/me')).text()).not.toContain('/registrations/1');
    expect((await request('/registrations/1')).status).toBe(404);
    const fields = { [`role_${String(playerIds[0])}`]: 'player' };
    expect((await post('/registrations/1/lineup', fields)).status).toBe(404);
    expect((await post('/registrations/1/withdraw', { confirm: '1' })).status).toBe(404);
    expect(lineup()).toEqual([]);
  });

  it('shows the lineup without changes once it is locked', async () => {
    const { db, request, logIn, post, playerIds, lineup } = await site();
    db.update(schema.season)
      .set({ startsOn: '2027-01-10' })
      .where(eq(schema.season.name, 'Saison 4'))
      .run();
    await logIn('/registrations/1');
    const page = await (await request('/registrations/1')).text();
    expect(page).toContain('Les effectifs sont verrouillés');
    expect(page).not.toContain('action="/registrations/1/lineup"');
    const fields = { [`role_${String(playerIds[0])}`]: 'player' };
    expect(where(await post('/registrations/1/lineup', fields))).toBe(
      '/registrations/1?error=lineup_locked',
    );
    expect(lineup()).toEqual([]);
  });
});
