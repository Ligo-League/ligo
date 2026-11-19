import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { kairosRoster, leagueDatabase, registrationDatabase } from '../testing.ts';
import { openLineups, testSite } from './testing.ts';

// Registration on the website (design doc section 7; maintainer, 14 and 15 November 2026, M-33):
// an official who manages a roster's players registers it with the rulebook accepted, then picks
// its lineup among its players on the registration's page.

const BEN = { id: '700000000000000002', displayName: 'Ben' };

async function site(db = openLineups(registrationDatabase()), players = 6) {
  const kairos = await kairosRoster(db, players);
  const browser = testSite({ db, users: { 'code-ben': BEN } });
  // Every player is on the league's Discord server unless a test says otherwise.
  for (const id of kairos.playerIds) {
    const discordUserId = db
      .select()
      .from(schema.player)
      .where(eq(schema.player.id, id))
      .get()?.discordUserId;
    if (discordUserId) browser.gateway.members.set(`876543210987654321:${discordUserId}`, []);
  }
  const register = (fields: Record<string, string> = {}) =>
    browser.post('/mlb-group/lfr/register', {
      team: String(kairos.teamId),
      rules_version: '1',
      rules_accepted: '1',
      ...fields,
    });
  return { ...browser, ...kairos, register };
}
const where = (response: Response) => response.headers.get('location');

describe('the registration form', () => {
  it('is offered on the home page while a season takes registrations', async () => {
    const text = await (await (await site()).request('/')).text();
    expect(text).toMatch(/<a href="\/mlb-group\/lfr\/register"\s*>S’inscrire<\/a\s*>/);
    const closed = await (await (await site(leagueDatabase())).request('/')).text();
    expect(closed).not.toContain('/mlb-group/lfr/register');
  });

  it('asks to log in first, then offers the member’s rosters and the rulebook', async () => {
    const browser = await site();
    const anonymous = await browser.request('/mlb-group/lfr/register');
    expect(where(anonymous)).toBe('/auth/login?next=%2Fmlb-group%2Flfr%2Fregister');
    await browser.logIn('/mlb-group/lfr/register');
    const text = await (await browser.request('/mlb-group/lfr/register')).text();
    expect(text).toContain('Kairos [KRS] · 6 joueur(s)');
    expect(text).toContain('href="/mlb-group/lfr/rules"');
  });

  it('sends a member without a roster to create their club first', async () => {
    const browser = await site();
    await browser.logIn('/mlb-group/lfr/register', 'code-ben');
    const text = await (await browser.request('/mlb-group/lfr/register')).text();
    expect(text).toContain('href="/clubs/new"');
    expect(text).not.toContain('name="team"');
  });

  it('files the registration, then opens its page to pick the lineup', async () => {
    const browser = await site();
    await browser.logIn('/mlb-group/lfr/register');
    expect(where(await browser.register())).toBe('/registrations/1');
    expect(browser.db.select().from(schema.request).get()).toMatchObject({
      teamId: browser.teamId,
      status: 'pending',
    });
    const page = await (await browser.request('/registrations/1')).text();
    expect(page).toContain('Kairos');
    for (const id of browser.playerIds) expect(page).toContain(`name="role_${String(id)}"`);
  });

  it('shows the form again with each problem under its field', async () => {
    const browser = await site();
    await browser.logIn('/mlb-group/lfr/register');
    const refused = await browser.register({ rules_accepted: '' });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('field-error');
    expect(browser.db.select().from(schema.request).all()).toEqual([]);
  });

  it('says when registration is closed', async () => {
    const browser = await site(leagueDatabase());
    await browser.logIn('/mlb-group/lfr/register');
    expect(await (await browser.request('/mlb-group/lfr/register')).text()).toContain(
      'Inscriptions fermées',
    );
  });
});

describe('the registration’s page', () => {
  async function filed(players = 6) {
    const browser = await site(undefined, players);
    await browser.logIn('/mlb-group/lfr/register');
    await browser.register();
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = browser.playerIds;
    const lineup = (fields: Record<string, string>) =>
      browser.post('/registrations/1/lineup', fields);
    return { ...browser, a, b, c, d, e, f, lineup };
  }

  it('picks the lineup among the roster’s players, the captain a starter', async () => {
    const { a, b, c, d, e, f, lineup, request, db } = await filed();
    const roles = Object.fromEntries([a, b, c, d, e].map((id) => [`role_${String(id)}`, 'player']));
    expect(
      where(await lineup({ ...roles, [`role_${String(f)}`]: 'sub', captain: String(a) })),
    ).toBe('/registrations/1?done=lineup');
    expect(db.select().from(schema.registrationPlayer).all()).toHaveLength(6);
    const page = await (await request('/registrations/1')).text();
    expect(page).toContain('L’équipe est au complet');
    expect(
      where(await lineup({ ...roles, [`role_${String(f)}`]: 'sub', captain: String(f) })),
    ).toBe('/registrations/1?error=captain_not_starter');
  });

  it('says which players are not on the league’s Discord server', async () => {
    const { a, lineup, request, gateway, db } = await filed();
    await lineup({ [`role_${String(a)}`]: 'player' });
    const discordUserId = db
      .select()
      .from(schema.player)
      .where(eq(schema.player.id, a))
      .get()?.discordUserId;
    gateway.members.delete(`876543210987654321:${discordUserId ?? ''}`);
    const page = await (await request('/registrations/1')).text();
    expect(page).toContain('pas sur le serveur Discord de la ligue');
  });

  it('is hidden from a member who is not one of the roster’s officials', async () => {
    const { request, logIn, jar } = await filed();
    jar.clear();
    await logIn('/registrations/1', 'code-ben');
    expect((await request('/registrations/1')).status).toBe(404);
  });

  it('points to the roster’s page while it has no players', async () => {
    const browser = await site(undefined, 0);
    await browser.logIn('/mlb-group/lfr/register');
    await browser.register();
    const page = await (await browser.request('/registrations/1')).text();
    expect(page).toContain('href="/teams/kairos/manage#players"');
  });
});
