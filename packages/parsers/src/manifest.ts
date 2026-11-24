import * as z from 'zod';
import type { ParserBuild } from './module.ts';

// A parser build's manifest, `parsers/dist/r6.json`, written by `parsers/build-r6.sh`: which file
// is the current build. The server accepts JSON only from the versions it lists (design doc
// section 8, "pinned parser version"); a browser holding another build reloads it.

export const parserManifestSchema = z.strictObject({
  version: z.string().regex(/^r6-[0-9a-f]{16}$/),
  wasm: z.string().regex(/^r6-[0-9a-f]{16}\.wasm$/),
});
export type ParserManifest = z.infer<typeof parserManifestSchema>;

/** The build a manifest names; null when the manifest is not one. */
export function readManifest(json: unknown): (ParserBuild & { wasm: string }) | null {
  const parsed = parserManifestSchema.safeParse(json);
  if (!parsed.success || parsed.data.wasm !== `${parsed.data.version}.wasm`) return null;
  return { title: 'r6', version: parsed.data.version, wasm: parsed.data.wasm };
}

/**
 * Whether JSON from a parser version may be stored: only the builds the server lists. Today
 * that is the build it runs; a parser update makes older uploads verify against the new build.
 */
export function isAcceptedVersion(accepted: readonly string[], version: string): boolean {
  return accepted.includes(version);
}
