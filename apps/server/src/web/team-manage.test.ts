import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../services/permissions.ts';
import { addTeamMember, listTeamStaff, setTeamOwner } from '../services/team-staff.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, testSite } from './testing.ts';

// `/teams/:slug/manage`: what `/team` does, on the website (phase 3e). Bravo (team 2) is owned
// by Ana; Ben is one of its managers. League staff change the team directly.

const QUEUE = '800000000000000001';
const LEA = { id: '222222222222222222', displayName: 'Léa Staff' };
const BEN = { id: '700000000000000002', displayName: 'Ben' };
const CHLOE = { id: '700000000000000003', displayName: 'Chloé' };
const STRANGER = { id: '700000000000000004', displayName: 'Stranger' };
const STAFF: Actor = { guildId: TEST_GUILD, user: LEA, memberRoleIds: [TEST_STAFF_ROLE] };

function site() {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 2, member: ANA }, 100);
  addTeamMember(db, STAFF, { teamId: 2, member: BEN, role: 'manager' }, 100);
  db.update(schema.leagueGuild).set({ alertsChannelId: QUEUE }).run();
  const browser = testSite({
    db,
    users: { 'code-lea': LEA, 'code-ben': BEN, 'code-stranger': STRANGER },
  });
  browser.setRoles([TEST_STAFF_ROLE], LEA.id);
  browser.gateway.usernames.set(`${TEST_GUILD}:chloe`, CHLOE);
  const officials = () => listTeamStaff(db, 2).map((member) => [member.displayName, member.role]);
  const requests = () => db.select().from(schema.request).all();
  return { ...browser, officials, requests };
}
const where = (response: Response) => response.headers.get('location');

