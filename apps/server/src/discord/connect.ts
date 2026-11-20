/** Waits between login attempts: quick at first, then every 5 minutes for as long as it takes. */
export const RETRY_DELAYS_MS: readonly number[] = [
  5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000,
];

/** The two log levels used here; pino's logger fits. */
export interface ConnectLog {
  info(fields: object, message: string): void;
  warn(fields: object, message: string): void;
}

export type ConnectResult = { ok: true } | { ok: false; hint: string; error: unknown };

/**
 * Logs the bot in, trying again after each failure that a later try can fix (Discord down, no
 * network): the website keeps running meanwhile and /healthz reports Discord as down. A refusal
 * that only the maintainer can fix (a wrong token, a missing intent: `hint` knows them) ends
 * the attempts with its hint.
 */
export async function keepConnecting(deps: {
  /** One login. discord.js cannot log a client in again after a failure: make a new one each time. */
  attempt: () => Promise<void>;
  hint: (error: unknown) => string | null;
  log: ConnectLog;
  wait: (ms: number) => Promise<void>;
}): Promise<ConnectResult> {
  for (let failures = 0; ; failures += 1) {
    try {
      await deps.attempt();
      if (failures > 0) deps.log.info({ attempts: failures + 1 }, 'Connected to Discord');
      return { ok: true };
    } catch (error) {
      const hint = deps.hint(error);
      if (hint) return { ok: false, hint, error };
      // The last delay repeats once the list runs out.
      const delay = RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)] ?? 300_000;
      deps.log.warn(
        { err: error, retryInSeconds: delay / 1000 },
        'Could not connect to Discord; the website stays up and the bot tries again',
      );
      await deps.wait(delay);
    }
  }
}
