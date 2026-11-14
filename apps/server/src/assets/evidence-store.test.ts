import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createLocalEvidenceStore } from './evidence-store.ts';

const KEY = `evidence/3/${'a'.repeat(64)}.png`;

function folder(maxBytes = 1000) {
  const root = mkdtempSync(join(tmpdir(), 'ligo-evidence-'));
  const logger = { error: vi.fn() };
  return { root, logger, store: createLocalEvidenceStore(root, maxBytes, logger) };
}

describe('createLocalEvidenceStore', () => {
  it('keeps a file under its key and reads it back, leaving no partial file', async () => {
    const { root, store } = folder();
    const data = new Uint8Array([1, 2, 3]);
    await store.put(KEY, data);
    expect(await store.read(KEY)).toEqual(data);
    expect(readdirSync(join(root, 'evidence', '3'))).toEqual([`${'a'.repeat(64)}.png`]);
  });

  it.each([
    ['a key outside the evidence', 'logos/rck.png'],
    ['a key that climbs out of the folder', `evidence/3/../../${'a'.repeat(64)}.png`],
    ['a name that is not a hash', 'evidence/3/score.png'],
    ['a type that is never kept', `evidence/3/${'a'.repeat(64)}.svg`],
  ])('refuses %s, to write or to read', async (_name, key) => {
    const { store } = folder();
    await expect(store.put(key, new Uint8Array([1]))).rejects.toThrow('Not an evidence key');
    expect(await store.read(key)).toBeNull();
  });

  it('answers null for a missing file or one over the size limit', async () => {
    const { store } = folder(2);
    expect(await store.read(KEY)).toBeNull();
    await store.put(KEY, new Uint8Array([1, 2, 3]));
    expect(await store.read(KEY)).toBeNull();
  });

  it('logs a write that fails, by key only, and rejects', async () => {
    const { logger } = folder();
    const blocked = createLocalEvidenceStore('/proc/ligo-cannot-write-here', 1000, logger);
    await expect(blocked.put(KEY, new Uint8Array([1]))).rejects.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ key: KEY }),
      'Evidence could not be stored',
    );
  });
});
