import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyStorage } from './copy-to-r2.ts';
import { fakeObjectStore } from './object-store.ts';

// The one-off copy of what the server kept on disk to R2 (design doc section 13, maintainer
// 23 November 2026): evidence, uploaded logos and transcripts, under the same keys. It never
// deletes anything, skips what is already there, and can run again.

const SHA = 'a'.repeat(64);

function storageDir() {
  const root = mkdtempSync(join(tmpdir(), 'ligo-storage-'));
  const write = (key: string, bytes: number[]) => {
    const path = join(root, key);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, new Uint8Array(bytes));
  };
  write(`evidence/3/${SHA}.png`, [1, 2]);
  write(`uploads/${SHA}.png`, [3]);
  write('transcripts/1/7.json', [123, 125]);
  write(`evidence/3/${SHA}.png.partial`, [9]);
  write('notes.txt', [9]);
  return root;
}

describe('copyStorage', () => {
  it('copies every kept file under its key, with its type, and nothing else', async () => {
    const target = fakeObjectStore();
    const report = await copyStorage(storageDir(), target, { dryRun: false });
    expect([...target.objects.keys()].sort()).toEqual([
      `evidence/3/${SHA}.png`,
      'transcripts/1/7.json',
      `uploads/${SHA}.png`,
    ]);
    expect(target.types.get('transcripts/1/7.json')).toBe('application/json');
    expect(target.types.get(`evidence/3/${SHA}.png`)).toBe('image/png');
    expect(report).toEqual({ copied: 3, present: 0, ignored: 2 });
  });

  it('skips what R2 already has, so it can run again', async () => {
    const root = storageDir();
    const target = fakeObjectStore();
    await copyStorage(root, target, { dryRun: false });
    expect(await copyStorage(root, target, { dryRun: false })).toEqual({
      copied: 0,
      present: 3,
      ignored: 2,
    });
  });

  it('only counts on a dry run', async () => {
    const target = fakeObjectStore();
    expect(await copyStorage(storageDir(), target, { dryRun: true })).toEqual({
      copied: 3,
      present: 0,
      ignored: 2,
    });
    expect(target.objects.size).toBe(0);
  });
});
