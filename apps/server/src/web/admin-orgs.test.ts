import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { pngForTests } from '../services/logo.ts';
import { ensurePlayer } from '../services/players.ts';
import { TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, testSite } from './testing.ts';

// The admin panel's organisation pages (phase 3h; M-20): Ana manages a Discord server where the
// bot is, so she may create an organisation, which she then owns. MLB Group's owner is OWNER.

const OWNER = { id: '994597181476569170', displayName: 'Owner' };
const where = (response: Response) => response.headers.get('location');

function site() {
  const browser = testSite({ users: { 'code-owner': OWNER } });
  browser.gateway.guilds.set('800000000000000077', {
    name: 'Ana’s server',
    roles: [],
    managers: [ANA.id],
  });
  const create = (fields: Record<string, string> = {}) =>
    browser.post('/orgs/new', {
      name: 'Benelux Siege League',
      slug: '',
      locale: 'en',
      description: '',
      ...fields,
    });
  const orgRow = (slug: string) =>
    browser.db.select().from(schema.org).where(eq(schema.org.slug, slug)).get();
  return { ...browser, create, orgRow };
}

describe('creating an organisation', () => {
  it('needs a Discord server the creator manages, then makes them its owner', async () => {
    const { request, logIn, create, orgRow, gateway } = site();
    await logIn('/orgs/new');
    expect(await (await request('/orgs/new')).text()).toContain('Créer l’organisation');
    expect(where(await create())).toBe('/admin/benelux-siege-league?done=created');
    expect(orgRow('benelux-siege-league')?.ownerDiscordUserId).toBe(ANA.id);
    const page = await (await request('/admin/benelux-siege-league?done=created')).text();
    expect(page).toContain('Organisation créée.');
    expect(page).toContain('Propriétaire : Ana');
    expect(await (await request('/admin')).text()).toContain(
      '<a href="/admin/benelux-siege-league">Benelux Siege League</a>',
    );

    gateway.guilds.clear();
    const refused = await create({ name: 'Other', slug: 'other' });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('Il faut pouvoir gérer un serveur Discord');
    expect(orgRow('other')).toBeUndefined();
  });

  it('shows what is wrong with the form, as typed', async () => {
    const { logIn, create } = site();
    await logIn('/orgs/new');
    const response = await create({ slug: 'staff', description: 'Gardée' });
    expect(response.status).toBe(400);
    const page = await response.text();
    expect(page).toContain('Cette adresse est réservée par le site.');
    expect(page).toContain('>Gardée</textarea>');
  });
});

describe('an organisation’s admin page', () => {
  it('is its owner’s only', async () => {
    const { request, logIn, jar } = site();
    await logIn('/admin/mlb-group');
    expect((await request('/admin/mlb-group')).status).toBe(403);
    expect((await request('/admin/nowhere')).status).toBe(404);
    jar.clear();
    await logIn('/admin/mlb-group', 'code-owner');
    const page = await (await request('/admin/mlb-group')).text();
    expect(page).toContain('<a href="/admin/mlb-group/lfr">LFR</a>');
    expect(page).toContain('action="/admin/mlb-group/owner"');
  });

  it('saves the settings, checking the invitation with Discord', async () => {
    const { request, logIn, post, create, orgRow, gateway } = site();
    await logIn('/orgs/new');
    await create();
    const save = (inviteUrl: string) =>
      post('/admin/benelux-siege-league', {
        name: 'BSL',
        locale: 'fr',
        description: 'La ligue.',
        invite_url: inviteUrl,
      });
    gateway.invites.set('https://discord.gg/week', { guildId: '1', expiresAt: 1 });
    const expiring = await save('https://discord.gg/week');
    expect(expiring.status).toBe(400);
    expect(await expiring.text()).toContain('Cette invitation expire');
    expect(orgRow('benelux-siege-league')?.name).toBe('Benelux Siege League');

    gateway.invites.set('https://discord.gg/bsl', { guildId: '1', expiresAt: null });
    expect(where(await save('https://discord.gg/bsl'))).toBe(
      '/admin/benelux-siege-league?done=saved',
    );
    expect(orgRow('benelux-siege-league')).toMatchObject({
      name: 'BSL',
      locale: 'fr',
      inviteUrl: 'https://discord.gg/bsl',
    });
    expect(await (await request('/admin/benelux-siege-league')).text()).toContain(
      'value="https://discord.gg/bsl"',
    );
  });

  it('takes a logo, and hands the organisation over', async () => {
    const { db, logIn, postFile, post, create, orgRow } = site();
    await logIn('/orgs/new');
    await create();
    // A copy with its own ArrayBuffer, as File takes.
    const png = new Uint8Array(pngForTests({ width: 256, height: 256, colorType: 6 }));
    expect(
      where(
        await postFile(
          '/admin/benelux-siege-league/logo',
          {},
          { logo: new File([png], 'logo.png', { type: 'image/png' }) },
        ),
      ),
    ).toBe('/admin/benelux-siege-league?done=logo');
    expect(orgRow('benelux-siege-league')?.logoKey).toMatch(/^logos\/org-benelux-siege-league-/);

    expect(where(await post('/admin/benelux-siege-league/owner', { owner: OWNER.id }))).toBe(
      '/admin/benelux-siege-league?error=confirm',
    );
    expect(
      where(await post('/admin/benelux-siege-league/owner', { owner: OWNER.id, confirm: '1' })),
    ).toBe('/admin/benelux-siege-league?error=unknown_player');
    ensurePlayer(db, { orgId: 1, discordUserId: OWNER.id, displayName: OWNER.displayName }, 1);
    expect(
      where(await post('/admin/benelux-siege-league/owner', { owner: OWNER.id, confirm: '1' })),
    ).toBe('/admin');
    expect(orgRow('benelux-siege-league')?.ownerDiscordUserId).toBe(OWNER.id);
  });
});

describe('the admin home', () => {
  it('lists the competitions where the viewer is staff', async () => {
    const { request, logIn, setRoles } = site();
    setRoles([TEST_STAFF_ROLE]);
    await logIn('/admin');
    const page = await (await request('/admin')).text();
    expect(page).toContain('Vous ne possédez aucune organisation.');
    expect(page).toContain('<a href="/admin/mlb-group/lfr">LFR</a>');
  });
});
