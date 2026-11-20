import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, testSite } from './testing.ts';

// The league server's sync page (phase 4; design doc section 6): a dry run, and a button that
// syncs now. The test league's five rosters each want a team role (M-46), which staff may link
// to a role already on the server instead.

const SYNC = '/admin/mlb-group/lfr/discord/sync';
const where = (response: Response) => response.headers.get('location');
const HAND_MADE = '800000000000000500';
const ROLES = '/admin/mlb-group/lfr/discord/team-roles';

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
    roles: [
      { id: TEST_GUILD, name: '@everyone', color: null, mentionable: false },
      { id: TEST_STAFF_ROLE, name: 'Staff', color: null, mentionable: false },
      { id: HAND_MADE, name: '⚔️ Alpha', color: null, mentionable: false },
    ],
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
        key: 'team:99',
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
    expect(await (await request(SYNC)).text()).toContain('Rôles à créer : 5');
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
    expect(page).toContain('Rôles à créer : 5');
    expect(page).toContain('Objets supprimés à la main, à oublier : 1');
    expect(page).toContain('Synchroniser maintenant');
    // The dry run changed nothing.
    expect(db.select().from(schema.discordObject).all()).toHaveLength(1);
    const done = where(await post(SYNC, {}));
    // Five team roles, and match 3's channel in its week's category: 7 objects and a forgotten one.
    expect(done).toBe(`${SYNC}?applied=8&failed=0`);
    expect(db.select().from(schema.discordObject).all()).toHaveLength(7);
    const after = await (await request(done ?? '')).text();
    expect(after).toContain('Synchronisation faite. Changements : 8 ; refusés par Discord : 0.');
    expect(after).toContain('Le serveur est à jour');
    expect(after).toContain('Créé par Ligo : Alpha Esport');
    expect(gateway.changes.map((entry) => entry.change.kind)).toEqual([
      ...Array.from({ length: 5 }, () => 'create_role'),
      'create_category',
      'create_text_channel',
    ]);
  });

  it('says when Discord does not answer', async () => {
    const { request, asStaff, gateway } = site(true);
    await asStaff();
    gateway.failing = true;
    expect(await (await request(SYNC)).text()).toContain('Discord ne répond pas');
  });
});

describe('the team roles on the sync page', () => {
  it('lists each roster with its role, and links a role already on the server', async () => {
    const { db, request, post, asStaff } = site(true);
    await asStaff();
    const page = await (await request(SYNC)).text();
    expect(page).toContain('Alpha Esport (ALP)');
    expect(page).toContain('Pas encore de rôle');
    expect(page).toContain(`<option value="${HAND_MADE}">⚔️ Alpha</option>`);
    expect(where(await post(`${ROLES}/1/link`, { role: HAND_MADE }))).toBe(
      `${SYNC}?role_done=link#roles`,
    );
    expect(db.select().from(schema.discordObject).all()).toMatchObject([
      { key: 'team:1', discordId: HAND_MADE, createdByLigo: false },
    ]);
    const linked = await (await request(`${SYNC}?role_done=link`)).text();
    expect(linked).toContain('Rôle lié.');
    expect(linked).toContain('Lié : ⚔️ Alpha');
    expect(where(await post(`${ROLES}/1/unlink`, {}))).toBe(`${SYNC}?role_done=unlink#roles`);
    expect(db.select().from(schema.discordObject).all()).toEqual([]);
  });

  it('says why a link is refused', async () => {
    const { request, post, asStaff } = site(true);
    await asStaff();
    expect(where(await post(`${ROLES}/1/link`, { role: 'nope' }))).toBe(
      `${SYNC}?role_error=unknown_role#roles`,
    );
    expect(where(await post(`${ROLES}/1/link`, { role: TEST_GUILD }))).toBe(
      `${SYNC}?role_error=reserved_role#roles`,
    );
    expect(await (await request(`${SYNC}?role_error=reserved_role`)).text()).toContain(
      'il ne peut pas être celui d’une équipe',
    );
    expect(where(await post(`${ROLES}/1/unlink`, {}))).toBe(`${SYNC}?role_error=not_a_link#roles`);
  });

  it('refuses who is not staff', async () => {
    const { db, post, logIn } = site(true);
    await logIn(SYNC);
    expect((await post(`${ROLES}/1/link`, { role: HAND_MADE })).status).toBe(403);
    expect(db.select().from(schema.discordObject).all()).toEqual([]);
  });
});
