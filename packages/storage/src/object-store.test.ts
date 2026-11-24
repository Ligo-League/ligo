import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createDiskObjectStore,
  fakeObjectStore,
  withReadFallback,
  type ObjectStore,
} from './object-store.ts';
import { readUploadToken } from './upload-token.ts';

// Where files live (design doc section 13): R2 in production, a folder on disk without R2
// settings, memory in tests. Every store refuses a key that could climb out of its place.

const KEY = `evidence/3/${'a'.repeat(64)}.png`;
const SECRET = 's'.repeat(32);
const disk = () => {
  const root = mkdtempSync(join(tmpdir(), 'ligo-objects-'));
  const store = createDiskObjectStore(root, {
    upload: { secret: SECRET, publicUrl: 'http://localhost:3000' },
    now: () => 1_000,
  });
  return { root, store };
};

describe.each([
  ['disk', () => disk().store],
  ['memory', () => fakeObjectStore()],
])('%s object store', (_name, make: () => ObjectStore) => {
  it('keeps an object, tells its size, reads it back and deletes it', async () => {
    const store = make();
    await store.put(KEY, new Uint8Array([1, 2, 3]), 'image/png');
    expect(await store.size(KEY)).toBe(3);
    expect(await store.get(KEY, 10)).toEqual(new Uint8Array([1, 2, 3]));
    await store.delete(KEY);
    expect(await store.get(KEY, 10)).toBeNull();
    expect(await store.size(KEY)).toBeNull();
    await expect(store.delete(KEY)).resolves.toBeUndefined();
  });

  it('answers null for an object over the size asked for', async () => {
    const store = make();
    await store.put(KEY, new Uint8Array([1, 2, 3]), 'image/png');
    expect(await store.get(KEY, 2)).toBeNull();
  });

  it.each([
    ['a key that climbs out', 'evidence/../../etc/passwd'],
    ['an absolute key', '/etc/passwd'],
    ['an empty part', 'evidence//x.png'],
    ['a hidden file', 'evidence/.x'],
  ])('refuses %s', async (_label, key) => {
    const store = make();
    await expect(store.put(key, new Uint8Array([1]), 'image/png')).rejects.toThrow(
      'Not a storage key',
    );
    expect(await store.get(key, 10)).toBeNull();
  });
});

describe('createDiskObjectStore', () => {
  it('writes through a partial file, so a reader never sees half of one', async () => {
    const { root, store } = disk();
    await store.put(KEY, new Uint8Array([1]), 'image/png');
    expect(readdirSync(join(root, 'evidence', '3'))).toEqual([`${'a'.repeat(64)}.png`]);
  });

  it('signs an upload to the server’s own route, for that key, size and type only', async () => {
    const { store } = disk();
    const signed = await store.signPut('replays/4/x.rec', {
      size: 100,
      contentType: 'application/octet-stream',
      expiresInS: 300,
    });
    expect(signed.method).toBe('PUT');
    expect(signed.expiresAt).toBe(301_000);
    const url = new URL(signed.url);
    expect(url.origin + url.pathname.replace(/[^/]+$/, '')).toBe(
      'http://localhost:3000/storage/upload/',
    );
    const token = url.pathname.split('/').at(-1) ?? '';
    expect(readUploadToken(SECRET, token, 1_000)).toEqual({
      key: 'replays/4/x.rec',
      size: 100,
      contentType: 'application/octet-stream',
      expiresAt: 301_000,
    });
    expect(signed.headers).toEqual({ 'content-type': 'application/octet-stream' });
  });

  it('cannot sign an upload without a secret (no website login)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ligo-objects-'));
    const store = createDiskObjectStore(root, { upload: null, now: () => 0 });
    await expect(
      store.signPut('replays/4/x.rec', { size: 1, contentType: 'x/y', expiresInS: 60 }),
    ).rejects.toThrow('Uploads need SESSION_SECRET');
  });
});

describe('withReadFallback', () => {
  it('reads the old place for what was not copied yet, and writes only the new one', async () => {
    const r2 = fakeObjectStore();
    const old = fakeObjectStore();
    await old.put(KEY, new Uint8Array([9]), 'image/png');
    const store = withReadFallback(r2, old);
    expect(await store.get(KEY, 10)).toEqual(new Uint8Array([9]));
    expect(await store.size(KEY)).toBe(1);

    const other = `evidence/3/${'b'.repeat(64)}.png`;
    await store.put(other, new Uint8Array([1]), 'image/png');
    expect(r2.objects.has(other)).toBe(true);
    expect(old.objects.has(other)).toBe(false);
  });

  it('deletes from both, so a deleted MOSS file is gone everywhere', async () => {
    const r2 = fakeObjectStore();
    const old = fakeObjectStore();
    await r2.put(KEY, new Uint8Array([1]), 'image/png');
    await old.put(KEY, new Uint8Array([1]), 'image/png');
    await withReadFallback(r2, old).delete(KEY);
    expect(r2.objects.has(KEY)).toBe(false);
    expect(old.objects.has(KEY)).toBe(false);
  });
});
