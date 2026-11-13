import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import type { ImageNode } from './node.ts';

// Satori does not read WOFF2, so the fonts are bundled as TTF files (see fonts/Inter-LICENSE.txt).
const font = (file: string) => readFileSync(new URL(`../fonts/${file}`, import.meta.url));
const FONTS = [
  {
    name: 'Inter',
    data: font('Inter-Regular.ttf'),
    weight: 400 as const,
    style: 'normal' as const,
  },
  { name: 'Inter', data: font('Inter-Bold.ttf'), weight: 700 as const, style: 'normal' as const },
];

/** Lays the tree out at the given width (the height follows the content) and returns a PNG. */
export async function renderPng(node: ImageNode, width: number): Promise<Uint8Array> {
  // Text becomes paths in the SVG, so resvg needs no font of its own.
  const svg = await satori(node, { width, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
}
