import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { loadConfig } from '../config.ts';
import { EVIDENCE_KEY } from './evidence-store.ts';
import type { ObjectStore } from './object-store.ts';
import { createR2ObjectStore } from './r2-store.ts';
import { TRANSCRIPT_KEY } from './transcript-store.ts';

// The one-off copy of the files the server kept on disk to R2 (design doc section 13; maintainer,
// 23 November 2026): score screenshots, uploaded logos and channel transcripts, under the same
// keys. It never deletes anything on either side, skips what R2 already has, and can run again.
// Until it has run, the server reads what R2 lacks from the disk (`withReadFallback`).
//
//   docker compose exec server node apps/server/src/assets/copy-to-r2.ts [--dry-run]
//
// It reads the R2 settings from the environment and prints keys and counts only: never a secret.

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  json: 'application/json',
};

export interface CopyReport {
  copied: number;
  /** Already in R2 with the same size. */
  present: number;
  /** Files that are no kept file's (partial writes, anything else). */
  ignored: number;
}

export async function copyStorage(
  root: string,
  target: ObjectStore,
  options: { dryRun: boolean; onCopy?: (key: string) => void },
): Promise<CopyReport> {
  const report: CopyReport = { copied: 0, present: 0, ignored: 0 };
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
  for (const key of files) {
    const type = TYPES[key.split('.').at(-1) ?? ''];
    if (!type || !(EVIDENCE_KEY.test(key) || TRANSCRIPT_KEY.test(key))) {
      report.ignored += 1;
      continue;
    }
    const size = (await stat(join(root, key))).size;
    if ((await target.size(key)) === size) {
      report.present += 1;
      continue;
    }
    if (!options.dryRun) {
      await target.put(key, new Uint8Array(await readFile(join(root, key))), type);
    }
    options.onCopy?.(key);
    report.copied += 1;
  }
  return report;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const loaded = loadConfig(process.env);
  if (!loaded.ok) throw new Error(loaded.errors.join('; '));
  const { r2, storageDir } = loaded.config;
  if (!r2)
    throw new Error(
      'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are not set',
    );
  const target = createR2ObjectStore(r2, { now: Date.now });
  const report = await copyStorage(resolve(storageDir), target, {
    dryRun,
    onCopy: (key) => {
      console.log(`${dryRun ? 'would copy' : 'copied'} ${key}`);
    },
  });
  console.log(
    `${dryRun ? 'Dry run: ' : ''}${String(report.copied)} ${dryRun ? 'to copy' : 'copied'}, ` +
      `${String(report.present)} already in R2, ${String(report.ignored)} ignored`,
  );
}

if (import.meta.main) await main();
