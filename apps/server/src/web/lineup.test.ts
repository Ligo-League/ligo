import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fileRegistration } from '../services/registrations.ts';
import { kairosRoster, registrationDatabase } from '../testing.ts';
import { openLineups, TEST_NOW, testSite } from './testing.ts';

// The filer's registration page beyond picking the lineup (register.test.ts): withdrawing, who
// may change it, and the lock before the season (M-29). Ana registered her roster Kairos.

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
  return { ...browser, ...kairos, lineup };
}
const where = (response: Response) => response.headers.get('location');

describe('the filer’s registration page', () => {
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

  it('is the filer’s only', async () => {
    const { logIn, post, playerIds, lineup } = await site();
    await logIn('/me', 'code-ben');
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
