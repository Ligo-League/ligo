import { describe, expect, it } from 'vitest';
import {
  serveParser,
  workerParser,
  type Channel,
  type FromWorker,
  type ToWorker,
} from './channel.ts';
import type { StartedParser } from './go.ts';

// The parser over workers (design doc section 8, isolation): one file at a time; a timeout, a
// dead worker or a worker past its memory cap is replaced for the next file.

const BUILD = { title: 'r6', version: 'r6-0123456789abcdef' } as const;
/** A round's first bytes, then anything. */
const round = (...rest: number[]) =>
  new Uint8Array([0x64, 0x69, 0x73, 0x73, 0x65, 0x63, 0x74, 0x00, ...rest]);

/** A fake worker the test drives: what it received, and how it answers. */
interface FakeWorker {
  received: ToWorker[];
  reply(message: FromWorker): void;
  fail(message: string): void;
  terminated: boolean;
}

function fakeWorkers(answer: (worker: FakeWorker, message: ToWorker) => void) {
  const workers: FakeWorker[] = [];
  const spawn = (): Channel => {
    let onMessage: (message: FromWorker) => void = () => undefined;
    let onFailure: (message: string) => void = () => undefined;
    const worker: FakeWorker = {
      received: [],
      reply: (message) => {
        queueMicrotask(() => {
          onMessage(message);
        });
      },
      fail: (message) => {
        queueMicrotask(() => {
          onFailure(message);
        });
      },
      terminated: false,
    };
    workers.push(worker);
    return {
      send: (message) => {
        worker.received.push(message);
        answer(worker, message);
      },
      onMessage: (listener) => {
        onMessage = listener;
      },
      onFailure: (listener) => {
        onFailure = listener;
      },
      terminate: () => {
        worker.terminated = true;
        return Promise.resolve();
      },
    };
  };
  return { workers, spawn };
}

/** Starts, then answers each parse with the round's last byte as its JSON. */
const echo =
  (memory = 1000) =>
  (worker: FakeWorker, message: ToWorker) => {
    if (message.kind === 'start') worker.reply({ kind: 'ready' });
    else
      worker.reply({
        kind: 'result',
        id: message.id,
        result: { json: String(message.bytes.at(-1)) },
        memory,
      });
  };

describe('workerParser', () => {
  it('starts one worker with the build, and parses file after file in it', async () => {
    const { workers, spawn } = fakeWorkers(echo());
    const parser = workerParser(BUILD, spawn, { wasm: '/p/r6.wasm' });
    expect(parser.version).toBe(BUILD.version);
    const results = await Promise.all([parser.parse(round(1)), parser.parse(round(2))]);
    expect(results).toEqual([
      { ok: true, json: '1' },
      { ok: true, json: '2' },
    ]);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.received[0]).toEqual({ kind: 'start', wasm: '/p/r6.wasm' });
  });

  it('sends a copy, so the caller keeps its bytes', async () => {
    const { spawn } = fakeWorkers(echo());
    const parser = workerParser(BUILD, spawn, { wasm: 'w' });
    const bytes = round(7);
    await parser.parse(bytes);
    expect(bytes.byteLength).toBe(9);
  });

  it('refuses what is not a round, or too large, without a worker', async () => {
    const { workers, spawn } = fakeWorkers(echo());
    const parser = workerParser(BUILD, spawn, { wasm: 'w', maxFileBytes: 10 });
    expect(await parser.parse(new Uint8Array([1, 2, 3]))).toMatchObject({
      ok: false,
      error: 'not_a_replay',
    });
    expect(await parser.parse(round(1, 2, 3))).toMatchObject({
      ok: false,
      error: 'not_a_replay',
      message: 'File too large',
    });
    expect(workers).toHaveLength(0);
  });

  it('reports the parser’s own refusal and keeps the worker', async () => {
    const { workers, spawn } = fakeWorkers((worker, message) => {
      if (message.kind === 'start') worker.reply({ kind: 'ready' });
      else
        worker.reply({
          kind: 'result',
          id: message.id,
          result: { error: 'bad header' },
          memory: 1,
        });
    });
    const parser = workerParser(BUILD, spawn, { wasm: 'w' });
    expect(await parser.parse(round())).toEqual({
      ok: false,
      error: 'parse_failed',
      message: 'bad header',
    });
    await parser.parse(round());
    expect(workers).toHaveLength(1);
  });

  it('stops a parse past the timeout, and the next file gets a new worker', async () => {
    let first = true;
    const { workers, spawn } = fakeWorkers((worker, message) => {
      if (message.kind === 'start') worker.reply({ kind: 'ready' });
      else if (first)
        first = false; // never answers
      else echo()(worker, message);
    });
    const parser = workerParser(BUILD, spawn, { wasm: 'w', timeoutMs: 20 });
    expect(await parser.parse(round(1))).toMatchObject({ ok: false, error: 'timeout' });
    expect(workers[0]?.terminated).toBe(true);
    expect(await parser.parse(round(2))).toEqual({ ok: true, json: '2' });
    expect(workers).toHaveLength(2);
  });

  it('reports a worker that dies mid-parse as crashed, and replaces it', async () => {
    let first = true;
    const { workers, spawn } = fakeWorkers((worker, message) => {
      if (message.kind === 'start') worker.reply({ kind: 'ready' });
      else if (first) {
        first = false;
        worker.fail('out of memory');
      } else echo()(worker, message);
    });
    const parser = workerParser(BUILD, spawn, { wasm: 'w' });
    expect(await parser.parse(round(1))).toEqual({
      ok: false,
      error: 'crashed',
      message: 'out of memory',
    });
    expect(await parser.parse(round(2))).toEqual({ ok: true, json: '2' });
    expect(workers).toHaveLength(2);
  });

  it('reports a parser that cannot start, and tries again on the next file', async () => {
    const { workers, spawn } = fakeWorkers((worker, message) => {
      if (message.kind === 'start') worker.reply({ kind: 'fatal', message: 'no wasm_exec.js' });
    });
    const parser = workerParser(BUILD, spawn, { wasm: 'w' });
    expect(await parser.parse(round())).toEqual({
      ok: false,
      error: 'crashed',
      message: 'no wasm_exec.js',
    });
    await parser.parse(round());
    expect(workers).toHaveLength(2);
  });

  it('replaces a worker whose memory grew past the cap, after its parse', async () => {
    const { workers, spawn } = fakeWorkers(echo(5000));
    const parser = workerParser(BUILD, spawn, { wasm: 'w', memoryCapBytes: 4000 });
    expect(await parser.parse(round(1))).toEqual({ ok: true, json: '1' });
    expect(workers[0]?.terminated).toBe(true);
    await parser.parse(round(2));
    expect(workers).toHaveLength(2);
  });

  it('stops its worker on close, and refuses files afterwards', async () => {
    const { workers, spawn } = fakeWorkers(echo());
    const parser = workerParser(BUILD, spawn, { wasm: 'w' });
    await parser.parse(round());
    await parser.close();
    expect(workers[0]?.terminated).toBe(true);
    expect(await parser.parse(round())).toMatchObject({ ok: false, error: 'crashed' });
  });
});

