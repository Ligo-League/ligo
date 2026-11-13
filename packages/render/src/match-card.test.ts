import { describe, expect, it } from 'vitest';
import type { ImageChild, ImageNode } from './node.ts';
import { renderMatchCardPng } from './match-card.ts';
import { matchCardImage, MATCH_CARD_SIZE, type MatchCardInput } from './templates/match-card.ts';

const INPUT: MatchCardInput = {
  eyebrow: 'LFR · Saison 3',
  title: 'Ligue 1 · Semaine 3',
  label: 'Match programmé',
  teams: [
    { name: 'Bravo', colors: ['#112233', '#FFFFFF'] },
    { name: 'Charlie Esport', colors: ['#AA0000'] },
  ],
  center: 'VS',
  winner: null,
  lines: ['jeudi 5 novembre', '21:00'],
};

function texts(node: ImageChild): string[] {
  if (typeof node !== 'object') return [String(node)];
  if (node.type === 'img') return [];
  return node.props.children.flatMap(texts);
}
function boxes(node: ImageChild): ImageNode[] {
  if (typeof node !== 'object' || node.type === 'img') return [];
  return [node, ...node.props.children.flatMap(boxes)];
}
const opacities = (node: ImageNode) =>
  boxes(node).flatMap((child) =>
    child.type === 'div' && child.props.style.opacity !== undefined
      ? [child.props.style.opacity]
      : [],
  );

describe('matchCardImage', () => {
  it('shows the league, the match, both teams and the time, in reading order', () => {
    expect(texts(matchCardImage(INPUT))).toEqual([
      'LFR · Saison 3',
      'Ligue 1 · Semaine 3',
      'MATCH PROGRAMMÉ',
      'Bravo',
      'VS',
      'Charlie Esport',
      'jeudi 5 novembre',
      '21:00',
    ]);
  });

  it('dims the loser of a result, and nobody before one', () => {
    expect(opacities(matchCardImage(INPUT))).toEqual([1, 1]);
    const result = { ...INPUT, center: '7 – 5', winner: 0 as const };
    expect(opacities(matchCardImage(result))).toEqual([1, 0.45]);
  });

  it('gives every box an explicit flex display, which Satori requires', () => {
    for (const node of boxes(matchCardImage(INPUT))) {
      if (node.type === 'div') expect(node.props.style.display).toBe('flex');
    }
  });
});

describe('renderMatchCardPng', () => {
  it('renders a square PNG, 1080 px each way, and caches it', async () => {
    const png = await renderMatchCardPng(INPUT);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([MATCH_CARD_SIZE, MATCH_CARD_SIZE]);
    expect(await renderMatchCardPng(structuredClone(INPUT))).toBe(png);
    expect(await renderMatchCardPng({ ...INPUT, lines: ['vendredi'] })).not.toBe(png);
  });
});
