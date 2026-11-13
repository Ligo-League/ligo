// Satori lays out React-style element trees. The server runs TypeScript directly, which has no
// JSX, so templates build the same trees with `box` and `text` instead.

export type Style = Record<string, string | number>;
export type ImageChild = ImageNode | string | number;

export interface BoxNode {
  type: 'div';
  props: { style: Style; children: ImageChild[] };
}

/** A picture, such as a logo. Satori needs its size up front. */
export interface PictureNode {
  type: 'img';
  props: { src: string; width: number; height: number; style: Style };
}

export type ImageNode = BoxNode | PictureNode;

/** Image bytes to embed. Only PNG: resvg cannot decode WebP. */
export interface EmbeddedImage {
  type: 'image/png';
  data: Uint8Array;
}

/** A flex container. Satori requires an explicit `display: flex` on every element with children. */
export function box(style: Style, ...children: ImageChild[]): BoxNode {
  return { type: 'div', props: { style: { display: 'flex', ...style }, children } };
}

/** A piece of text with its own style. */
export function text(style: Style, content: string | number): BoxNode {
  return box(style, String(content));
}

/** A square picture, scaled to fit without being cropped. */
export function picture(image: EmbeddedImage, size: number): PictureNode {
  return {
    type: 'img',
    props: {
      src: `data:${image.type};base64,${Buffer.from(image.data).toString('base64')}`,
      width: size,
      height: size,
      style: { width: size, height: size, objectFit: 'contain' },
    },
  };
}
