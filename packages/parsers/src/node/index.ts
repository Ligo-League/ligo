import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  workerParser,
  type Channel,
  type FromWorker,
  type WorkerParserOptions,
} from '../channel.ts';
import { readManifest } from '../manifest.ts';
import type { Parser, ParserBuild } from '../module.ts';

// The parser on the server (design doc section 8): the worker re-parses each raw replay with the
// build the browsers use and compares. It runs in a worker thread with a memory cap and a timeout.

/** A JavaScript heap cap for the worker thread; the WebAssembly memory is capped by the parser. */
const WORKER_HEAP_MB = 256;

export interface NodeParserOptions extends Omit<WorkerParserOptions, 'wasm'> {
  /** The build's folder: `r6.json`, the `.wasm` it names and `wasm_exec.js` (`parsers/dist`). */
  distDir: string;
  /** The worker thread's script; tests replace it. */
  workerUrl?: URL;
}

export type LoadParserReply =
  | { ok: true; parser: Parser }
  /** `no_build`: the folder has no manifest (run `pnpm parsers:build`); `bad_manifest`: not one. */
  | { ok: false; error: 'no_build' | 'bad_manifest' };

export type ReadBuildReply =
  | { ok: true; build: ParserBuild & { wasm: string } }
  /** `no_build`: the folder has no manifest (run `pnpm parsers:build`); `bad_manifest`: not one. */
  | { ok: false; error: 'no_build' | 'bad_manifest' };

/**
 * The build in `distDir`, from its manifest only: the server checks the browser's parser version
 * against it without loading the parser.
 */
export async function readParserBuild(distDir: string): Promise<ReadBuildReply> {
  let text: string;
  try {
    text = await readFile(join(distDir, 'r6.json'), 'utf8');
  } catch {
    return { ok: false, error: 'no_build' };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'bad_manifest' };
  }
  const build = readManifest(json);
  return build ? { ok: true, build } : { ok: false, error: 'bad_manifest' };
}

/** The parser built in `distDir`, run in worker threads. */
export async function loadNodeParser(options: NodeParserOptions): Promise<LoadParserReply> {
  const read = await readParserBuild(options.distDir);
  if (!read.ok) return read;
  const { build } = read;
  const workerUrl = options.workerUrl ?? new URL('./worker.ts', import.meta.url);
  const execPath = join(options.distDir, 'wasm_exec.js');
  const spawn = (): Channel => {
    const worker = new Worker(workerUrl, {
      workerData: execPath,
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
    });
    return {
      send: (message, transfer) => {
        worker.postMessage(message, transfer ?? []);
      },
      onMessage: (listener) => {
        worker.on('message', (message: FromWorker) => {
          listener(message);
        });
      },
      onFailure: (listener) => {
        worker.on('error', (error: Error) => {
          listener(error.message);
        });
        worker.on('exit', (code) => {
          listener(`Worker exited with code ${String(code)}`);
        });
      },
      terminate: async () => {
        await worker.terminate();
      },
    };
  };
  const { title, version } = build;
  return {
    ok: true,
    parser: workerParser({ title, version }, spawn, {
      ...options,
      wasm: join(options.distDir, build.wasm),
    }),
  };
}
