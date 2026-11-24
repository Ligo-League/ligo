import { resolve } from 'node:path';
import { openDatabase } from '@ligo/db';
import { loadNodeParser } from '@ligo/parsers/node';
import { createDiskObjectStore, createR2ObjectStore, withReadFallback } from '@ligo/storage';
import { pino } from 'pino';
import { loadWorkerConfig } from './config.ts';
import { verifyReplay } from './jobs/verify-replay.ts';
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

const disk = createDiskObjectStore(resolve(config.storageDir), { upload: null, now: Date.now });
const objects = config.r2
  ? withReadFallback(createR2ObjectStore(config.r2, { now: Date.now }), disk)
  : disk;

// The R6 parser build, in worker threads with a memory cap and a timeout (design doc section 8).
// Without it, replay jobs fail and staff are told, rather than the worker refusing to start.
const loadedParser = await loadNodeParser({ distDir: resolve(config.parsersDir) });
if (!loadedParser.ok) logger.error({ error: loadedParser.error }, 'No R6 parser build');
const parser = loadedParser.ok ? loadedParser.parser : null;

const now = () => Date.now();
const handlers: JobHandlers = {
  ...(parser && {
    verify_replay: (payload) => verifyReplay({ db, objects, parser, now }, payload),
  }),
};
const stop = startWorker({ db, handlers, logger, now });
logger.info(
  { storage: config.r2 ? 'r2' : 'disk', parser: parser?.version ?? null },
  'Worker ready',
);

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Worker shutting down');
  void stop()
    .then(() => parser?.close())
    .finally(() => {
      db.$client.close();
      process.exit(0);
    });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
