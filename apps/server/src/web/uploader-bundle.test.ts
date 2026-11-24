import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildUploader } from './uploader-bundle.ts';

// The uploader's browser files, bundled from @ligo/uploader with a parser build's folder: here a
// stand-in build, so the test needs neither Go nor `pnpm parsers:build`.

const VERSION = 'r6-0123456789abcdef';

function parsersDir(manifest = true) {
  const dir = mkdtempSync(join(tmpdir(), 'ligo-parsers-'));
  if (manifest) {
    writeFileSync(
      join(dir, 'r6.json'),
      JSON.stringify({ version: VERSION, wasm: `${VERSION}.wasm` }),
    );
  }
  writeFileSync(join(dir, `${VERSION}.wasm`), new Uint8Array([0, 97, 115, 109]));
  writeFileSync(join(dir, 'wasm_exec.js'), 'globalThis.GoLoaderStandIn = true;');
  return dir;
}

describe('buildUploader', () => {
  it('bundles the island and the worker, Go’s loader first, with the build’s file', async () => {
    const built = await buildUploader(parsersDir());
    if (!built.ok) throw new Error(built.error);
    const { files } = built;
    expect(files.version).toBe(VERSION);
    expect(files.wasm).toEqual({
      name: `${VERSION}.wasm`,
      bytes: new Uint8Array([0, 97, 115, 109]),
    });
    expect(files.worker.startsWith('globalThis.GoLoaderStandIn = true;')).toBe(true);
    expect(files.island).toContain('replay-uploader');
    // zod's locales stay out of the browser's download (`import * as z`).
    expect(files.island.length).toBeLessThan(250_000);
  }, 30_000);

  it('says when there is no build', async () => {
    expect(await buildUploader(parsersDir(false))).toEqual({ ok: false, error: 'no_build' });
  });
});
