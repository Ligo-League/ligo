// Replay parsers compiled to WebAssembly (design doc section 10). This entry point runs anywhere;
// `@ligo/parsers/node` runs a parser in Node worker threads, `@ligo/parsers/browser` in Web
// Workers.

export * from './module.ts';
export * from './manifest.ts';
export * from './sha256.ts';
export * from './r6/format.ts';
export {
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MEMORY_CAP_BYTES,
  DEFAULT_TIMEOUT_MS,
  workerParser,
  serveParser,
  type Channel,
  type Endpoint,
  type FromWorker,
  type ToWorker,
  type WorkerParserOptions,
} from './channel.ts';
export { startR6, type ParseRound, type RoundResult, type StartedParser } from './go.ts';
