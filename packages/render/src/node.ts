// Satori lays out React-style element trees. The server runs TypeScript directly, which has no
// JSX, so templates build the same trees with `box` and `text` instead.

export type Style = Record<string, string | number>;
export type ImageChild = ImageNode | string | number;

export interface ImageNode {
  type: 'div';
  props: { style: Style; children: ImageChild[] };
}

/** A flex container. Satori requires an explicit `display: flex` on every element with children. */
export function box(style: Style, ...children: ImageChild[]): ImageNode {
  return { type: 'div', props: { style: { display: 'flex', ...style }, children } };
}

/** A piece of text with its own style. */
export function text(style: Style, content: string | number): ImageNode {
  return box(style, String(content));
}
