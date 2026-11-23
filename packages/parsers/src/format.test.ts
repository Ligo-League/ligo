import { describe, expect, it } from 'vitest';
import { isAcceptedVersion, readManifest } from './manifest.ts';
import { acceptsR6, R6_HEAD_BYTES } from './r6/format.ts';
import { sha256Hex } from './sha256.ts';

// What every side checks before and around a parse: an R6 round's name and first bytes, the
// file's SHA-256, and the build manifest the server pins (design doc sections 8 and 10).

const DISSECT = [0x64, 0x69, 0x73, 0x73, 0x65, 0x63, 0x74, 0x00];

describe('acceptsR6', () => {
  it('takes a .rec file starting with dissect, or with zstd before Y8', () => {
    expect(R6_HEAD_BYTES).toBe(8);
    expect(acceptsR6('Match-2026-05-15_17-36-34-16324-R01.rec', new Uint8Array(DISSECT))).toBe(
      true,
    );
    expect(acceptsR6('ROUND.REC', new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 0, 0, 0]))).toBe(true);
  });

  it.each([
    ['another extension', 'Match-R01.dem', DISSECT],
    ['other bytes', 'Match-R01.rec', [0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]],
    ['too few bytes', 'Match-R01.rec', DISSECT.slice(0, 4)],
  ])('refuses %s', (_name, name, head) => {
    expect(acceptsR6(name, new Uint8Array(head))).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('gives the standard digest', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('readManifest', () => {
  const version = 'r6-e2d5f6f70cf026fc';

  it('reads the build that parsers/build-r6.sh wrote', () => {
    expect(readManifest({ version, wasm: `${version}.wasm` })).toEqual({
      title: 'r6',
      version,
      wasm: `${version}.wasm`,
    });
  });

  it.each([
    ['a file of another build', { version, wasm: 'r6-0000000000000000.wasm' }],
    ['a path outside the folder', { version, wasm: `../${version}.wasm` }],
    ['another field', { version, wasm: `${version}.wasm`, extra: 1 }],
    ['no manifest at all', null],
  ])('refuses %s', (_name, json) => {
    expect(readManifest(json)).toBeNull();
  });

  it('accepts JSON only from a listed version', () => {
    expect(isAcceptedVersion([version], version)).toBe(true);
    expect(isAcceptedVersion([version], 'r6-0000000000000000')).toBe(false);
  });
});
