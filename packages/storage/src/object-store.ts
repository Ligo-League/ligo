import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { signUploadToken } from './upload-token.ts';

// Where the server's files live (design doc section 13): Cloudflare R2 in production
// (`r2-store.ts`), a folder on disk on a machine without R2 settings, memory in tests. The
// stores above this one (evidence, transcripts) check their own keys; this layer only refuses a
// key that could leave its place.

/** Parts of letters, digits, `.`, `_` and `-`, separated by `/`; no part may start with a dot. */
const STORAGE_KEY = /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
export const isStorageKey = (key: string) => key.length <= 512 && STORAGE_KEY.test(key);

const refuse = () => Promise.reject(new Error('Not a storage key'));

/** A presigned upload: the browser sends `method` to `url` with `headers` and the file. */
export interface SignedPut {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  /** Unix milliseconds. */
  expiresAt: number;
}

export interface SignOptions {
  /** The exact size the upload must have. */
  size: number;
  contentType: string;
  expiresInS: number;
}

export interface ObjectStore {
  /** Keeps the object, replacing one under the same key. */
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  /** The object, or null when it is missing or larger than `maxBytes`. */
  get(key: string, maxBytes: number): Promise<Uint8Array | null>;
  /** Its size in bytes, or null when it is missing. */
  size(key: string): Promise<number | null>;
  /** Deletes the object; a missing one is not an error. */
  delete(key: string): Promise<void>;
  /** A short-lived upload of exactly one file to `key`. */
  signPut(key: string, options: SignOptions): Promise<SignedPut>;
}

export interface DiskOptions {
  /** Signs uploads to the server's own route (`PUT /storage/upload/:token`); null: none. */
  upload: { secret: string; publicUrl: string } | null;
  now: () => number;
}

/** Files under a folder on disk, `data/storage` by default. */
export function createDiskObjectStore(root: string, options: DiskOptions): ObjectStore {
  const path = (key: string) => join(root, key);
  return {
    async put(key, data) {
      if (!isStorageKey(key)) return refuse();
      await mkdir(dirname(path(key)), { recursive: true });
      // Written aside then renamed, so a reader never sees half a file.
      const partial = `${path(key)}.partial`;
      await writeFile(partial, data);
      await rename(partial, path(key));
    },
    async get(key, maxBytes) {
      if (!isStorageKey(key)) return null;
      try {
        if ((await stat(path(key))).size > maxBytes) return null;
        return new Uint8Array(await readFile(path(key)));
      } catch {
        return null;
      }
    },
    async size(key) {
      if (!isStorageKey(key)) return null;
      try {
        return (await stat(path(key))).size;
      } catch {
        return null;
      }
    },
    async delete(key) {
      if (!isStorageKey(key)) return refuse();
      await rm(path(key), { force: true });
    },
    signPut(key, { size, contentType, expiresInS }) {
      if (!isStorageKey(key)) return refuse();
      if (!options.upload) return Promise.reject(new Error('Uploads need SESSION_SECRET'));
      const expiresAt = options.now() + expiresInS * 1000;
      const token = signUploadToken(options.upload.secret, { key, size, contentType, expiresAt });
      const url = new URL(`/storage/upload/${token}`, options.upload.publicUrl).href;
      return Promise.resolve({
        url,
        method: 'PUT',
        headers: { 'content-type': contentType },
        expiresAt,
      });
    },
  };
}

/**
 * While the files kept on disk are copied to R2 (`copy-to-r2.ts`): reads fall back to the old
 * place for what is not copied yet; writes go to the new place only; deletes go to both.
 */
export function withReadFallback(primary: ObjectStore, fallback: ObjectStore): ObjectStore {
  return {
    put: (key, data, contentType) => primary.put(key, data, contentType),
    async get(key, maxBytes) {
      return (await primary.get(key, maxBytes)) ?? (await fallback.get(key, maxBytes));
    },
    async size(key) {
      return (await primary.size(key)) ?? (await fallback.size(key));
    },
    async delete(key) {
      await primary.delete(key);
      await fallback.delete(key);
    },
    signPut: (key, options) => primary.signPut(key, options),
  };
}

/**
 * An in-memory store for tests; `failing` makes the next writes and signatures fail, `signed`
 * lists the uploads signed.
 */
export function fakeObjectStore(): ObjectStore & {
  objects: Map<string, Uint8Array>;
  types: Map<string, string>;
  failing: boolean;
  signed: ({ key: string } & SignOptions)[];
} {
  const store = {
    objects: new Map<string, Uint8Array>(),
    types: new Map<string, string>(),
    failing: false,
    signed: [] as ({ key: string } & SignOptions)[],
    put(key: string, data: Uint8Array, contentType: string) {
      if (!isStorageKey(key)) return refuse();
      if (store.failing) return Promise.reject(new Error('Not stored'));
      store.objects.set(key, data);
      store.types.set(key, contentType);
      return Promise.resolve();
    },
    get(key: string, maxBytes: number) {
      const data = store.objects.get(key);
      return Promise.resolve(data && data.length <= maxBytes ? data : null);
    },
    size(key: string) {
      return Promise.resolve(store.objects.get(key)?.length ?? null);
    },
    delete(key: string) {
      if (!isStorageKey(key)) return refuse();
      store.objects.delete(key);
      store.types.delete(key);
      return Promise.resolve();
    },
    signPut(key: string, options: SignOptions): Promise<SignedPut> {
      if (!isStorageKey(key)) return refuse();
      if (store.failing) return Promise.reject(new Error('Not signed'));
      store.signed.push({ key, ...options });
      const { contentType, expiresInS } = options;
      return Promise.resolve({
        url: `https://storage.invalid/${key}`,
        method: 'PUT',
        headers: { 'content-type': contentType },
        expiresAt: expiresInS * 1000,
      });
    },
  };
  return store;
}
