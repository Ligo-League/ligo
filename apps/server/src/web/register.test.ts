import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { pngForTests } from '../services/logo.ts';
import { leagueDatabase, registrationDatabase } from '../testing.ts';
import { TEST_ORIGIN, testSite } from './testing.ts';

// Registration on the website (design doc section 7; maintainer, 14 November 2026): a member
// files the club and roster, then shares the invitation link; each player keeps their own R6
// account on `/me`.

const BEN = { id: '700000000000000002', displayName: 'Ben' };
const LOGO = pngForTests({ width: 512, height: 512, colorType: 6 });

function site(db = registrationDatabase()) {
  const browser = testSite({ db, users: { 'code-ben': BEN } });
  /** The registration form sent as a browser does, as multipart with the session's token. */
  const register = async (fields: Record<string, string> = {}, logo: Uint8Array | null = LOGO) => {
    const page = await (await browser.request('/me')).text();
    const body = new FormData();
    const values: Record<string, string> = {
      _csrf: /name="_csrf" value="([^"]+)"/.exec(page)?.[1] ?? '',
      club_kind: 'new',
      club_name: 'Kairos Esport',
      club_city: 'Lyon',
      club_legal_status: 'association_1901',
      club_socials: 'https://x.com/kairos',
      club_discord: '',
      roster_name: 'Kairos',
      roster_tag: 'krs',
      color_1: '#112233',
      color_2: '#ffffff',
      rules_version: '1',
      rules_accepted: '1',
      ...fields,
    };
    for (const [key, value] of Object.entries(values)) body.set(key, value);
    if (logo) body.set('logo', new Blob([new Uint8Array(logo)], { type: 'image/png' }), 'logo.png');
    return browser.request('/c/lfr/register', {
      method: 'POST',
      headers: { Origin: TEST_ORIGIN },
      body,
    });
  };
  return { ...browser, register };
}

