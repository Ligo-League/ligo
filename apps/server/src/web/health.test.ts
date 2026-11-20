import { describe, expect, it } from 'vitest';
import { testSite } from './testing.ts';

// The VPS (design doc section 13): Caddy serves https://ligoleague.eu and forwards plain http to
// the server, with the original scheme in X-Forwarded-Proto. The server reads it only when
// TRUST_PROXY is set; otherwise its one-address rule would send https://ligoleague.eu to itself
// for ever. /healthz answers Docker's health check, made from inside the container.

const PUBLIC = 'https://ligoleague.eu';
const BEHIND_CADDY = 'http://ligoleague.eu/mlb-group/lfr/saison-3';

describe('behind a reverse proxy', () => {
  it('takes the scheme Caddy forwards when the proxy is trusted', async () => {
    const { request } = testSite({ publicUrl: PUBLIC, trustProxy: true });
    const page = await request(BEHIND_CADDY, { headers: { 'X-Forwarded-Proto': 'https' } });
    expect(page.status).toBe(200);
    // Reached without Caddy (plain http): sent to the public address, as before.
    const direct = await request(BEHIND_CADDY);
    expect(direct.status).toBe(308);
    expect(direct.headers.get('location')).toBe(`${PUBLIC}/mlb-group/lfr/saison-3`);
  });

  it('ignores the forwarded scheme when the proxy is not trusted', async () => {
    const { request } = testSite({ publicUrl: PUBLIC });
    const page = await request(BEHIND_CADDY, { headers: { 'X-Forwarded-Proto': 'https' } });
    // The loop TRUST_PROXY prevents: https://ligoleague.eu sent to https://ligoleague.eu.
    expect(page.status).toBe(308);
    expect(page.headers.get('location')).toBe(`${PUBLIC}/mlb-group/lfr/saison-3`);
  });

  it('refuses a forwarded scheme that is neither http nor https', async () => {
    const { request } = testSite({ publicUrl: PUBLIC, trustProxy: true });
    const page = await request(BEHIND_CADDY, { headers: { 'X-Forwarded-Proto': 'javascript' } });
    expect(page.status).toBe(308);
  });
});

describe('/healthz', () => {
  it('answers on any address, logged out, with the database and Discord both up', async () => {
    const { request } = testSite({ publicUrl: PUBLIC, trustProxy: true });
    const health = await request('http://127.0.0.1:3000/healthz');
    expect(health.status).toBe(200);
    expect(health.headers.get('cache-control')).toBe('no-store');
    expect(await health.json()).toEqual({ status: 'ok', database: true, discord: true });
  });

  it('says unavailable while the bot is not connected to Discord', async () => {
    const { request } = testSite({ discordReady: () => false });
    const health = await request('/healthz');
    expect(health.status).toBe(503);
    expect(await health.json()).toEqual({ status: 'unavailable', database: true, discord: false });
  });

  it('says unavailable when the database cannot be read', async () => {
    const { request, db } = testSite();
    db.$client.close();
    const health = await request('/healthz');
    expect(health.status).toBe(503);
    expect(await health.json()).toEqual({ status: 'unavailable', database: false, discord: true });
  });
});
