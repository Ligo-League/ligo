import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { fakeEvidenceStore } from '../assets/evidence-store.ts';
import { fakeAssetStore, PNG_HEADER_FOR_TESTS } from '../assets/store.ts';
import { fakeGateway } from '../discord/testing.ts';
import { setTeamOwner } from '../services/team-staff.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { createWebApp, loadStaticFiles, type WebDeps } from './app.ts';

// The public pages through HTTP, against the league of leagueDatabase(): LFR's Saison 3, with
// Alpha Esport, Bravo and Charlie in Ligue 1, Xray and Yankee in Ligue 2.

const FILES = { css: 'body {}', htmx: '/* htmx */' };

function site(overrides: Partial<WebDeps> = {}) {
  const db = leagueDatabase();
  const logger = { error: vi.fn() };
  const app = createWebApp({
    db,
    assets: fakeAssetStore(),
    evidence: fakeEvidenceStore(),
    locale: 'fr',
    files: FILES,
    logger,
    login: null,
    roles: () => Promise.resolve([]),
    gateway: fakeGateway(),
    now: () => 1_800_000_000_000,
    ...overrides,
  });
  const get = async (path: string) => {
    const response = await app.request(path);
    return { status: response.status, headers: response.headers, text: await response.text() };
  };
  return { db, app, get, logger };
}

describe('the home page', () => {
  it('lists the leagues and links each season', async () => {
    const { get } = site();
    const page = await get('/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.text).toContain('<html lang="fr">');
    expect(page.text).toContain('<h2>LFR</h2>');
    expect(page.text).toContain('<a href="/c/lfr/saison-3">Saison 3</a>');
    expect(page.text).toContain('En cours');
  });

  it('sends the headers that keep it out of frames and type sniffing', async () => {
    const { headers } = await site().get('/');
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('a season page', () => {
  it('shows the standings of each division, the latest results and the fixtures', async () => {
    const { text, status } = await site().get('/c/lfr/saison-3');
    expect(status).toBe(200);
    expect(text).toContain('<title>LFR — Saison 3 · Ligo</title>');
    expect(text).toContain('<h3>Ligue 1</h3>');
    expect(text).toContain('<h3>Ligue 2</h3>');
    // Alpha first with 6 points, then Charlie and Bravo.
    expect(text.indexOf('Alpha Esport')).toBeLessThan(text.indexOf('Charlie'));
    expect(text).toContain('<span class="score">7 – 4</span>');
    expect(text).toContain('Forfait de Charlie');
    expect(text).toContain('Semaine 3');
    expect(text).toContain('Horaire à fixer');
    expect(text).toContain('<a href="/teams/bravo">Bravo</a>');
    expect(text).toContain('<a class="muted" href="/matches/3">contre</a>');
  });

  it('answers 404 for an unknown competition or season', async () => {
    const { get } = site();
    for (const path of ['/c/lfv/saison-3', '/c/lfr/saison-9']) {
      const page = await get(path);
      expect(page.status).toBe(404);
      expect(page.text).toContain('Page introuvable');
    }
  });
});

describe('a team page', () => {
  it('shows the team, its officials and its matches', async () => {
    const { db, get } = site();
    const staff = {
      guildId: TEST_GUILD,
      user: { id: '222222222222222222', displayName: 'Léa Staff' },
      memberRoleIds: [TEST_STAFF_ROLE],
    };
    setTeamOwner(
      db,
      staff,
      { teamId: 1, member: { id: '700000000000000001', displayName: 'Ana' } },
      1,
    );
    const { text, status } = await get('/teams/alpha-esport');
    expect(status).toBe(200);
    expect(text).toContain('Alpha Esport <span class="muted">(ALP)</span>');
    expect(text).toContain('Ana');
    expect(text).toContain('Propriétaire');
    expect(text).toMatch(/<a href="\/c\/lfr\/saison-3"\s*>LFR · Saison 3 · Ligue 1<\/a/);
    expect(text).toContain('7 – 4');
    // No Discord ID on a public page.
    expect(text).not.toContain('700000000000000001');
  });

  it('answers 404 for an unknown team', async () => {
    expect((await site().get('/teams/zulu')).status).toBe(404);
  });

  it('escapes every value from the database', async () => {
    const { db, get } = site();
    db.update(schema.team)
      .set({ name: '<script>alert(1)</script>' })
      .where(eq(schema.team.id, 1))
      .run();
    for (const path of ['/teams/alpha-esport', '/c/lfr/saison-3', '/matches/1']) {
      const { text } = await get(path);
      expect(text).not.toContain('<script>alert(1)</script>');
      expect(text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    }
  });
});

describe('a match page', () => {
  it('shows the result, the map and the bans', async () => {
    const { db, get } = site();
    db.update(schema.game)
      .set({ map: 'Villa', bansJson: [{ side: 'a', map: 'Bank' }] })
      .where(eq(schema.game.matchId, 1))
      .run();
    const { text, status } = await get('/matches/1');
    expect(status).toBe(200);
    expect(text).toContain('LFR · Saison 3 · Ligue 1 · semaine 1');
    expect(text).toContain('Carte 1 : Villa');
    expect(text).toContain('Bannies : Bank (Alpha Esport)');
  });

  it('answers 404 for an unknown or malformed match ID', async () => {
    const { get } = site();
    for (const path of ['/matches/999', '/matches/abc', '/matches/0', '/matches/1e3']) {
      expect((await get(path)).status).toBe(404);
    }
  });
});

describe('files', () => {
  it('serves the stylesheet and htmx', async () => {
    const { get } = site();
    const css = await get('/static/site.css');
    expect(css.headers.get('content-type')).toContain('text/css');
    expect(css.text).toBe(FILES.css);
    expect((await get('/static/htmx.min.js')).headers.get('content-type')).toContain(
      'text/javascript',
    );
  });

  it('serves a prepared logo, and nothing else from the asset folder', async () => {
    const { get } = site({
      assets: fakeAssetStore({
        'logos/alp.png': PNG_HEADER_FOR_TESTS,
        'secret.png': PNG_HEADER_FOR_TESTS,
      }),
    });
    const logo = await get('/logos/alp.png');
    expect(logo.status).toBe(200);
    expect(logo.headers.get('content-type')).toBe('image/png');
    for (const path of [
      '/logos/bravo.png',
      '/logos/ALP.png',
      '/logos/..%2Fsecret.png',
      '/logos/alp.gif',
    ]) {
      expect((await get(path)).status).toBe(404);
    }
  });

  it('reads the real stylesheet and the pinned htmx', async () => {
    const files = await loadStaticFiles();
    expect(files.css).toContain(':root');
    expect(files.htmx).toContain('htmx');
  });
});

describe('errors', () => {
  it('answers 404 for an unknown path, and a page that says nothing of a failure', async () => {
    const { get, logger, db } = site();
    expect((await get('/nowhere')).status).toBe(404);
    // A database fault while rendering a page.
    db.$client.close();
    const failed = await get('/');
    expect(failed.status).toBe(500);
    expect(failed.text).toContain('Le site a rencontré un problème');
    expect(failed.text).not.toContain('database');
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
