import {
  workerParser,
  type Channel,
  type FromWorker,
  type WorkerParserOptions,
} from '../channel.ts';
import type { Parser, ParserBuild } from '../module.ts';

// The parser in the uploader's browser: files are parsed in a Web Worker, so the page stays
// responsive and a broken file only costs that worker (design doc section 8, upload flow).

/** What the page needs of a Web Worker; this package's types leave the browser's globals out. */
export interface WebWorkerLike {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  addEventListener(type: 'message', listener: (event: { data: FromWorker }) => void): void;
  addEventListener(type: 'error', listener: (event: { message?: string }) => void): void;
  terminate(): void;
}

/**
 * A parser over Web Workers `createWorker` makes (`new Worker(bundleUrl)`); `options.wasm` is the
 * build's address, which the server gives with its version.
 */
export function browserParser(
  build: ParserBuild,
  createWorker: () => WebWorkerLike,
  options: WorkerParserOptions,
): Parser {
  const spawn = (): Channel => {
    const worker = createWorker();
    return {
      send: (message, transfer) => {
        worker.postMessage(message, transfer ?? []);
      },
      onMessage: (listener) => {
        worker.addEventListener('message', (event) => {
          listener(event.data);
        });
      },
      onFailure: (listener) => {
        worker.addEventListener('error', (event) => {
          listener(event.message ?? 'The parser worker failed');
        });
      },
      terminate: () => {
        worker.terminate();
        return Promise.resolve();
      },
    };
  };
  return workerParser(build, spawn, options);
}
