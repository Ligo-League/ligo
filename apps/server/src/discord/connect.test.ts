import { describe, expect, it } from 'vitest';
import { keepConnecting, RETRY_DELAYS_MS, type ConnectLog } from './connect.ts';
import { loginHint } from './login-hint.ts';

// The website stays up while Discord is out of reach (an outage, the VPS's network): the bot
// keeps trying in the background. Only a refusal that a retry cannot fix stops the server.

function harness(failures: Error[]) {
  const waits: number[] = [];
  const lines: { level: 'info' | 'warn'; fields: object; message: string }[] = [];
  const log: ConnectLog = {
    info: (fields, message) => lines.push({ level: 'info', fields, message }),
    warn: (fields, message) => lines.push({ level: 'warn', fields, message }),
  };
  let attempts = 0;
  const run = () =>
    keepConnecting({
      attempt: () => {
        const failure = failures[attempts];
        attempts += 1;
        return failure === undefined ? Promise.resolve() : Promise.reject(failure);
      },
      hint: loginHint,
      log,
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
  return { run, waits, lines, attempts: () => attempts };
}

const offline = () => new Error('getaddrinfo EAI_AGAIN discord.com');

describe('keepConnecting', () => {
  it('connects at once without waiting or warning', async () => {
    const { run, waits, lines, attempts } = harness([]);
    expect(await run()).toEqual({ ok: true });
    expect(attempts()).toBe(1);
    expect(waits).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('retries a network failure, waiting longer each time up to the last delay', async () => {
    const failures = Array.from({ length: RETRY_DELAYS_MS.length + 2 }, offline);
    const { run, waits, lines, attempts } = harness(failures);
    expect(await run()).toEqual({ ok: true });
    expect(attempts()).toBe(failures.length + 1);
    const last = RETRY_DELAYS_MS.at(-1);
    expect(waits).toEqual([...RETRY_DELAYS_MS, last, last]);
    expect(waits).toEqual([...waits].sort((a, b) => a - b));
    expect(lines.filter((line) => line.level === 'warn')).toHaveLength(failures.length);
    expect(lines.at(-1)).toMatchObject({
      level: 'info',
      fields: { attempts: failures.length + 1 },
    });
  });

  it('starts at 5 seconds and never waits more than 5 minutes', () => {
    expect(RETRY_DELAYS_MS[0]).toBe(5_000);
    expect(Math.max(...RETRY_DELAYS_MS)).toBe(300_000);
  });

  it('stops on a refused token, with the hint, without retrying', async () => {
    const refused = Object.assign(new Error('An invalid token was provided.'), {
      code: 'TokenInvalid',
    });
    const { run, waits, attempts } = harness([offline(), refused]);
    const result = await run();
    expect(result).toMatchObject({ ok: false, error: refused });
    expect(!result.ok && result.hint).toMatch(/DISCORD_TOKEN/);
    expect(attempts()).toBe(2);
    expect(waits).toEqual([RETRY_DELAYS_MS[0]]);
  });

  it('stops on a missing intent', async () => {
    const { run } = harness([new Error('Used disallowed intents')]);
    const result = await run();
    expect(!result.ok && result.hint).toMatch(/Server Members Intent/);
  });
});
