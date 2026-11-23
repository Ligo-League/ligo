import { serveParser, type FromWorker, type ToWorker } from '../channel.ts';
import { startR6 } from '../go.ts';

// The Web Worker a parser runs in, in the uploader's browser (design doc section 8, upload flow).
// The upload page's bundle puts Go's `wasm_exec.js` before this script (phase 5-9), so
// `globalThis.Go` exists; the `start` message gives the `.wasm` file's address.

// A Web Worker's own scope; this package's types leave the browser's globals out.
const scope = globalThis as unknown as {
  postMessage(message: FromWorker): void;
  onmessage: ((event: { data: ToWorker }) => void) | null;
  fetch(url: string): Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
};

serveParser(
  {
    send: (message) => {
      scope.postMessage(message);
    },
    onMessage: (listener) => {
      scope.onmessage = (event) => {
        listener(event.data);
      };
    },
  },
  async (wasm) => {
    const response = await scope.fetch(wasm);
    if (!response.ok)
      throw new Error(`The parser could not be downloaded (${String(response.status)})`);
    return startR6(await response.arrayBuffer());
  },
);
