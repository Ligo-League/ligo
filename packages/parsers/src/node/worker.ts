import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import { serveParser, type ToWorker } from '../channel.ts';
import { startR6 } from '../go.ts';

// The Node worker thread a parser runs in (see `../channel.ts`). `workerData` is the path of Go's
// `wasm_exec.js`, which defines `globalThis.Go` in this thread only.

const port = parentPort;
if (!port) throw new Error('Run as a worker thread');

serveParser(
  {
    send: (message) => {
      port.postMessage(message);
    },
    onMessage: (listener) => {
      port.on('message', (message: ToWorker) => {
        listener(message);
      });
    },
  },
  async (wasm) => {
    await import(pathToFileURL(String(workerData)).href);
    return startR6(await readFile(wasm));
  },
);
