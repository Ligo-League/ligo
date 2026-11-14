import { createHash } from 'node:crypto';

// A roster's logo, uploaded at registration (design doc section 7: a transparent PNG). The file
// is untrusted: its own bytes say whether it is a PNG and whether it has transparency, read from
// the PNG's chunks without decoding the picture. It is kept in the server's storage under its
// content's hash, so the same file is stored once.

export const LOGO_MAX_BYTES = 1024 * 1024;
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

/** The chunks of a PNG with nothing to show: enough for the checks above, for tests only. */
export function pngForTests(options: {
  width: number;
  height: number;
  colorType: number;
  trns?: boolean;
}): Uint8Array {
  const chunk = (type: string, body: number[]) => {
    const length = [24, 16, 8, 0].map((shift) => (body.length >>> shift) & 0xff);
    // The CRC is not checked here: four zero bytes.
    // Chunk types are four ASCII letters.
    const name = [0, 1, 2, 3].map((index) => type.charCodeAt(index));
    return [...length, ...name, ...body, 0, 0, 0, 0];
  };
  const u32 = (value: number) => [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff);
  return new Uint8Array([
    ...SIGNATURE,
    ...chunk('IHDR', [
      ...u32(options.width),
      ...u32(options.height),
      8,
      options.colorType,
      0,
      0,
      0,
    ]),
    ...(options.trns ? chunk('tRNS', [0]) : []),
    ...chunk('IDAT', [0]),
    ...chunk('IEND', []),
  ]);
}
