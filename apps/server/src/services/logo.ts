import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';

// A roster's logo, uploaded at registration (design doc section 7: a transparent PNG). The file
// is untrusted: its own bytes say whether it is a PNG and whether it has transparency, read from
// the PNG's chunks without decoding the picture. It is kept in the server's storage under its
// content's hash, so the same file is stored once.

export const LOGO_MAX_BYTES = 1024 * 1024;
/** The side of the square a logo is kept at: the size images and pages use. */
export const LOGO_SIZE = 128;
const MIN_SIDE = 64;
const MAX_SIDE = 4096;
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type LogoError =
  'invalid_logo' | 'logo_too_big' | 'logo_not_transparent' | 'logo_dimensions';

const typeAt = (data: Uint8Array, offset: number) =>
  String.fromCharCode(...data.subarray(offset, offset + 4));

export function checkLogo(
  data: Uint8Array,
): { ok: true; width: number; height: number } | { ok: false; error: LogoError } {
  if (data.length > LOGO_MAX_BYTES) return { ok: false, error: 'logo_too_big' };
  if (data.length < 33 || !SIGNATURE.every((byte, index) => data[index] === byte)) {
    return { ok: false, error: 'invalid_logo' };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // The first chunk is always IHDR: width, height, bit depth, then the colour type.
  if (view.getUint32(8) !== 13 || typeAt(data, 12) !== 'IHDR') {
    return { ok: false, error: 'invalid_logo' };
  }
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const colorType = data[25];
  if ([width, height].some((side) => side < MIN_SIDE || side > MAX_SIDE)) {
    return { ok: false, error: 'logo_dimensions' };
  }
  // Colour types 4 and 6 carry an alpha channel; the others may name a transparent colour in a
  // tRNS chunk, which comes before the picture data.
  if (colorType === 4 || colorType === 6) return { ok: true, width, height };
  for (let offset = 33; offset + 8 <= data.length;) {
    const length = view.getUint32(offset);
    const type = typeAt(data, offset + 4);
    if (type === 'tRNS') return { ok: true, width, height };
    if (type === 'IDAT' || type === 'IEND') break;
    offset += 12 + length;
  }
  return { ok: false, error: 'logo_not_transparent' };
}

/** Where a logo is kept: by its content. */
export function logoKeyOf(data: Uint8Array): string {
  return `uploads/${createHash('sha256').update(data).digest('hex')}.png`;
}

// Bytes per pixel of each PNG colour type at 8 bits: grey, RGB, palette, grey + alpha, RGBA.
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * A real PNG of one opaque colour, for tests: it decodes, so the logo conversion draws it. A
 * palette image (type 3) has a black entry and a white one, and is drawn in white; `trns` makes
 * the black entry transparent.
 */
export function pngForTests(options: {
  width: number;
  height: number;
  colorType: number;
  trns?: boolean;
}): Uint8Array {
  const u32 = (value: number) => [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff);
  const chunk = (type: string, body: Uint8Array) => {
    // Chunk types are four ASCII letters.
    const name = Uint8Array.from([0, 1, 2, 3].map((index) => type.charCodeAt(index)));
    const crc = crc32(Buffer.concat([name, body]));
    return Buffer.concat([
      Uint8Array.from(u32(body.length)),
      name,
      body,
      Uint8Array.from(u32(crc)),
    ]);
  };
  const { width, height, colorType } = options;
  const palette = colorType === 3;
  // Every row: no filter, then each pixel white and opaque (palette entry 1).
  const row = Buffer.alloc(1 + width * (CHANNELS[colorType] ?? 4), palette ? 1 : 0xff);
  row[0] = 0;
  const rows = Buffer.concat(Array.from({ length: height }, () => row));
  const header = Uint8Array.from([...u32(width), ...u32(height), 8, colorType, 0, 0, 0]);
  return new Uint8Array(
    Buffer.concat([
      Uint8Array.from(SIGNATURE),
      chunk('IHDR', header),
      ...(palette ? [chunk('PLTE', Uint8Array.from([0, 0, 0, 255, 255, 255]))] : []),
      ...(options.trns ? [chunk('tRNS', Uint8Array.from([0]))] : []),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', new Uint8Array(0)),
    ]),
  );
}
