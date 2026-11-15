import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, TEST_ORIGIN, testSite } from './testing.ts';

// The league's Discord server on the website (maintainer, 15 November 2026): for whoever may
// manage the league's server.

const ADMINS_ROLE = '300000000000000003';
const INVITE = 'https://discord.gg/lfr';

function site() {
  const browser = testSite();
  browser.gateway.guilds.set(TEST_GUILD, {
    name: 'LFR Staging',
    roles: [
      { id: ADMINS_ROLE, name: 'Admins' },
      { id: TEST_STAFF_ROLE, name: 'Staff' },
    ],
    managers: [ANA.id],
  });
  browser.gateway.invites.set(INVITE, { guildId: TEST_GUILD, expiresAt: null });
  return browser;
}

describe('the league’s Discord settings', () => {
  it('asks to log in, then shows the server, its roles and the invitation to whoever manages it', async () => {
    const { request, logIn } = site();
    const anonymous = await request('/c/lfr/discord');
    expect(anonymous.headers.get('location')).toBe('/auth/login?next=%2Fc%2Flfr%2Fdiscord');
    await logIn('/c/lfr/discord');
    const page = await request('/c/lfr/discord');
    expect(page.status).toBe(200);
    const text = await page.text();
    expect(text).toContain('<h1>Serveur Discord — LFR</h1>');
    expect(text).toMatch(new RegExp(`<option\\s+value="${TEST_STAFF_ROLE}"\\s+selected`));
    expect(text).toContain('href="https://discord.com/oauth2/authorize?client_id=1"');
    // Their own page links to it.
    expect(await (await request('/me')).text()).toContain('<a href="/c/lfr/discord"');
  });

  it('saves the role and the invitation, and says what is wrong otherwise', async () => {
    const { db, request, logIn, post } = site();
    await logIn('/c/lfr/discord');
    const fields = { guild_id: TEST_GUILD, staff_role: ADMINS_ROLE };
    const refused = await post('/c/lfr/discord', {
      ...fields,
      invite_url: 'https://discord.gg/gone',
    });
    expect(refused.status).toBe(400);
    const text = await refused.text();
    expect(text).toContain('Ce lien n’est pas une invitation Discord valable.');
    expect(text).toContain('value="https://discord.gg/gone"');

    const saved = await post('/c/lfr/discord', { ...fields, invite_url: INVITE });
    expect(saved.headers.get('location')).toBe('/c/lfr/discord?saved=1');
    expect(db.select().from(schema.leagueGuild).get()).toMatchObject({
      staffRoleId: ADMINS_ROLE,
      inviteUrl: INVITE,
    });
    expect(await (await request('/c/lfr/discord?saved=1')).text()).toContain(
      'Réglages enregistrés.',
    );
  });

  it('is closed to anyone who may not manage the server, and to forged forms', async () => {
    const { db, request, logIn, post, gateway } = site();
    await logIn('/c/lfr/discord');
    const fields = { guild_id: TEST_GUILD, staff_role: ADMINS_ROLE, invite_url: INVITE };
    expect(
      (
        await request('/c/lfr/discord', {
          method: 'POST',
          headers: { Origin: TEST_ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ ...fields, _csrf: 'forged' }),
        })
      ).status,
    ).toBe(403);
    gateway.guilds.set(TEST_GUILD, { name: 'LFR Staging', roles: [], managers: [] });
    expect((await request('/c/lfr/discord')).status).toBe(403);
    expect((await post('/c/lfr/discord', fields)).status).toBe(403);
    expect(db.select().from(schema.leagueGuild).get()?.staffRoleId).toBe(TEST_STAFF_ROLE);
    expect(await (await request('/me')).text()).not.toContain('/c/lfr/discord');
    expect((await request('/c/nope/discord')).status).toBe(404);
    gateway.failing = true;
    expect((await request('/c/lfr/discord')).status).toBe(502);
  });
});
