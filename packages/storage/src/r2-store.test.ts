import { describe, expect, it } from 'vitest';
import { createR2ObjectStore, type S3Like } from './r2-store.ts';

// The R2 store (design doc section 13) over a fake S3 client: what it sends, and how it reads
// R2's answers. Signing a URL is local work, so the real presigner runs here, offline.

const SETTINGS = {
  accountId: 'acc0unt',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI-secret-never-in-a-url',
  bucket: 'ligo',
  endpoint: null,
};
const KEY = `evidence/3/${'a'.repeat(64)}.png`;

/** Records each command's name and input; answers from `reply`. */
function client(reply: (name: string, input: Record<string, unknown>) => unknown = () => ({})) {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  const s3: S3Like = {
    send: (command) => {
      const name = command.constructor.name;
      const input = command.input as Record<string, unknown>;
      sent.push({ name, input });
      try {
        return Promise.resolve(reply(name, input));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
  return { sent, s3 };
}
const missing = () => {
  throw Object.assign(new Error('missing'), {
    name: 'NoSuchKey',
    $metadata: { httpStatusCode: 404 },
  });
};
const body = (bytes: number[]) => ({
  ContentLength: bytes.length,
  Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(bytes)) },
});

describe('createR2ObjectStore', () => {
  it('puts an object in the bucket with its type and size', async () => {
    const { sent, s3 } = client();
    const store = createR2ObjectStore(SETTINGS, { client: s3, now: () => 0 });
    await store.put(KEY, new Uint8Array([1, 2]), 'image/png');
    expect(sent).toEqual([
      {
        name: 'PutObjectCommand',
        input: {
          Bucket: 'ligo',
          Key: KEY,
          Body: new Uint8Array([1, 2]),
          ContentType: 'image/png',
          ContentLength: 2,
        },
      },
    ]);
  });

  it('reads an object, or null when missing or larger than asked', async () => {
    const reads = (reply: () => unknown, max = 10) =>
      createR2ObjectStore(SETTINGS, { client: client(reply).s3, now: () => 0 }).get(KEY, max);
    expect(await reads(() => body([1, 2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
    expect(await reads(missing)).toBeNull();
    expect(await reads(() => body([1, 2, 3]), 2)).toBeNull();
  });

  it('asks only for the bytes it may read, so a large object is never downloaded whole', async () => {
    const { sent, s3 } = client(() => body([1]));
    await createR2ObjectStore(SETTINGS, { client: s3, now: () => 0 }).get(KEY, 10);
    expect(sent[0]?.input).toMatchObject({ Bucket: 'ligo', Key: KEY, Range: 'bytes=0-10' });
  });

  it('tells a size, or null for a missing object, and deletes', async () => {
    const { sent, s3 } = client((name) =>
      name === 'HeadObjectCommand' ? { ContentLength: 7 } : {},
    );
    const store = createR2ObjectStore(SETTINGS, { client: s3, now: () => 0 });
    expect(await store.size(KEY)).toBe(7);
    await store.delete(KEY);
    expect(sent.map((s) => s.name)).toEqual(['HeadObjectCommand', 'DeleteObjectCommand']);
    const gone = createR2ObjectStore(SETTINGS, { client: client(missing).s3, now: () => 0 });
    expect(await gone.size(KEY)).toBeNull();
  });

  it('lets other R2 errors through, for the caller to log', async () => {
    const down = () => {
      throw Object.assign(new Error('Service Unavailable'), { $metadata: { httpStatusCode: 503 } });
    };
    const store = createR2ObjectStore(SETTINGS, { client: client(down).s3, now: () => 0 });
    await expect(store.get(KEY, 10)).rejects.toThrow('Service Unavailable');
  });

  it('refuses a key that is not a storage key, before asking R2', async () => {
    const { sent, s3 } = client();
    const store = createR2ObjectStore(SETTINGS, { client: s3, now: () => 0 });
    await expect(store.put('../x', new Uint8Array([1]), 'x/y')).rejects.toThrow(
      'Not a storage key',
    );
    expect(sent).toEqual([]);
  });

  it('signs a short PUT for one key, size and type; the secret never appears', async () => {
    const store = createR2ObjectStore(SETTINGS, { now: () => 1_000 });
    const signed = await store.signPut('replays/4/abc.rec', {
      size: 1234,
      contentType: 'application/octet-stream',
      expiresInS: 300,
    });
    const url = new URL(signed.url);
    // Path-style addresses, which R2 always serves under its own certificate.
    expect(url.host).toBe('acc0unt.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/ligo/replays/4/abc.rec');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(
      expect.arrayContaining(['content-length', 'content-type', 'host']),
    );
    expect(signed.url).not.toContain(SETTINGS.secretAccessKey);
    expect(signed).toMatchObject({
      method: 'PUT',
      expiresAt: 301_000,
      headers: { 'content-type': 'application/octet-stream' },
    });
  });

  it('signs a short download saved under a plain name; the secret never appears', async () => {
    const store = createR2ObjectStore(SETTINGS, { now: () => 1_000 });
    const signed = await store.signGet('evidence/4/moss/7-abc.zip', {
      expiresInS: 120,
      fileName: 'moss "b1".zip',
    });
    if (signed === null) throw new Error('R2 always signs');
    const url = new URL(signed);
    expect(url.pathname).toBe('/ligo/evidence/4/moss/7-abc.zip');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120');
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="moss__b1_.zip"',
    );
    expect(signed).not.toContain(SETTINGS.secretAccessKey);
    await expect(store.signGet('../x', { expiresInS: 1, fileName: 'x' })).rejects.toThrow();
  });
});
