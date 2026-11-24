import { createDiskObjectStore, type ObjectStore } from '@ligo/storage';

// The server's own copy of match evidence, such as score screenshots, found by a storage key
// like "evidence/12/<sha256>.png" (design doc section 13, R2 layout): in R2, or on disk on a
// machine without R2 settings, under the same keys. Evidence is never served publicly: the website
// reads it through a route that checks who asks.

/**
 * The only keys the store answers: score screenshots by match, and logos uploaded at
 * registration (`uploads/`). Nothing else on disk can be reached through a key.
 */
export const EVIDENCE_KEY =
  /^(?:evidence\/[1-9]\d{0,9}\/[0-9a-f]{64}\.(?:png|jpg|webp)|uploads\/[0-9a-f]{64}\.png)$/;

export interface EvidenceStore {
  /** Stores the file; a key already stored is left as it is, since the key names the content. */
  put(key: string, data: Uint8Array): Promise<void>;
  /** The file under `key`, or null when the key is not evidence's, or the file is missing. */
  read(key: string): Promise<Uint8Array | null>;
}

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

/** Evidence in an object store: R2 in production, a folder on disk without R2 settings. */
export function createEvidenceStore(
  objects: ObjectStore,
  maxBytes: number,
  logger: { error: (details: object, message: string) => void },
): EvidenceStore {
  return {
    async put(key, data) {
      if (!EVIDENCE_KEY.test(key)) throw new Error('Not an evidence key');
      try {
        await objects.put(key, data, TYPES[key.split('.').at(-1) ?? ''] ?? 'image/png');
      } catch (error) {
        logger.error({ err: error, key }, 'Evidence could not be stored');
        throw error;
      }
    },
    async read(key) {
      return EVIDENCE_KEY.test(key) ? objects.get(key, maxBytes) : null;
    },
  };
}

/** Files under a folder on disk, `data/storage` by default. */
export function createLocalEvidenceStore(
  root: string,
  maxBytes: number,
  logger: { error: (details: object, message: string) => void },
): EvidenceStore {
  return createEvidenceStore(
    createDiskObjectStore(root, { upload: null, now: Date.now }),
    maxBytes,
    logger,
  );
}

/** An in-memory store for tests; `failing` makes the next writes fail, as a full disk would. */
export function fakeEvidenceStore(): EvidenceStore & {
  files: Map<string, Uint8Array>;
  failing: boolean;
} {
  const store = {
    files: new Map<string, Uint8Array>(),
    failing: false,
    put(key: string, data: Uint8Array) {
      if (store.failing || !EVIDENCE_KEY.test(key)) return Promise.reject(new Error('Not stored'));
      store.files.set(key, data);
      return Promise.resolve();
    },
    read(key: string) {
      return Promise.resolve(store.files.get(key) ?? null);
    },
  };
  return store;
}
