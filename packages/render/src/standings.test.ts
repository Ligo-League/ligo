import { describe, expect, it } from 'vitest';
import type { ImageChild, ImageNode } from './node.ts';
import { renderStandingsPng } from './standings.ts';
import {
  standingsImage,
  STANDINGS_IMAGE_WIDTH,
  type StandingsImageInput,
} from './templates/standings.ts';
import { DEFAULT_THEME, resolveTheme } from './theme.ts';

const row = (rank: number, name: string, diff: number, form: ('W' | 'L')[]) => ({
  rank,
  name,
  colors: ['#112233', '#FFFFFF'],
  played: 6,
  wins: 5,
  losses: 1,
  scoreFor: 26,
  scoreAgainst: 26 - diff,
  diff,
  points: 15,
  form,
});
const INPUT: StandingsImageInput = {
  title: 'Ligue 1',
  subtitle: 'LFR · Saison 3',
  headers: {
    rank: '#',
    team: 'Équipe',
    played: 'J',
    wins: 'V',
    losses: 'D',
    for: 'F',
    against: 'C',
    diff: 'Diff',
    points: 'PTS',
    form: 'Forme',
  },
  rows: [row(1, 'Civitas Esport', 11, ['W', 'L', 'W']), row(2, 'Évry Élite', -4, [])],
};

/** Every piece of text in the tree, in reading order. */
function texts(node: ImageChild): string[] {
  if (typeof node !== 'object') return [String(node)];
  return node.props.children.flatMap(texts);
}
/** Every background colour in the tree, in reading order. */
function backgrounds(node: ImageChild): string[] {
  if (typeof node !== 'object') return [];
  const own = node.props.style.backgroundColor;
  return [...(typeof own === 'string' ? [own] : []), ...node.props.children.flatMap(backgrounds)];
}
const boxes = (node: ImageNode): ImageNode[] => [
  node,
  ...node.props.children.flatMap((child) => (typeof child === 'object' ? boxes(child) : [])),
];

describe('standingsImage', () => {
  it('shows the title, the translated headers and every row in order', () => {
    expect(texts(standingsImage(INPUT))).toEqual([
      'LFR · Saison 3',
      'Ligue 1',
      ...['#', 'ÉQUIPE', 'J', 'V', 'D', 'F', 'C', 'DIFF', 'PTS', 'FORME'],
      ...['1', 'Civitas Esport', '6', '5', '1', '26', '15', '+11', '15'],
      ...['2', 'Évry Élite', '6', '5', '1', '26', '30', '-4', '15'],
    ]);
  });

  it('draws the team colours and five form slots per row, latest results last', () => {
    const colours = backgrounds(standingsImage(INPUT));
    const { win, loss, surface } = DEFAULT_THEME;
    expect(colours.filter((colour) => colour === '#112233')).toHaveLength(2);
    // Row 1 has three results and two empty slots; row 2 has five empty slots.
    expect(colours.filter((colour) => colour === win)).toHaveLength(2);
    expect(colours.filter((colour) => colour === loss)).toHaveLength(1);
    expect(colours.join(' ')).toContain([win, loss, win, surface, surface].join(' '));
  });

  it('keeps only the five latest results', () => {
    const long = { ...INPUT, rows: [row(1, 'Alpha', 1, ['L', 'L', 'W', 'W', 'W', 'W', 'W'])] };
    const colours = backgrounds(standingsImage(long));
    expect(colours.filter((colour) => colour === DEFAULT_THEME.loss)).toHaveLength(0);
    expect(colours.filter((colour) => colour === DEFAULT_THEME.win)).toHaveLength(5);
  });

  it('gives every box an explicit flex display, which Satori requires', () => {
    for (const node of boxes(standingsImage(INPUT))) expect(node.props.style.display).toBe('flex');
  });

  it("uses the league's colours where it sets them", () => {
    const themed = standingsImage({ ...INPUT, theme: { accent: '#00FF00', muted: undefined } });
    expect(backgrounds(themed)).toContain('#00FF00');
    expect(resolveTheme({ accent: '#00FF00', muted: undefined })).toEqual({
      ...DEFAULT_THEME,
      accent: '#00FF00',
    });
  });
});

describe('renderStandingsPng', () => {
  // Bytes 16 to 23 of a PNG hold the width and the height, big-endian.
  const size = (png: Uint8Array) => {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  };

  it('renders a PNG 1200 px wide whose height follows the number of rows', async () => {
    const png = await renderStandingsPng(INPUT);
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const two = size(png);
    expect(two.width).toBe(STANDINGS_IMAGE_WIDTH);

    const twelve = {
      ...INPUT,
      rows: Array.from({ length: 12 }, (_, i) => row(i + 1, `Team ${i}`, 0, [])),
    };
    const tall = size(await renderStandingsPng(twelve));
    expect(tall.width).toBe(STANDINGS_IMAGE_WIDTH);
    expect(tall.height - two.height).toBe(10 * 60);
  });

  it('returns the cached image for the same input and a new one when it changes', async () => {
    const first = await renderStandingsPng(INPUT);
    expect(await renderStandingsPng(structuredClone(INPUT))).toBe(first);
    const changed = await renderStandingsPng({ ...INPUT, title: 'Ligue 2' });
    expect(changed).not.toBe(first);
    expect(Buffer.from(changed).equals(Buffer.from(first))).toBe(false);
  });
});
