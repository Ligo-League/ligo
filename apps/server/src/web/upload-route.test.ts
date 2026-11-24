import { describe, expect, it, vi } from 'vitest';
import { fakeObjectStore, readUploadToken, signUploadToken } from '@ligo/storage';
import { uploadRoute } from './upload-route.ts';

// Without R2 (local development), the browser uploads to the server's own route with a token the
// server signed (design doc section 8, upload flow 5): one key, one size, one type, a few
// minutes. The token is the only permission: it was issued after the server checked the user.

const SECRET = 's'.repeat(32);
const KEY = 'replays/4/abc.rec';
const TYPE = 'application/octet-stream';
const grant = { key: KEY, size: 3, contentType: TYPE, expiresAt: 60_000 };

function setup(now = 1_000) {
  const store = fakeObjectStore();
  const logger = { error: vi.fn() };
  const app = uploadRoute({ secret: SECRET, store, now: () => now, logger });
  const put = (token: string, body: Uint8Array, headers: Record<string, string> = {}) =>
    app.request(`/storage/upload/${token}`, {
      method: 'PUT',
      body,
      headers: { 'content-type': TYPE, 'content-length': String(body.length), ...headers },
    });
  return { store, logger, put };
}

describe('upload tokens', () => {
  it('read back what was signed, until they expire', () => {
    const token = signUploadToken(SECRET, grant);
    expect(readUploadToken(SECRET, token, 59_999)).toEqual(grant);
    expect(readUploadToken(SECRET, token, 60_000)).toBeNull();
  });

  it('refuse a token changed, or signed with another secret', () => {
    const token = signUploadToken(SECRET, grant);
    const [payload = '', signature = ''] = token.split('.');
    const bigger = Buffer.from(JSON.stringify({ ...grant, size: 999 })).toString('base64url');
    expect(readUploadToken(SECRET, `${bigger}.${signature}`, 0)).toBeNull();
    expect(readUploadToken('t'.repeat(32), token, 0)).toBeNull();
    expect(readUploadToken(SECRET, payload, 0)).toBeNull();
    expect(readUploadToken(SECRET, 'not a token', 0)).toBeNull();
  });
});

describe('PUT /storage/upload/:token', () => {
  it('stores exactly the bytes granted, under the granted key', async () => {
    const { store, put } = setup();
    const response = await put(signUploadToken(SECRET, grant), new Uint8Array([1, 2, 3]));
    expect(response.status).toBe(200);
    expect(store.objects.get(KEY)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it.each([
    ['an expired token', 120_000, new Uint8Array([1, 2, 3]), {}, 403],
    ['another size', 1_000, new Uint8Array([1, 2, 3, 4]), {}, 400],
    ['another type', 1_000, new Uint8Array([1, 2, 3]), { 'content-type': 'image/png' }, 400],
  ])('refuses %s and stores nothing', async (_label, now, body, headers, status) => {
    const { store, put } = setup(now);
    const response = await put(signUploadToken(SECRET, grant), body, headers);
    expect(response.status).toBe(status);
    expect(store.objects.size).toBe(0);
  });

  it('refuses a forged token', async () => {
    const { store, put } = setup();
    const response = await put(signUploadToken('t'.repeat(32), grant), new Uint8Array([1, 2, 3]));
    expect(response.status).toBe(403);
    expect(store.objects.size).toBe(0);
  });

  it('logs a failed write by key, never the token', async () => {
    const { store, logger, put } = setup();
    store.failing = true;
    const token = signUploadToken(SECRET, grant);
    expect((await put(token, new Uint8Array([1, 2, 3]))).status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith({ key: KEY }, 'An upload could not be stored');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(token);
  });
});
