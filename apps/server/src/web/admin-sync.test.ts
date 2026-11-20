import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, testSite } from './testing.ts';

// The league server's sync page (phase 4; design doc section 6): a dry run, and a button that
// syncs now. Until team roles and match channels come (4-6, 4-7), Ligo wants nothing in the
// server; a stored object deleted by hand is what there is to put right: Ligo forgets it.

const SYNC = '/admin/mlb-group/lfr/discord/sync';
const where = (response: Response) => response.headers.get('location');

function site(manage: boolean) {
  const browser = testSite();
  const row = browser.db.select().from(schema.competition).get();
  if (!row) throw new Error('set up');
  browser.db
    .update(schema.competition)
    .set({ rulesetJson: { ...row.rulesetJson, discord: { ...row.rulesetJson.discord, manage } } })
    .run();
  browser.gateway.snapshots.set(TEST_GUILD, {
    everyoneId: TEST_GUILD,
    roles: [],
    categories: [],
    channels: [],
    members: [],
  });
  const goneByHand = () =>
    browser.db
      .insert(schema.discordObject)
      .values({
        guildId: TEST_GUILD,
        kind: 'team_role',
        key: 'team:1',
        discordId: '800000000000000555',
        createdByLigo: true,
        createdAt: 1,
      })
      .run();
  const asStaff = async () => {
    browser.setRoles([TEST_STAFF_ROLE], ANA.id);
    await browser.logIn(SYNC);
  };
  return { ...browser, goneByHand, asStaff };
}

describe('the sync page', () => {
  it('is for staff, linked from the competition’s admin page', async () => {
    const { request, logIn, setRoles } = site(true);
    await logIn(SYNC);
    expect((await request(SYNC)).status).toBe(403);
    setRoles([TEST_STAFF_ROLE], ANA.id);
    expect(await (await request('/admin/mlb-group/lfr')).text()).toContain(`href="${SYNC}"`);
    expect(await (await request(SYNC)).text()).toContain('Le serveur est à jour');
  });

  it('says when the league does not let Ligo manage its server, with no button', async () => {
    const { request, asStaff } = site(false);
    await asStaff();
    const page = await (await request(SYNC)).text();
    expect(page).toContain('Ligo ne gère pas encore le serveur');
    expect(page).not.toContain('Synchroniser maintenant');
  });

  it('shows the dry run, and syncs when staff click', async () => {
    const { db, request, post, asStaff, goneByHand, gateway } = site(true);
    goneByHand();
    await asStaff();
    const page = await (await request(SYNC)).text();
    expect(page).toContain('Objets supprimés à la main, à oublier : 1');
    expect(page).toContain('Synchroniser maintenant');
    // The dry run changed nothing.
    expect(db.select().from(schema.discordObject).all()).toHaveLength(1);
    const done = where(await post(SYNC, {}));
    expect(done).toBe(`${SYNC}?applied=1&failed=0`);
    expect(db.select().from(schema.discordObject).all()).toEqual([]);
    expect(await (await request(done ?? '')).text()).toContain(
      'Synchronisation faite. Changements : 1 ; refusés par Discord : 0.',
    );
    expect(gateway.changes).toEqual([]);
  });

  it('says when Discord does not answer', async () => {
    const { request, asStaff, gateway } = site(true);
    await asStaff();
    gateway.failing = true;
    expect(await (await request(SYNC)).text()).toContain('Discord ne répond pas');
  });
});
