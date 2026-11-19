import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { TEST_STAFF_ROLE } from '../testing.ts';
import { testSite } from './testing.ts';

// The rulebook on the website (design doc section 7): public, with its history; the league's
// staff publish a version from it, checked against Discord on every request.

const LEA = { id: '222222222222222222', displayName: 'Léa Staff' };
const RULES = [
  '# Règlement',
  '',
  '## 6.1 Points',
  '',
  'Trois points par victoire. <script>alert(1)</script>',
].join('\r\n');

function rulesSite() {
  const site = testSite({ users: { 'code-lea': LEA } });
  site.setRoles([TEST_STAFF_ROLE], LEA.id);
  const publish = (fields: Record<string, string> = {}) =>
    site.post('/mlb-group/lfr/rules', {
      version: 'Saison 3',
      effective_on: '2027-01-01',
      voted_on: '',
      markdown: RULES,
      ...fields,
    });
  return { ...site, publish };
}

describe('the rulebook page', () => {
  it('says so when no version is in force, and links from the season page', async () => {
    const site = rulesSite();
    const page = await site.request('/mlb-group/lfr/rules');
    expect(page.status).toBe(200);
    const text = await page.text();
    expect(text).toContain('<h1>Règlement — LFR</h1>');
    expect(text).toContain('Aucun règlement n’est en vigueur pour le moment.');
    expect(text).not.toContain('Publier une nouvelle version');
    expect(await (await site.request('/mlb-group/lfr/saison-3')).text()).toContain(
      '<a href="/mlb-group/lfr/rules">Règlement</a>',
    );
  });

  it('lets staff publish a version, shown to everyone with raw HTML as text', async () => {
    const site = rulesSite();
    await site.logIn('/mlb-group/lfr/rules', 'code-lea');
    expect(await (await site.request('/mlb-group/lfr/rules')).text()).toContain(
      '<a href="/mlb-group/lfr/rules/new">Publier une nouvelle version</a>',
    );
    const form = await (await site.request('/mlb-group/lfr/rules/new')).text();
    expect(form).toContain('name="_csrf"');
    // Today in Paris, as the default date.
    expect(form).toContain('value="2027-01-15"');

    const published = await site.publish();
    expect(published.status).toBe(303);
    expect(published.headers.get('location')).toBe('/mlb-group/lfr/rules/1');
    // Stored with Unix line breaks, whatever the browser sent.
    expect(site.db.select().from(schema.rulesVersion).get()?.markdown).toBe(
      RULES.replaceAll('\r\n', '\n'),
    );

    site.jar.clear();
    const text = await (await site.request('/mlb-group/lfr/rules')).text();
    expect(text.replace(/\s+/g, ' ')).toContain(
      'Version « Saison 3 » · en vigueur depuis le 1 janvier 2027',
    );
    expect(text).toContain('<h2 id="6-1-points">6.1 Points</h2>');
    expect(text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(text).not.toContain('<script>alert(1)');
    expect(text).not.toContain('Publier une nouvelle version');
  });

  it('starts a new version from the one in force, and shows an old one as such', async () => {
    const site = rulesSite();
    await site.logIn('/mlb-group/lfr/rules', 'code-lea');
    await site.publish();
    expect(await (await site.request('/mlb-group/lfr/rules/new')).text()).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;</textarea>',
    );
    await site.publish({ version: 'Saison 3, v2', effective_on: '2027-01-10', markdown: 'v2' });

    const current = await (await site.request('/mlb-group/lfr/rules')).text();
    expect(current).toContain('Version « Saison 3, v2 »');
    expect(current).toContain('<a href="/mlb-group/lfr/rules/1">Saison 3</a>');
    const old = await (await site.request('/mlb-group/lfr/rules/1')).text();
    expect(old).toContain('Ancienne version, qui n’est plus en vigueur.');
    expect(old).toContain('<a href="/mlb-group/lfr/rules">Voir la version en vigueur</a>');
  });

  it('shows the form again with the error and what was typed', async () => {
    const site = rulesSite();
    await site.logIn('/mlb-group/lfr/rules', 'code-lea');
    await site.publish();
    const again = await site.publish({ markdown: 'Texte <b>gardé</b>' });
    expect(again.status).toBe(400);
    const text = await again.text();
    expect(text).toContain('Une version porte déjà ce nom. Choisis-en un autre.');
    expect(text).toContain('Texte &lt;b&gt;gardé&lt;/b&gt;</textarea>');
    expect(site.db.select().from(schema.rulesVersion).all()).toHaveLength(1);
  });

  it('refuses anyone but the league’s staff, re-checked in Discord at each request', async () => {
    const site = rulesSite();
    // Not logged in: the form sends to the login.
    const anonymous = await site.request('/mlb-group/lfr/rules/new');
    expect(anonymous.status).toBe(303);
    expect(anonymous.headers.get('location')).toBe(
      '/auth/login?next=%2Fmlb-group%2Flfr%2Frules%2Fnew',
    );

    await site.logIn('/mlb-group/lfr/rules');
    expect((await site.request('/mlb-group/lfr/rules/new')).status).toBe(403);
    expect((await site.publish()).status).toBe(403);

    // Léa, staff, loses the role in Discord: refused at once (the test reader keeps nothing).
    site.jar.clear();
    await site.logIn('/mlb-group/lfr/rules', 'code-lea');
    site.setRoles([], LEA.id);
    expect((await site.publish()).status).toBe(403);
    expect(site.db.select().from(schema.rulesVersion).all()).toEqual([]);
  });

  it('refuses a form without the session’s token', async () => {
    const site = rulesSite();
    await site.logIn('/mlb-group/lfr/rules', 'code-lea');
    const response = await site.request('/mlb-group/lfr/rules', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ version: 'X', effective_on: '2027-01-01', markdown: 'x' }),
    });
    expect(response.status).toBe(403);
  });

  it.each([
    '/mlb-group/lfr/rules/99',
    '/mlb-group/lfr/rules/abc',
    '/c/nope/rules',
    '/c/nope/rules/new',
  ])('answers 404 for %s', async (path) => {
    const site = rulesSite();
    await site.logIn('/mlb-group/lfr/rules', 'code-lea');
    expect((await site.request(path)).status).toBe(404);
  });
});
