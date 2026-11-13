import { createHash } from 'node:crypto';

// Rendering takes a few hundred milliseconds and the same image is asked for many times. Images
// are kept in memory by a hash of their template, version and input; a stored cache comes later.
const CACHE_SIZE = 64;
const cache = new Map<string, Uint8Array>();

export const digest = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

/**
 * The cached PNG for this input, or a new one. `input` must already have its embedded images
 * replaced by their hashes: as JSON, their bytes would make a huge key to hash.
 */
export async function cachedPng(
  template: string,
  version: number,
  input: unknown,
  render: () => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const key = digest(JSON.stringify([template, version, input]));
  const cached = cache.get(key);
  if (cached) return cached;
  const png = await render();
  cache.set(key, png);
  // A Map iterates in insertion order, so its first key is the oldest image.
  const [oldest] = cache.keys();
  if (cache.size > CACHE_SIZE && oldest !== undefined) cache.delete(oldest);
  return png;
}
