import { resolve } from 'node:path';
import { openDatabase } from '@ligo/db';
import { pino } from 'pino';
import { loadWorkerConfig } from './config.ts';
import { startWorker, type JobHandlers } from './runner.ts';

// The job worker (design doc sections 3 and 8): a second process next to the server, sharing its
// SQLite file. It verifies replays and stitches games; it never talks to Discord, and never
// migrates the database (the server does, when it starts).

const loaded = loadWorkerConfig(process.env);
if (!loaded.ok) {
  console.error(`The worker cannot start: ${loaded.errors.join('; ')}`);
  process.exit(1);
}
const { config } = loaded;
const logger = pino({ level: config.logLevel });

const db = openDatabase(resolve(config.databasePath));

const handlers: JobHandlers = {};
const stop = startWorker({ db, handlers, logger, now: () => Date.now() });
logger.info({ storage: config.r2 ? 'r2' : 'disk' }, 'Worker ready');

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Worker shutting down');
  void stop().finally(() => {
    db.$client.close();
    process.exit(0);
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