describe('serveParser', () => {
  function endpoint() {
    const sent: FromWorker[] = [];
    let listener: (message: ToWorker) => void = () => undefined;
    return {
      sent,
      deliver: (message: ToWorker) => {
        listener(message);
      },
      endpoint: {
        send: (message: FromWorker) => sent.push(message),
        onMessage: (next: (message: ToWorker) => void) => {
          listener = next;
        },
      },
    };
  }
  const parser = (parseRound: StartedParser['parseRound']): StartedParser => ({
    parseRound,
    memoryBytes: () => 42,
  });

  it('starts on the parent’s word, then answers each parse with the memory used', async () => {
    const { sent, deliver, endpoint: end } = endpoint();
    const loaded: string[] = [];
    serveParser(end, (wasm) => {
      loaded.push(wasm);
      return Promise.resolve(parser(() => ({ json: '{}' })));
    });
    deliver({ kind: 'start', wasm: 'r6.wasm' });
    await Promise.resolve();
    deliver({ kind: 'parse', id: 3, bytes: round() });
    expect(loaded).toEqual(['r6.wasm']);
    expect(sent).toEqual([
      { kind: 'ready' },
      { kind: 'result', id: 3, result: { json: '{}' }, memory: 42 },
    ]);
  });

  it('reports a parser that throws, or never started, as fatal', async () => {
    const { sent, deliver, endpoint: end } = endpoint();
    serveParser(end, () =>
      Promise.resolve(
        parser(() => {
          throw new Error('Go program has already exited');
        }),
      ),
    );
    deliver({ kind: 'parse', id: 1, bytes: round() });
    deliver({ kind: 'start', wasm: 'w' });
    await Promise.resolve();
    deliver({ kind: 'parse', id: 2, bytes: round() });
    expect(sent).toEqual([
      { kind: 'fatal', message: 'Parse asked before the parser started' },
      { kind: 'ready' },
      { kind: 'fatal', message: 'Go program has already exited' },
    ]);
  });

  it('reports a module that fails to load', async () => {
    const { sent, deliver, endpoint: end } = endpoint();
    serveParser(end, () => Promise.reject(new Error('404')));
    deliver({ kind: 'start', wasm: 'w' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toEqual([{ kind: 'fatal', message: '404' }]);
  });
});
