import { listLeagueMatches, schema, type Db } from '@ligo/db';
import { addRosterPlayers } from '@ligo/db/testing';
import { fakeObjectStore } from '@ligo/storage';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, testSite } from './testing.ts';
import type { UploaderFiles } from './uploader-bundle.ts';

// `/matches/:id/replays` (design doc section 8, phase 5-9): the uploader island for a side's
// players and officials and league staff, with the parser build's files.

const R2 = 'https://account.r2.cloudflarestorage.com';
const UPLOADER: UploaderFiles = {
  version: 'r6-0123456789abcdef',
  island: '/* island */',
  worker: '/* worker */',
  wasm: { name: 'r6-0123456789abcdef.wasm', bytes: new Uint8Array([0, 97, 115, 109]) },
};

function scheduledMatchId(db: Db) {
  const row = db.select().from(schema.match).where(eq(schema.match.status, 'scheduled')).get();
  if (!row) throw new Error('no match to play');
  return row.id;
}

async function setup(options: { onSide?: boolean; uploader?: boolean } = {}) {
  const site = testSite({
    replays: { objects: fakeObjectStore(), parserVersion: UPLOADER.version, uploadOrigin: R2 },
    ...(options.uploader === false ? {} : { uploader: UPLOADER }),
  });
  const { db } = site;
  const matchId = scheduledMatchId(db);
  await site.logIn();
  const ana = db.select().from(schema.player).where(eq(schema.player.discordUserId, ANA.id)).get();
  if (!ana) throw new Error('Ana did not log in');
  const [found] = listLeagueMatches(db, { matchId });
  if (!found) throw new Error('no match');
  const accounts = addRosterPlayers(db, found.seasonId, found.a.teamId, 'b');
  if (options.onSide ?? true) {
    db.insert(schema.rosterEntry)
      .values({
        seasonId: found.seasonId,
        teamId: found.a.teamId,
        playerId: ana.id,
        role: 'player',
        validFrom: 0,
      })
      .run();
  }
  return { ...site, matchId, accounts };
}

const configOf = (page: string): Record<string, unknown> => {
  const attribute = /data-config="([^"]+)"/.exec(page)?.[1] ?? 'null';
  return JSON.parse(
    attribute
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&'),
  ) as Record<string, unknown>;
};

describe('/matches/:id/replays', () => {
  it('gives a side’s player the island, with hashed accounts, the parser and the R2 address', async () => {
    const { request, matchId, accounts } = await setup();
    const response = await request(`/matches/${String(matchId)}/replays`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const policy = response.headers.get('content-security-policy') ?? '';
    expect(policy).toContain("'wasm-unsafe-eval'");
    expect(policy).toContain(`connect-src 'self' ${R2}`);
    const page = await response.text();
    expect(page).toContain('<script src="/static/uploader.js" defer></script>');
    const config = configOf(page);
    expect(config).toMatchObject({
      matchId,
      parser: {
        version: UPLOADER.version,
        wasm: `/parsers/${UPLOADER.wasm.name}`,
        worker: '/static/parser-worker.js',
      },
      tradeWindowS: 10,
      minKnown: 3,
    });
    const first = accounts[0] ?? '';
    // Profile IDs never reach the page: their hashes do (M-42).
    expect(page).not.toContain(first);
    expect(config.known).toContainEqual({
      hash: createHash('sha256').update(first).digest('hex'),
      side: 'a',
      name: 'b1',
    });
  });

  it('refuses someone of neither team unless they are staff, and sends a visitor to log in', async () => {
    const { request, matchId, setRoles, jar } = await setup({ onSide: false });
    expect((await request(`/matches/${String(matchId)}/replays`)).status).toBe(403);
    setRoles([TEST_STAFF_ROLE]);
    expect((await request(`/matches/${String(matchId)}/replays`)).status).toBe(200);
    jar.clear();
    const anonymous = await request(`/matches/${String(matchId)}/replays`);
    expect(anonymous.status).toBe(303);
    expect(anonymous.headers.get('location')).toContain('/auth/login');
  });

  it('says uploads are off without a parser build', async () => {
    const { request, matchId } = await setup({ uploader: false });
    const page = await (await request(`/matches/${String(matchId)}/replays`)).text();
    expect(page).not.toContain('data-config');
    expect(page).toContain('pas disponible');
  });

  it('links the match page to it for the teams only', async () => {
    const onSide = await setup();
    const page = await (await onSide.request(`/matches/${String(onSide.matchId)}`)).text();
    expect(page).toContain(`/matches/${String(onSide.matchId)}/replays`);
    const stranger = await setup({ onSide: false });
    const other = await (await stranger.request(`/matches/${String(stranger.matchId)}`)).text();
    expect(other).not.toContain('/replays"');
  });
});

describe('the uploader’s files', () => {
  it('serves the island, the worker under a policy allowing WebAssembly, and the parser by name', async () => {
    const { request } = await setup();
    const island = await request('/static/uploader.js');
    expect(await island.text()).toBe('/* island */');
    const worker = await request('/static/parser-worker.js');
    expect(worker.headers.get('content-security-policy')).toContain("'wasm-unsafe-eval'");
    const wasm = await request(`/parsers/${UPLOADER.wasm.name}`);
    expect(wasm.headers.get('content-type')).toBe('application/wasm');
    expect(wasm.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await wasm.arrayBuffer())).toEqual(UPLOADER.wasm.bytes);
    expect((await request('/parsers/r6-ffffffffffffffff.wasm')).status).toBe(404);
    // Other pages keep the site's policy, without WebAssembly.
    const home = await request('/');
    expect(home.headers.get('content-security-policy')).not.toContain('wasm');
  });
});