describe('the registration form', () => {
  it('is offered on the home page while a season takes registrations', async () => {
    const text = await (await site().request('/')).text();
    expect(text).toMatch(/<a href="\/c\/lfr\/register"\s*>S’inscrire<\/a\s*>/);
    const closed = await (await site(leagueDatabase()).request('/')).text();
    expect(closed).not.toContain('/c/lfr/register');
  });

  it('asks to log in first, then shows the form with the rulebook to accept', async () => {
    const browser = site();
    const anonymous = await browser.request('/c/lfr/register');
    expect(anonymous.status).toBe(303);
    expect(anonymous.headers.get('location')).toBe('/auth/login?next=%2Fc%2Flfr%2Fregister');
    await browser.logIn('/c/lfr/register');
    const text = await (await browser.request('/c/lfr/register')).text();
    expect(text).toContain('<h1>Inscription — LFR, Saison 4</h1>');
    expect(text).toContain('enctype="multipart/form-data"');
    expect(text).toContain('name="rules_version" value="1"');
    expect(text).toContain('J’ai lu et j’approuve le règlement, version « Saison 4 ».');
  });

  it('files the registration, then shows its invitation link to the filer only', async () => {
    const browser = site();
    await browser.logIn('/c/lfr/register');
    const sent = await browser.register();
    expect(sent.status).toBe(303);
    expect(sent.headers.get('location')).toBe('/registrations/1');

    const status = await browser.request('/registrations/1');
    expect(status.headers.get('cache-control')).toBe('no-store');
    const text = await status.text();
    expect(text).toContain('<h1>Inscription — Kairos</h1>');
    expect(text).toMatch(/value="http:\/\/localhost:3000\/join\/1\/[\w-]{43}"/);
    expect(text).toContain('Aucun joueur n’a encore rejoint.');
    expect(browser.db.select().from(schema.request).get()?.kind).toBe('registration');

    // Another member finds nothing there.
    browser.jar.clear();
    await browser.logIn('/me', 'code-ben');
    expect((await browser.request('/registrations/1')).status).toBe(404);
    expect((await browser.request('/registrations/abc')).status).toBe(404);
  });

  it('shows the form again with each problem under its field, and what was typed', async () => {
    const browser = site();
    await browser.logIn('/c/lfr/register');
    const refused = await browser.register(
      { roster_name: '<b>Bravo</b>', roster_tag: 'BRV', rules_accepted: '' },
      pngForTests({ width: 512, height: 512, colorType: 2 }),
    );
    expect(refused.status).toBe(400);
    const text = await refused.text();
    expect(text).toContain('Ce tag est déjà pris, par une équipe ou une inscription en attente.');
    expect(text).toContain('Le logo n’a pas de fond transparent.');
    expect(text).toContain('Il faut accepter le règlement pour s’inscrire.');
    expect(text).toContain('value="&lt;b&gt;Bravo&lt;/b&gt;"');
    expect(browser.db.select().from(schema.request).all()).toEqual([]);
  });

  it('offers colour pickers only: two shown, three more to add', async () => {
    const browser = site();
    await browser.logIn('/c/lfr/register');
    const text = await (await browser.request('/c/lfr/register')).text();
    expect(text.match(/type="color"/g)).toHaveLength(5);
    expect(text).not.toContain('#RRGGBB');
    for (const n of [3, 4, 5]) {
      expect(text).toMatch(
        new RegExp(
          `<span class="color" data-extra-color hidden\\s*><input\\s+name="color_${n}"[^>]*disabled`,
        ),
      );
    }
    expect(text).toContain('<button type="button" data-add-color hidden>');
    expect(text).toContain('<script src="/static/colors.js" defer></script>');
    const script = await browser.request('/static/colors.js');
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
  });

  it('files up to five colours, and shows the extra ones again after a refusal', async () => {
    const browser = site();
    await browser.logIn('/c/lfr/register');
    const refused = await browser.register({
      roster_tag: 'BRV',
      color_3: '#aa0000',
      color_4: '#00aa00',
    });
    expect(refused.status).toBe(400);
    const text = await refused.text();
    expect(text).toMatch(
      /<span class="color" data-extra-color\s*><input\s+name="color_4"\s+type="color"\s+value="#00aa00"/,
    );
    expect(text).toMatch(/data-extra-color hidden\s*><input\s+name="color_5"/);

    expect((await browser.register({ color_3: '#aa0000', color_5: '#00aa00' })).status).toBe(303);
    expect(browser.db.select().from(schema.request).get()?.payloadJson).toMatchObject({
      roster: { colors: ['#112233', '#FFFFFF', '#AA0000', '#00AA00'] },
    });
  });

  it('refuses a form larger than the logo allows before reading it', async () => {
    const browser = site();
    await browser.logIn('/c/lfr/register');
    const huge = new Uint8Array(2 * 1024 * 1024);
    huge.set(LOGO);
    const refused = await browser.register({}, huge);
    expect(refused.status).toBe(413);
    expect(await refused.text()).toContain('Fichier trop lourd');
  });

  it('refuses a form without the session’s token', async () => {
    const browser = site();
    await browser.logIn('/c/lfr/register');
    expect((await browser.register({ _csrf: 'forged' })).status).toBe(403);
  });

  it('says when registration is closed', async () => {
    const browser = site(leagueDatabase());
    await browser.logIn('/c/lfr/register');
    const text = await (await browser.request('/c/lfr/register')).text();
    expect(text).toContain('Inscriptions fermées');
    expect((await browser.request('/c/nope/register')).status).toBe(404);
  });
});

describe('the R6 account on /me', () => {
  it('is saved by the player, and shown filled', async () => {
    const browser = site();
    await browser.logIn('/me');
    const saved = await browser.post('/me/game-profile', {
      ubisoft_name: 'Nivalem',
      profile_id: '',
      rank: 'diamond',
    });
    expect(saved.status).toBe(303);
    const text = await (await browser.request('/me')).text();
    expect(text).toContain('value="Nivalem"');
    expect(text).toMatch(/<option value="diamond"\s+selected/);
  });

  it('shows each problem under its field, with what was typed', async () => {
    const browser = site();
    await browser.logIn('/me');
    const refused = await browser.post('/me/game-profile', {
      ubisoft_name: 'a b',
      profile_id: '123',
      rank: 'wood',
    });
    expect(refused.status).toBe(400);
    const text = await refused.text();
    expect(text).toContain('Le nom Ubisoft fait de 3 à 20 lettres');
    expect(text).toContain('Le profileID a la forme');
    expect(text).toContain('value="a b"');
  });
});
