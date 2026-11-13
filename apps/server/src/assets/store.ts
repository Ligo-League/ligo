import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

// Images the bot draws with, such as team logos, found by a storage key like "logos/rck.png".
// Until R2 (phase 5) they are files on disk under the assets folder; the keys stay the same.

/** Logos are drawn from square PNGs of this size, prepared by `pnpm assets:logos`. */
export const LOGO_SIZE = 128;
/** A logo's name: the file name without extension, and the last part of its key. */
export const LOGO_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// The only keys the store answers: nothing else on disk can be reached through a key.
const LOGO_KEY = /^logos\/[a-z0-9][a-z0-9_-]{0,63}\.png$/;
/** A prepared logo weighs a few kilobytes; anything far larger was not prepared. */
export const MAX_ASSET_BYTES = 512 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface StoredImage {
  type: 'image/png';
  data: Uint8Array;
}

export interface AssetStore {
  /** The image under `key`, or null when the key is not a logo's, the file is missing or not a PNG. */
  read(key: string): Promise<StoredImage | null>;
}

const isPng = (data: Uint8Array) => PNG_SIGNATURE.every((byte, index) => data[index] === byte);

/** Logos read from a folder on disk, `data/assets/render` by default. */
export function createLocalAssetStore(root: string): AssetStore {
  return {
    async read(key) {
      if (!LOGO_KEY.test(key)) return null;
      const path = join(root, key);
      try {
        if ((await stat(path)).size > MAX_ASSET_BYTES) return null;
        const data = new Uint8Array(await readFile(path));
        return isPng(data) ? { type: 'image/png', data } : null;
      } catch {
        // A logo not prepared yet: the image falls back to the team's colours.
        return null;
      }
    },
  };
}

/** An in-memory store for tests. */
export function fakeAssetStore(files: Record<string, Uint8Array> = {}): AssetStore {
  return {
    read(key) {
      const data = files[key];
      return Promise.resolve(data && isPng(data) ? { type: 'image/png', data } : null);
    },
  };
}

/** The smallest valid PNG header, for tests that need a logo but never decode it. */
export const PNG_HEADER_FOR_TESTS = new Uint8Array(PNG_SIGNATURE);