describe('/teams/:slug/manage', () => {
  it('shows the roster’s officials and the forms its owner may use', async () => {
    const { request, logIn } = site();
    await logIn('/teams/bravo/manage');
    const page = await (await request('/teams/bravo/manage')).text();
    expect(page).toContain('Gérer Bravo');
    expect(page).toMatch(/Ben\s*<span class="muted">· Manager/);
    expect(page).toContain('action="/teams/bravo/manage/add"');
    expect(page).toContain('action="/teams/bravo/manage/owner"');
    // The owner hands the club over before leaving: no leave form.
    expect(page).not.toContain('action="/teams/bravo/manage/leave"');
    // /me links to it.
    expect(await (await request('/me')).text()).toContain('href="/teams/bravo/manage"');
  });

  it('shows the players, with the lineup forms closed until a mercato window opens', async () => {
    const { request, logIn, db } = site();
    await logIn('/teams/bravo/manage');
    const before = await (await request('/teams/bravo/manage')).text();
    expect(before).toContain('Aucun joueur enregistré pour cette équipe.');
    const seasonId = db.select().from(schema.season).get()?.id ?? 0;
    const playerId = db.select().from(schema.player).get()?.id ?? 0;
    db.insert(schema.rosterEntry)
      .values({ seasonId, teamId: 2, playerId, role: 'player', captain: true, validFrom: 0 })
      .run();
    const page = await (await request('/teams/bravo/manage')).text();
    expect(page).toMatch(/Ana\s*<span class="muted"\s*>·\s*titulaire · capitaine/);
    expect(page).toContain('<legend>Ajouter un joueur</legend>');
    expect(page).toContain('<fieldset disabled>');
    expect(page).toContain('aucune n’est ouverte');
  });

  it('is for the roster’s officials and league staff only', async () => {
    const { request, logIn, jar } = site();
    const loggedOut = await request('/teams/bravo/manage');
    expect(where(loggedOut)).toBe('/auth/login?next=%2Fteams%2Fbravo%2Fmanage');
    await logIn('/teams/bravo/manage', 'code-stranger');
    expect((await request('/teams/bravo/manage')).status).toBe(403);
    expect((await request('/teams/nobody/manage')).status).toBe(404);
    jar.clear();
    await logIn('/teams/bravo/manage', 'code-lea');
    const page = await (await request('/teams/bravo/manage')).text();
    expect(page).toContain('tes changements s’appliquent tout de suite');
  });

  it('files an addition by Discord username, posted to the staff queue, and withdraws it', async () => {
    const { request, logIn, post, gateway, requests } = site();
    await logIn('/teams/bravo/manage');
    const unknown = await post('/teams/bravo/manage/add', { username: 'nobody', role: 'coach' });
    expect(where(unknown)).toBe('/teams/bravo/manage?error=member_not_found');
    expect(requests()).toEqual([]);

    const filed = await post('/teams/bravo/manage/add', {
      username: 'Chloe',
      role: 'coach',
      note: 'Notre nouveau coach',
    });
    expect(where(filed)).toBe('/teams/bravo/manage?done=filed');
    expect(requests()).toMatchObject([{ kind: 'team_member_add', status: 'pending' }]);
    expect(gateway.posted).toMatchObject([{ channelId: QUEUE, edits: 0 }]);
    const page = await (await request('/teams/bravo/manage')).text();
    expect(page).toContain('Ajouter Chloé comme coach.');

    const withdrawn = await post('/teams/bravo/manage/requests/1/withdraw', {});
    expect(where(withdrawn)).toBe('/teams/bravo/manage?done=withdrawn');
    expect(requests()).toMatchObject([{ status: 'withdrawn' }]);
    // The staff queue's post says so, as after the bot's Withdraw button.
    expect(gateway.posted[0]?.edits).toBe(1);
  });

  it('follows the core rules: a manager may not hand the club over', async () => {
    const { logIn, post, requests } = site();
    await logIn('/teams/bravo/manage', 'code-ben');
    const refused = await post('/teams/bravo/manage/owner', { username: 'chloe' });
    expect(where(refused)).toBe('/teams/bravo/manage?error=owner_only');
    expect(requests()).toEqual([]);
  });

  it('lets an official leave at once, after confirming', async () => {
    const { logIn, post, officials } = site();
    await logIn('/teams/bravo/manage', 'code-ben');
    expect(where(await post('/teams/bravo/manage/leave', {}))).toBe('/teams/bravo/manage?');
    expect(officials()).toContainEqual(['Ben', 'manager']);
    expect(where(await post('/teams/bravo/manage/leave', { confirm: 'yes' }))).toBe('/me?left=1');
    expect(officials()).not.toContainEqual(['Ben', 'manager']);
  });

  it('lets the owner remove an official, found by the database and not the form', async () => {
    const { logIn, post, officials, db } = site();
    await logIn('/teams/bravo/manage');
    const stranger = await post('/teams/bravo/manage/remove', { member: STRANGER.id });
    expect(where(stranger)).toBe('/teams/bravo/manage?error=not_on_team');
    const removed = await post('/teams/bravo/manage/remove', { member: BEN.id, name: '<b>x</b>' });
    expect(where(removed)).toBe('/teams/bravo/manage?done=applied');
    expect(officials()).toEqual([['Ana', 'owner']]);
    const ben = db.select().from(schema.player).where(eq(schema.player.discordUserId, BEN.id));
    expect(ben.get()?.displayName).toBe('Ben');
  });

  it('lets league staff change the team directly', async () => {
    const { logIn, post, officials, requests } = site();
    await logIn('/teams/bravo/manage', 'code-lea');
    const added = await post('/teams/bravo/manage/add', { username: 'chloe', role: 'coach' });
    expect(where(added)).toBe('/teams/bravo/manage?done=changed');
    expect(officials()).toContainEqual(['Chloé', 'coach']);
    expect(requests()).toEqual([]);
  });

  it('asks Discord for a username only for the roster’s officials', async () => {
    const { logIn, post } = site();
    await logIn('/teams/bravo/manage', 'code-stranger');
    const probe = await post('/teams/bravo/manage/add', { username: 'chloe', role: 'coach' });
    expect(probe.status).toBe(403);
    expect(
      await (await post('/teams/bravo/manage/add', { username: 'x', role: 'coach' })).text(),
    ).not.toContain('member_not_found');
  });

  it('refuses a form from another site', async () => {
    const { logIn, post, requests } = site();
    await logIn('/teams/bravo/manage');
    const forged = await post(
      '/teams/bravo/manage/add',
      { username: 'chloe', role: 'coach' },
      { Origin: 'https://evil.example' },
    );
    expect(forged.status).toBe(403);
    expect(requests()).toEqual([]);
  });
});
