// Checks the R6 parser's WebAssembly build against its native CLI (design doc sections 10 and 14):
// every round under a folder is parsed by both, and what the WebAssembly build returns must be
// exactly the same as the CLI's output for those keys. Any difference blocks a parser release.
//
//   pnpm parsers:compare [folder]     (default: fixtures/replays)
//
// Needs parsers/build-r6.sh to have run, and replays (parsers/fetch-replays.sh).
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'parsers', 'dist');

interface GoRuntime {
  importObject: object;
  run(instance: object): Promise<void>;
}
// The one WebAssembly call needed; Node's types leave the global to the DOM library.
const { WebAssembly: wasm } = globalThis as unknown as {
  WebAssembly: { instantiate(bytes: Uint8Array, imports: object): Promise<{ instance: object }> };
};
type ParseRound = (bytes: Uint8Array) => { json?: string; error?: string };

async function loadWasm(): Promise<{ version: string; parseRound: ParseRound }> {
  const manifest = JSON.parse(await readFile(join(DIST, 'r6.json'), 'utf8')) as {
    version: string;
    wasm: string;
  };
  // Go's loader is a plain script: it sets globalThis.Go.
  await import(pathToFileURL(join(DIST, 'wasm_exec.js')).href);
  const scope = globalThis as unknown as {
    Go: new () => GoRuntime;
    r6dissect?: { parseRound: ParseRound };
  };
  const go = new scope.Go();
  const { instance } = await wasm.instantiate(
    await readFile(join(DIST, manifest.wasm)),
    go.importObject,
  );
  // Never resolves: the module waits for calls until the process ends.
  void go.run(instance);
  const exported = scope.r6dissect;
  if (!exported) throw new Error('The module did not set r6dissect');
  return { version: manifest.version, parseRound: exported.parseRound };
}

async function roundFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.rec'))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

async function main(): Promise<void> {
  const folder = resolve(process.argv[2] ?? join(ROOT, 'fixtures', 'replays'));
  const files = await roundFiles(folder);
  if (files.length === 0) throw new Error(`No .rec file under ${folder}`);
  const { version, parseRound } = await loadWasm();
  console.log(`${version}: ${String(files.length)} rounds under ${relative(ROOT, folder)}`);

  let different = 0;
  let wasmMs = 0;
  let largest = 0;
  for (const file of files) {
    const bytes = new Uint8Array(await readFile(file));
    const started = performance.now();
    const parsed = parseRound(bytes);
    wasmMs += performance.now() - started;
    const name = relative(folder, file);
    if (parsed.json === undefined) {
      console.log(`✗ ${name}: the WebAssembly build failed: ${parsed.error ?? '?'}`);
      different += 1;
      continue;
    }
    largest = Math.max(largest, parsed.json.length);
    const wasm = JSON.parse(parsed.json) as Record<string, unknown>;
    const { stdout } = await run(join(DIST, 'r6-dissect'), [file, '-f', 'json'], {
      maxBuffer: 256 * 1024 * 1024,
    });
    const native = JSON.parse(stdout) as Record<string, unknown>;
    const differing = Object.keys(wasm).filter((key) => !isDeepStrictEqual(wasm[key], native[key]));
    if (differing.length > 0) {
      console.log(`✗ ${name}: differs in ${differing.join(', ')}`);
      different += 1;
    }
  }
  console.log(
    `${String(files.length - different)}/${String(files.length)} rounds identical; ` +
      `WebAssembly ${(wasmMs / files.length).toFixed(0)} ms a round on average, ` +
      `largest JSON ${(largest / 1024).toFixed(0)} KB`,
  );
  if (different > 0) process.exitCode = 1;
}

await main();
