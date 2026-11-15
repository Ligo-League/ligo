import { describe, expect, it } from 'vitest';
import { squareLogo } from './logo.ts';

// A 1 × 1 opaque PNG, and the same header with its picture data missing.
const DOT = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);

const sideOf = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
};

describe('squareLogo', () => {
  it('draws the logo into a square of the size asked', () => {
    const logo = squareLogo(DOT, 128);
    expect([...logo.slice(1, 4)].map((byte) => String.fromCharCode(byte)).join('')).toBe('PNG');
    expect(sideOf(logo)).toEqual([128, 128]);
  });

  it('refuses a file it cannot decode', () => {
    expect(() => squareLogo(DOT.slice(0, 33), 128)).toThrow(/could not be decoded/);
    expect(() => squareLogo(new Uint8Array([1, 2, 3]), 128)).toThrow(/could not be decoded/);
  });
});
