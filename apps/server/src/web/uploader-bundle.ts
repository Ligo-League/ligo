import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readParserBuild } from '@ligo/parsers/node';
import { build } from 'esbuild';

// The replay uploader's browser files (design doc section 8, phase 5-9), made when the server
// starts: the Preact island and the parser's Web Worker, bundled by esbuild from
// `@ligo/uploader`, and the parser build itself (`PARSERS_DIR`). Built in memory each start, so
// a release never serves an island older than the server, nor a parser other than its own.

export interface UploaderFiles {
  /** The parser build's version: the only one the API accepts. */
  version: string;
  /** `/static/uploader.js`. */
  island: string;
  /** `/static/parser-worker.js`: Go's `wasm_exec.js`, then the parser's side of the channel. */
  worker: string;
  /** `/parsers/<name>`: the WebAssembly parser. */
  wasm: { name: string; bytes: Uint8Array };
}

export type BuildUploaderReply =
  | { ok: true; files: UploaderFiles }
  | { ok: false; error: 'no_build' | 'bad_manifest' | 'bundle_failed' };

const entry = (specifier: string) => fileURLToPath(import.meta.resolve(specifier));

async function bundle(entryPoint: string, banner?: string): Promise<string> {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    jsx: 'automatic',
    jsxImportSource: 'preact',
    legalComments: 'eof',
    logLevel: 'silent',
    ...(banner === undefined ? {} : { banner: { js: banner } }),
  });
  const [output] = result.outputFiles;
  if (!output) throw new Error(`esbuild wrote nothing for ${entryPoint}`);
  return output.text;
}

export async function buildUploader(parsersDir: string): Promise<BuildUploaderReply> {
  const read = await readParserBuild(parsersDir);
  if (!read.ok) return read;
  try {
    const [wasm, wasmExec] = await Promise.all([
      readFile(join(parsersDir, read.build.wasm)),
      readFile(join(parsersDir, 'wasm_exec.js'), 'utf8'),
    ]);
    const [island, worker] = await Promise.all([
      bundle(entry('@ligo/uploader/island')),
      bundle(entry('@ligo/uploader/worker'), wasmExec),
    ]);
    return {
      ok: true,
      files: {
        version: read.build.version,
        island,
        worker,
        wasm: { name: read.build.wasm, bytes: new Uint8Array(wasm) },
      },
    };
  } catch {
    return { ok: false, error: 'bundle_failed' };
  }
}
