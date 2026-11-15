import { Resvg } from '@resvg/resvg-js';

// Logos uploaded on the website are drawn into a square at the size images and pages use (design
// doc section 11), centred, transparent around. resvg decodes the PNG: no other image library.

/**
 * The logo drawn into a `size` × `size` PNG. Throws when the file cannot be decoded: resvg skips
 * an image it cannot read, which leaves nothing but transparency.
 */
export function squareLogo(png: Uint8Array, size: number): Uint8Array {
  const href = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}">` +
    `<image href="${href}" width="${String(size)}" height="${String(size)}" ` +
    'preserveAspectRatio="xMidYMid meet"/></svg>';
  const rendered = new Resvg(svg).render();
  const { pixels } = rendered;
  let visible = false;
  // RGBA: every fourth byte is a pixel's alpha.
  for (let index = 3; index < pixels.length && !visible; index += 4) visible = pixels[index] !== 0;
  if (!visible) throw new Error('The logo could not be decoded, or shows nothing');
  return rendered.asPng();
}
