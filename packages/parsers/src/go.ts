// Starting a parser built with Go for WebAssembly, the same way in a browser Web Worker and in a
// Node worker thread. Go's own loader, `wasm_exec.js` from the same Go release as the build, must
// already have run: it defines `globalThis.Go`. The module then sets its functions on
// `globalThis` (the R6 parser: `r6dissect.parseRound`) and waits for calls.

interface GoRuntime {
  importObject: object;
  run(instance: object): Promise<void>;
}
interface WasmInstance {
  exports: Record<string, unknown>;
}
// Only these calls are used; this package's types leave the browser's globals out.
interface WasmApi {
  instantiate(
    bytes: ArrayBuffer | Uint8Array,
    imports: object,
  ): Promise<{ instance: WasmInstance }>;
}
interface GoScope {
  Go?: new () => GoRuntime;
  WebAssembly: WasmApi;
  r6dissect?: { parseRound?: unknown };
}

/** What the R6 parser returns for one round. */
export type RoundResult = { json: string } | { error: string };
export type ParseRound = (bytes: Uint8Array) => RoundResult;

export interface StartedParser {
  parseRound: ParseRound;
  /** The WebAssembly memory in bytes: it only grows, so a long-lived worker is recycled. */
  memoryBytes(): number;
}

/** Starts the R6 parser from its `.wasm` bytes. Throws when the scope lacks Go's loader. */
export async function startR6(
  wasm: ArrayBuffer | Uint8Array,
  scope: object = globalThis,
): Promise<StartedParser> {
  const go = scope as GoScope;
  if (!go.Go) throw new Error("Go's wasm_exec.js has not run: globalThis.Go is missing");
  const runtime = new go.Go();
  const { instance } = await go.WebAssembly.instantiate(wasm, runtime.importObject);
  // Resolves only when the program exits, which the parser never does on its own.
  void runtime.run(instance);
  const parseRound = go.r6dissect?.parseRound;
  if (typeof parseRound !== 'function')
    throw new Error('The module did not set r6dissect.parseRound');
  const memory = instance.exports.mem as { buffer: ArrayBuffer } | undefined;
  return {
    parseRound: parseRound as ParseRound,
    memoryBytes: () => memory?.buffer.byteLength ?? 0,
  };
}
