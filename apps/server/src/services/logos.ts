import type { AssetStore, StoredImage } from '../assets/store.ts';

/**
 * The logos behind these keys, each read once. A missing or unreadable logo is simply absent:
 * the image then shows the team's colours, and the rest of the reply goes on.
 */
export async function loadLogos(
  assets: AssetStore,
  keys: readonly (string | null)[],
): Promise<Map<string, StoredImage>> {
  const wanted = [...new Set(keys.filter((key): key is string => key !== null))];
  const found = await Promise.all(
    wanted.map(async (key) => [key, await assets.read(key)] as const),
  );
  return new Map(found.flatMap(([key, image]) => (image ? [[key, image] as const] : [])));
}
