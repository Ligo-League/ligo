import { describe, expect, it } from 'vitest';
import { format } from './config.ts';
import { submitBatches, uploadRaw, type PutResult, type UploadDeps } from './upload.ts';

describe('submitBatches', () => {
  it('splits by count and by size, keeping the order', () => {
    const files = Array.from({ length: 5 }, (_, i) => ({ i, pad: 'x'.repeat(40) }));
    expect(submitBatches(files, 2).map((b) => b.map((f) => f.i))).toEqual([[0, 1], [2, 3], [4]]);
    expect(submitBatches(files, 64, 120).map((b) => b.length)).toEqual([2, 2, 1]);
    expect(submitBatches([])).toEqual([]);
  });
});

function fakeDeps(puts: Record<number, PutResult[]> = {}) {
  const calls = { sign: [] as number[][], stored: [] as number[][], put: [] as number[] };
  let active = 0;
  let most = 0;
  const statuses: [number, string][] = [];
  const deps: UploadDeps = {
    sign: (ids) => {
      calls.sign.push(ids);
      return Promise.resolve(
        ids.map((id) => ({
          id,
          url: `https://r2.invalid/${String(id)}`,
          method: 'PUT' as const,
          headers: {},
        })),
      );
    },
    put: async (id, _link, onProgress) => {
      calls.put.push(id);
      active += 1;
      most = Math.max(most, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      onProgress(1);
      active -= 1;
      return puts[id]?.shift() ?? 'ok';
    },
    stored: (ids) => {
      calls.stored.push(ids);
      return Promise.resolve(ids.map((id) => ({ id, status: 'stored' })));
    },
    onProgress: () => undefined,
    onStatus: (id, status) => statuses.push([id, status]),
  };
  return { deps, calls, statuses, most: () => most };
}

describe('uploadRaw', () => {
  it('sends 3 files at a time, signs and reports them in groups', async () => {
    const ids = Array.from({ length: 13 }, (_, i) => i + 1);
    const fake = fakeDeps();
    const result = await uploadRaw(ids, fake.deps);
    expect([...result.values()].every((s) => s === 'stored')).toBe(true);
    expect(fake.most()).toBe(3);
    expect(fake.calls.sign.flat().sort((x, y) => x - y)).toEqual(ids);
    expect(fake.calls.sign.length).toBeLessThanOrEqual(4);
    expect(fake.calls.stored.flat().sort((x, y) => x - y)).toEqual(ids);
    expect(fake.calls.stored.length).toBe(3);
  });

  it('tries a refused file once more with a new link, then gives up', async () => {
    const fake = fakeDeps({ 1: ['expired', 'ok'], 2: ['failed', 'failed'] });
    const result = await uploadRaw([1, 2], fake.deps);
    expect(result.get(1)).toBe('stored');
    expect(result.get(2)).toBe('failed');
    expect(fake.calls.sign).toContainEqual([1]);
    expect(fake.calls.stored.flat()).toEqual([1]);
  });

  it('counts a file the server did not find as failed', async () => {
    const fake = fakeDeps();
    fake.deps.stored = (ids) => Promise.resolve(ids.map((id) => ({ id, status: 'missing' })));
    expect((await uploadRaw([7], fake.deps)).get(7)).toBe('failed');
  });
});

describe('format', () => {
  it('fills the named parts', () => {
    expect(format('{n} manches sur {map}', { n: 3, map: 'Bank' })).toBe('3 manches sur Bank');
    expect(format('{missing}')).toBe('{missing}');
  });
});
