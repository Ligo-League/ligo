import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLocalAssetStore, MAX_ASSET_BYTES, PNG_HEADER_FOR_TESTS } from './store.ts';

function folder() {
  const root = mkdtempSync(join(tmpdir(), 'ligo-assets-'));
  mkdirSync(join(root, 'logos'));
  const png = new Uint8Array([...PNG_HEADER_FOR_TESTS, 1, 2, 3]);
  writeFileSync(join(root, 'logos', 'rck.png'), png);
  writeFileSync(join(root, 'logos', 'fake.png'), 'not an image');
  writeFileSync(join(root, 'logos', 'huge.png'), new Uint8Array(MAX_ASSET_BYTES + 1));
  writeFileSync(join(root, 'secret.png'), png);
  return { store: createLocalAssetStore(root), png };
}

describe('createLocalAssetStore', () => {
  it('reads a prepared logo by its key', async () => {
    const { store, png } = folder();
    expect(await store.read('logos/rck.png')).toEqual({ type: 'image/png', data: png });
  });

  it.each([
    ['a logo not prepared yet', 'logos/nova.png'],
    ['a file that is not a PNG', 'logos/fake.png'],
    ['a file far larger than a prepared logo', 'logos/huge.png'],
    ['a key outside the logos', 'secret.png'],
    ['a key that climbs out of the folder', 'logos/../secret.png'],
    ['an absolute path', '/etc/passwd'],
    ['another extension', 'logos/rck.webp'],
  ])('answers nothing for %s', async (_label, key) => {
    expect(await folder().store.read(key)).toBeNull();
  });
});
