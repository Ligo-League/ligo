import type { RoundResult, StartedParser } from './go.ts';
import type { ParseOutcome, Parser, ParserBuild } from './module.ts';
import { acceptsR6, R6_HEAD_BYTES } from './r6/format.ts';

// A parser that runs in a worker (a Node worker thread or a browser Web Worker), so a malicious
// or broken file can at worst kill that worker (design doc section 8, "Isolation"). One file at a
// time; a parse past the timeout, a worker that dies, and a worker whose memory grew past the cap
// are stopped, and the next file gets a new worker. The two sides speak the messages below over a
// `Channel`, which Node and browsers each implement.

/** Parent to worker. */
export type ToWorker =
  { kind: 'start'; wasm: string } | { kind: 'parse'; id: number; bytes: Uint8Array };
/** Worker to parent. */
export type FromWorker =
  | { kind: 'ready' }
  | { kind: 'result'; id: number; result: RoundResult; memory: number }
  /** The module failed to start, or exited: the worker is of no more use. */
  | { kind: 'fatal'; message: string };

/** The parent's end of a worker. */
export interface Channel {
  send(message: ToWorker, transfer?: ArrayBuffer[]): void;
  onMessage(listener: (message: FromWorker) => void): void;
  /** The worker died: an uncaught error, or it exited. */
  onFailure(listener: (message: string) => void): void;
  terminate(): Promise<void>;
}

export interface WorkerParserOptions {
  /** What the worker loads: the `.wasm` file's path (Node) or address (browser). */
  wasm: string;
  /** A parse taking longer is stopped (design doc section 8: 60 s). */
  timeoutMs?: number;
  /** After a parse, a worker whose WebAssembly memory is above this is replaced. */
  memoryCapBytes?: number;
  /** A larger file is refused before parsing; an R6 round is about 10 MB. */
  maxFileBytes?: number;
}

export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MEMORY_CAP_BYTES = 1024 * 1024 * 1024;
export const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;

interface Running {
  channel: Channel;
  ready: Promise<void>;
  /** Settles the parse waiting for this worker, if any. */
  settle: ((outcome: ParseOutcome & { memory?: number }) => void) | null;
}

const failed = (error: Exclude<ParseOutcome, { ok: true }>['error'], message: string) =>
  ({ ok: false, error, message }) as const;

/** A parser over workers that `spawn` creates. */
export function workerParser(
  build: ParserBuild,
  spawn: () => Channel,
  options: WorkerParserOptions,
): Parser {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const memoryCap = options.memoryCapBytes ?? DEFAULT_MEMORY_CAP_BYTES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  let current: Running | null = null;
  let closed = false;
  let nextId = 1;
  // One file at a time: each parse waits for the one before.
  let queue: Promise<unknown> = Promise.resolve();

  const stop = async (running: Running) => {
    if (current === running) current = null;
    await running.channel.terminate();
  };

  const start = (): Running => {
    const channel = spawn();
    let markReady: () => void = () => undefined;
    let markFailed: (error: Error) => void = () => undefined;
    const ready = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      markFailed = reject;
    });
    // Rejections are read by `parseOne`; this keeps an unread one from being reported.
    ready.catch(() => undefined);
    const running: Running = { channel, ready, settle: null };
    const die = (message: string) => {
      if (current === running) current = null;
      markFailed(new Error(message));
      running.settle?.(failed('crashed', message));
      running.settle = null;
    };
    channel.onMessage((message) => {
      if (message.kind === 'ready') markReady();
      else if (message.kind === 'fatal') die(message.message);
      else {
        const { result, memory } = message;
        running.settle?.(
          'json' in result
            ? { ok: true, json: result.json, memory }
            : { ...failed('parse_failed', result.error), memory },
        );
        running.settle = null;
      }
    });
    channel.onFailure(die);
    channel.send({ kind: 'start', wasm: options.wasm });
    return running;
  };

  const parseOne = async (bytes: Uint8Array): Promise<ParseOutcome> => {
    if (closed) return failed('crashed', 'The parser is closed');
    if (bytes.byteLength > maxFileBytes) return failed('not_a_replay', 'File too large');
    if (!acceptsR6('round.rec', bytes.subarray(0, R6_HEAD_BYTES)))
      return failed('not_a_replay', 'Not an R6 replay');
    current ??= start();
    const running = current;
    try {
      await running.ready;
    } catch (error) {
      return failed('crashed', error instanceof Error ? error.message : String(error));
    }
    const id = nextId++;
    // A copy is sent, so the caller keeps its bytes.
    const copy = bytes.slice();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await new Promise<ParseOutcome & { memory?: number }>((resolve) => {
      running.settle = resolve;
      timer = setTimeout(() => {
        running.settle = null;
        resolve(failed('timeout', `No answer within ${String(timeoutMs)} ms`));
      }, timeoutMs);
      running.channel.send({ kind: 'parse', id, bytes: copy }, [copy.buffer]);
    });
    clearTimeout(timer);
    if (!outcome.ok && (outcome.error === 'timeout' || outcome.error === 'crashed'))
      await stop(running);
    else if ((outcome.memory ?? 0) > memoryCap) await stop(running);
    if (outcome.ok) return { ok: true, json: outcome.json };
    return failed(outcome.error, outcome.message);
  };

  return {
    ...build,
    accepts: acceptsR6,
    parse(bytes) {
      const result = queue.then(() => parseOne(bytes));
      queue = result.catch(() => undefined);
      return result;
    },
    async close() {
      closed = true;
      await queue;
      if (current) await stop(current);
    },
  };
}

/** The worker's end of the channel. */
export interface Endpoint {
  send(message: FromWorker): void;
  onMessage(listener: (message: ToWorker) => void): void;
}

/**
 * Runs in the worker: starts the parser on the parent's `start` message with `load`, then answers
 * each `parse`. A parser that throws (the Go program exited, say) is reported as fatal: the
 * parent replaces the worker.
 */
export function serveParser(
  endpoint: Endpoint,
  load: (wasm: string) => Promise<StartedParser>,
): void {
  let parser: StartedParser | null = null;
  endpoint.onMessage((message) => {
    if (message.kind === 'start') {
      load(message.wasm).then(
        (started) => {
          parser = started;
          endpoint.send({ kind: 'ready' });
        },
        (error: unknown) => {
          endpoint.send({
            kind: 'fatal',
            message: error instanceof Error ? error.message : String(error),
          });
        },
      );
      return;
    }
    if (!parser) {
      endpoint.send({ kind: 'fatal', message: 'Parse asked before the parser started' });
      return;
    }
    try {
      const result = parser.parseRound(message.bytes);
      endpoint.send({ kind: 'result', id: message.id, result, memory: parser.memoryBytes() });
    } catch (error) {
      endpoint.send({
        kind: 'fatal',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
