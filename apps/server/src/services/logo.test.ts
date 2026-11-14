import { describe, expect, it } from 'vitest';
import { checkLogo, LOGO_MAX_BYTES, logoKeyOf, pngForTests } from './logo.ts';

// A roster's logo at registration (design doc section 7: a transparent PNG). Uploaded files are
// untrusted: the bytes say what the file is, not its name or the type the browser sent.

describe('checkLogo', () => {
  it('accepts a PNG with an alpha channel, or with a transparent colour', () => {
    expect(checkLogo(pngForTests({ width: 512, height: 512, colorType: 6 }))).toEqual({
      ok: true,
      width: 512,
      height: 512,
    });
    expect(checkLogo(pngForTests({ width: 256, height: 128, colorType: 4 })).ok).toBe(true);
    expect(checkLogo(pngForTests({ width: 256, height: 256, colorType: 3, trns: true })).ok).toBe(
      true,
    );
  });

  it('refuses a PNG with no transparency', () => {
    expect(checkLogo(pngForTests({ width: 512, height: 512, colorType: 2 }))).toEqual({
      ok: false,
      error: 'logo_not_transparent',
    });
    expect(checkLogo(pngForTests({ width: 512, height: 512, colorType: 3 }))).toEqual({
      ok: false,
      error: 'logo_not_transparent',
    });
  });

  it('refuses a picture too small or too large to show well', () => {
    for (const [width, height] of [
      [63, 512],
      [512, 4097],
    ] as const) {
      expect(checkLogo(pngForTests({ width, height, colorType: 6 }))).toEqual({
        ok: false,
        error: 'logo_dimensions',
      });
    }
  });

  it('refuses what is no PNG, a cut file, and a file over the size limit', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(checkLogo(jpeg)).toEqual({ ok: false, error: 'invalid_logo' });
    const cut = pngForTests({ width: 512, height: 512, colorType: 6 }).slice(0, 20);
    expect(checkLogo(cut)).toEqual({ ok: false, error: 'invalid_logo' });
    const big = new Uint8Array(LOGO_MAX_BYTES + 1);
    big.set(pngForTests({ width: 512, height: 512, colorType: 6 }));
    expect(checkLogo(big)).toEqual({ ok: false, error: 'logo_too_big' });
  });
});

describe('logoKeyOf', () => {
  it('names a logo by its content', () => {
    const png = pngForTests({ width: 512, height: 512, colorType: 6 });
    expect(logoKeyOf(png)).toMatch(/^uploads\/[0-9a-f]{64}\.png$/);
    expect(logoKeyOf(png)).toBe(logoKeyOf(png.slice()));
  });
});
