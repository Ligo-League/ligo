import { schema, type Db } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { vi } from 'vitest';
import { fakeEvidenceStore } from '../assets/evidence-store.ts';
import { fakeAssetStore } from '../assets/store.ts';
import { fakeGateway } from '../discord/testing.ts';
import { leagueDatabase } from '../testing.ts';
import { createWebApp } from './app.ts';
import { fakeDiscordOAuth, type DiscordUser } from './oauth.ts';

// The website with login on, and a browser that keeps its cookies: for tests through HTTP.

export const TEST_ORIGIN = 'http://localhost:3000';
export const ANA = { id: '700000000000000001', displayName: 'Ana' };
export const TEST_NOW = 1_800_000_000_000;

/**
 * Season 4 starting in June 2027, after the test clock (15 January 2027): its lineups are open,
 * as they are while teams register. The seed's placeholder start, 4 January, would lock them.
 */
export function openLineups(db: Db): Db {
  db.update(schema.season)
    .set({ startsOn: '2027-06-07', endsOn: '2027-08-15' })
    .where(eq(schema.season.name, 'Saison 4'))
    .run();
  return db;
}

/**
 * `users` maps an OAuth code to the Discord user Discord would answer for it; `code-ana` logs
 * in as Ana. Roles are each user's roles in every server, set with `setRoles`.
 */
export function testSite(options: { db?: Db; users?: Record<string, DiscordUser> } = {}) {
  const db = options.db ?? leagueDatabase();
  const oauth = fakeDiscordOAuth({ 'code-ana': ANA, ...options.users });
  const gateway = fakeGateway();
  const evidence = fakeEvidenceStore();
  const logger = { error: vi.fn() };
  let now = TEST_NOW;
  const roles = new Map<string, string[]>();
  const app = createWebApp({
    db,
    assets: fakeAssetStore(),
    evidence,
    locale: 'fr',
    files: { css: '', htmx: '', colors: '' },
    logger,
    login: { oauth, secret: 'x'.repeat(40), publicUrl: new URL(TEST_ORIGIN) },
    roles: (_guildId, userId) => Promise.resolve(roles.get(userId) ?? []),
    gateway,
    botInstallUrl: 'https://discord.com/oauth2/authorize?client_id=1',
    now: () => now,
  });
  // A browser: keeps the cookies the site sets, sends them back.
  const jar = new Map<string, string>();
  const request = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (jar.size > 0) {
      headers.set('Cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    const response = await app.request(path.startsWith('http') ? path : TEST_ORIGIN + path, {
      ...init,
      headers,
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = ''] = cookie.split(';');
      const [name = '', value = ''] = pair.split('=');
      if (value === '' || /Max-Age=0/i.test(cookie)) jar.delete(name);
      else jar.set(name, pair.slice(name.length + 1));
    }
    return response;
  };
  const logIn = async (next = '/me', code = 'code-ana') => {
    await request(`/auth/login?next=${encodeURIComponent(next)}`);
    const state = oauth.states.at(-1) ?? '';
    return request(`/auth/callback?code=${code}&state=${encodeURIComponent(state)}`);
  };
  /** A form posted from a page of this site, with the session's token unless given another. */
  const post = async (
    path: string,
    fields: Record<string, string>,
    extra: Record<string, string> = {},
  ) => {
    const page = await (await request('/me')).text();
    const token = /name="_csrf" value="([^"]+)"/.exec(page)?.[1] ?? '';
    return request(path, {
      method: 'POST',
      headers: {
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...extra,
      },
      body: new URLSearchParams({ _csrf: token, ...fields }),
    });
  };
  /** A form with files (`multipart/form-data`), posted as `post` does. */
  const postFile = async (
    path: string,
    fields: Record<string, string>,
    files: Record<string, File>,
  ) => {
    const page = await (await request('/me')).text();
    const body = new FormData();
    body.set('_csrf', /name="_csrf" value="([^"]+)"/.exec(page)?.[1] ?? '');
    for (const [name, value] of Object.entries(fields)) body.set(name, value);
    for (const [name, file] of Object.entries(files)) body.set(name, file);
    return request(path, { method: 'POST', headers: { Origin: TEST_ORIGIN }, body });
  };
  const advance = (ms: number) => {
    now += ms;
  };
  const setRoles = (value: string[], userId = ANA.id) => {
    roles.set(userId, value);
  };
  return {
    db,
    oauth,
    gateway,
    evidence,
    logger,
    jar,
    request,
    logIn,
    post,
    postFile,
    advance,
    setRoles,
  };
}
