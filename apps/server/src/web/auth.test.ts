import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { fakeEvidenceStore } from '../assets/evidence-store.ts';
import { fakeAssetStore } from '../assets/store.ts';
import { fakeGateway } from '../discord/testing.ts';
import { leagueDatabase, TEST_STAFF_ROLE } from '../testing.ts';
import { createWebApp } from './app.ts';
import { safeNext, SESSION_DAYS } from './session.ts';
import { ANA, TEST_NOW as NOW, TEST_ORIGIN as ORIGIN, testSite as site } from './testing.ts';

// Discord login, sessions, CSRF and `/me` (design doc section 7), through HTTP.

const DAY = 24 * 3600 * 1000;

describe('logging in with Discord', () => {
  it('sends the browser to Discord with a state, and back where it was once logged in', async () => {
    const { request, oauth, logIn, jar } = site();
    const home = await (await request('/')).text();
    expect(home).toContain('href="/auth/login?next=%2F"');
    const redirect = await request('/auth/login?next=/mbl-group/lfr/saison-3');
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe(
      `https://discord.example/authorize?state=${encodeURIComponent(oauth.states[0] ?? '')}`,
    );
    const back = await logIn('/mbl-group/lfr/saison-3');
    expect(back.status).toBe(303);
    expect(back.headers.get('location')).toBe('/mbl-group/lfr/saison-3');
    expect(jar.has('ligo_session')).toBe(true);
    const page = await (await request('/')).text();
    expect(page).toContain('<a href="/me">Ana</a>');
    expect(page).toContain('Se déconnecter');
  });

  it('sets a session cookie the page scripts cannot read, for 30 days', async () => {
    const { request, oauth } = site();
    await request('/auth/login');
    const back = await request(`/auth/callback?code=code-ana&state=${oauth.states[0] ?? ''}`);
    const cookie = back.headers.getSetCookie().find((value) => value.startsWith('ligo_session='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toContain(`Max-Age=${String(SESSION_DAYS * 24 * 3600)}`);
    // Over plain http on localhost; `Secure` comes with an https PUBLIC_URL.
    expect(cookie).not.toMatch(/Secure/);
  });

  it('creates the player on first login', async () => {
    const { db, logIn } = site();
    await logIn();
    const found = db
      .select()
      .from(schema.player)
      .where(eq(schema.player.discordUserId, ANA.id))
      .get();
    expect(found?.displayName).toBe('Ana');
  });

  it('refuses a wrong state, a missing one, and a state used twice', async () => {
    const { request, oauth, jar } = site();
    await request('/auth/login');
    expect((await request('/auth/callback?code=code-ana&state=forged')).status).toBe(400);
    // The login cookie is used once, even by a failed attempt.
    const state = oauth.states[0] ?? '';
    expect((await request(`/auth/callback?code=code-ana&state=${state}`)).status).toBe(400);
    expect((await request('/auth/callback?code=code-ana')).status).toBe(400);
    expect(jar.has('ligo_session')).toBe(false);
  });

  it('refuses a code Discord does not know, and says so when the user declined', async () => {
    const { request, oauth } = site();
    await request('/auth/login');
    const refused = await request(`/auth/callback?code=stale&state=${oauth.states[0] ?? ''}`);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('Connexion impossible');
    await request('/auth/login');
    const declined = await request(
      `/auth/callback?error=access_denied&state=${oauth.states[1] ?? ''}`,
    );
    expect(await declined.text()).toContain('Connexion annulée');
  });

  it('logs an outage without the code', async () => {
    const { request, oauth, logger } = site();
    oauth.userFor = () => Promise.reject(new Error('Discord answered 503 for a token'));
    await request('/auth/login');
    const failed = await request(`/auth/callback?code=secret-code&state=${oauth.states[0] ?? ''}`);
    expect(failed.status).toBe(502);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret-code');
  });

  it('only goes back to a path of this site', () => {
    expect(safeNext('/mbl-group/lfr/saison-3')).toBe('/mbl-group/lfr/saison-3');
    for (const next of ['//evil.example', 'https://evil.example', '/\\evil', 'me', '', undefined]) {
      expect(safeNext(next)).toBe('/me');
    }
  });
});

describe('sessions', () => {
  it('ignores a forged cookie and one older than 30 days', async () => {
    const forged = site();
    forged.jar.set('ligo_session', '1.1800000000000.forged-signature');
    expect(await (await forged.request('/')).text()).not.toContain('href="/me"');

    const old = site();
    await old.logIn();
    old.advance(SESSION_DAYS * DAY + 1);
    expect(await (await old.request('/')).text()).not.toContain('href="/me"');
  });

  it('ends with logout, which needs the session’s token', async () => {
    const { request, logIn, post, jar } = site();
    await logIn();
    expect(
      (
        await request('/auth/logout', {
          method: 'POST',
          headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'x=1',
        })
      ).status,
    ).toBe(403);
    expect(jar.has('ligo_session')).toBe(true);
    const out = await post('/auth/logout', {});
    expect(out.status).toBe(303);
    expect(jar.has('ligo_session')).toBe(false);
  });

  it('sends every address to PUBLIC_URL, so cookies and origins match', async () => {
    const { request } = site();
    const moved = await request('http://127.0.0.1:3000/mbl-group/lfr/saison-3?x=1');
    expect(moved.status).toBe(308);
    expect(moved.headers.get('location')).toBe(`${ORIGIN}/mbl-group/lfr/saison-3?x=1`);
    const posted = await request('http://127.0.0.1:3000/me/consent', { method: 'POST' });
    expect(posted.status).toBe(403);
  });

  it('sends a content security policy that allows this site’s scripts only', async () => {
    const policy = (await site().request('/')).headers.get('content-security-policy');
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
  });
});

describe('/me', () => {
  it('asks a visitor to log in first', async () => {
    const response = await site().request('/me');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/auth/login?next=/me');
  });

  it('shows the account, and league staff from the Discord role', async () => {
    const { request, logIn, setRoles } = site();
    await logIn();
    const page = await (await request('/me')).text();
    expect(page).toContain('Connecté avec le compte Discord Ana.');
    expect(page).not.toContain('Staff de la ligue');
    setRoles([TEST_STAFF_ROLE]);
    expect(await (await request('/me')).text()).toContain('Staff de la ligue : LFR');
  });

  it('stores the nationality and the stats consent', async () => {
    const { db, request, logIn, post } = site();
    await logIn();
    const saved = await post('/me/nationality', { nationality: 'BE' });
    expect(saved.status).toBe(303);
    expect(saved.headers.get('location')).toBe('/me?saved=1');
    expect(await (await request('/me?saved=1')).text()).toMatch(
      /<option\s+value="BE"\s+selected\s*>/,
    );
    expect((await post('/me/nationality', { nationality: 'XX' })).headers.get('location')).toBe(
      '/me?error=invalid_nationality',
    );
    await post('/me/consent', { consent: 'give' });
    const player = () =>
      db.select().from(schema.player).where(eq(schema.player.discordUserId, ANA.id)).get();
    expect(player()?.statsConsentAt).toBe(NOW);
    expect(await (await request('/me')).text()).toContain('Retirer mon accord');
    await post('/me/consent', { consent: 'withdraw' });
    expect(player()?.statsConsentAt).toBeNull();
  });

  it('stores the birth date, shown to the player only', async () => {
    const { request, logIn, post } = site();
    await logIn();
    const saved = await post('/me/birth-date', { birth_date: '2008-02-29' });
    expect(saved.headers.get('location')).toBe('/me?saved=1');
    const page = await (await request('/me')).text();
    expect(page).toMatch(
      /<input\s+id="birth_date"\s+name="birth_date"\s+type="date"\s+value="2008-02-29"/,
    );
    expect(
      (await post('/me/birth-date', { birth_date: '2008-02-30' })).headers.get('location'),
    ).toBe('/me?error=invalid_birth_date');
    expect(await (await request('/me?error=invalid_birth_date')).text()).toContain(
      'Cette date de naissance n’est pas valable.',
    );
  });

  it('refuses a form from another site, without an origin, or without the token', async () => {
    const { db, request, logIn, post } = site();
    await logIn();
    const nationality = () =>
      db.select().from(schema.player).where(eq(schema.player.discordUserId, ANA.id)).get()
        ?.nationality;
    expect(
      (await post('/me/nationality', { nationality: 'BE' }, { Origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
    const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
    expect(
      (await request('/me/nationality', { method: 'POST', headers: form, body: 'nationality=BE' }))
        .status,
    ).toBe(403);
    expect(
      (
        await request('/me/nationality', {
          method: 'POST',
          headers: { ...form, Origin: ORIGIN },
          body: 'nationality=BE&_csrf=guess',
        })
      ).status,
    ).toBe(403);
    expect(nationality()).toBeNull();
  });

  it('refuses a form from a visitor who is not logged in', async () => {
    const { request } = site();
    const response = await request('/me/consent', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'consent=give',
    });
    expect(response.status).toBe(403);
  });
});

describe('without login settings', () => {
  it('shows no login link and answers 404 for the login pages', async () => {
    const db = leagueDatabase();
    const app = createWebApp({
      db,
      assets: fakeAssetStore(),
      evidence: fakeEvidenceStore(),
      locale: 'fr',
      files: { css: '', htmx: '', colors: '', statPaste: '' },
      logger: { error: vi.fn() },
      login: null,
      roles: () => Promise.resolve([]),
      gateway: fakeGateway(),
      botInstallUrl: null,
      now: () => NOW,
    });
    expect(await (await app.request('/')).text()).not.toContain('/auth/login');
    for (const path of ['/auth/login', '/auth/callback', '/me']) {
      expect((await app.request(path)).status).toBe(404);
    }
  });
});
