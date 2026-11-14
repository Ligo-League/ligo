import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// The server's own copy of match evidence, such as score screenshots, found by a storage key
// like "evidence/12/<sha256>.png" (design doc section 13, R2 layout). Until R2 (phase 5) the
// files live on disk; the keys stay the same. Evidence is never served publicly: the website
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

/** Files under a folder on disk, `data/storage` by default. */
export function createLocalEvidenceStore(
  root: string,
  maxBytes: number,
  logger: { error: (details: object, message: string) => void },
): EvidenceStore {
  return {
    async put(key, data) {
      if (!EVIDENCE_KEY.test(key)) throw new Error('Not an evidence key');
      const path = join(root, key);
      try {
        await mkdir(dirname(path), { recursive: true });
        // Written aside then renamed, so a reader never sees half a file.
        const partial = `${path}.partial`;
        await writeFile(partial, data);
        await rename(partial, path);
      } catch (error) {
        logger.error({ err: error, key }, 'Evidence could not be stored');
        throw error;
      }
    },
    async read(key) {
      if (!EVIDENCE_KEY.test(key)) return null;
      const path = join(root, key);
      try {
        if ((await stat(path)).size > maxBytes) return null;
        return new Uint8Array(await readFile(path));
      } catch {
        return null;
      }
    },
  };
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
