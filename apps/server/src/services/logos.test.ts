import { describe, expect, it } from 'vitest';
import { fakeAssetStore, PNG_HEADER_FOR_TESTS, type AssetStore } from '../assets/store.ts';
import { loadLogos } from './logos.ts';

describe('loadLogos', () => {
  it('reads each logo once and leaves out those that are missing', async () => {
    const reads: string[] = [];
    const store = fakeAssetStore({ 'logos/rck.png': PNG_HEADER_FOR_TESTS });
    const counting: AssetStore = {
      read(key) {
        reads.push(key);
        return store.read(key);
      },
    };
    const logos = await loadLogos(counting, [
      'logos/rck.png',
      null,
      'logos/rck.png',
      'logos/x.png',
    ]);
    expect([...logos.keys()]).toEqual(['logos/rck.png']);
    expect(logos.get('logos/rck.png')).toEqual({ type: 'image/png', data: PNG_HEADER_FOR_TESTS });
    expect(reads).toEqual(['logos/rck.png', 'logos/x.png']);
  });
});
