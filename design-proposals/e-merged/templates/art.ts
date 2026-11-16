// Images E adds over A: map art, operator icons, player photos. The mockup draws flat labelled
// placeholders with the production aspect ratios; production loads Ubisoft's map and operator
// images from packages/titles (allowed on a match-reporting site, design doc section 7), and the
// photo a player uploaded, or Ligo's default image.

import * as D from '../../_data/index.ts';
import { html, type Raw } from '../../_build/lib.ts';

const hueOf = (s: string) => [...s].reduce((n, c) => n + c.charCodeAt(0) * 7, 0) % 360;

/** Map art at 16:9 (veto cards), 4:1 (match banner) or a small thumb. */
export function mapArt(map: string, opts: { ratio?: '16x9' | '4x1' | 'thumb'; label?: boolean; cls?: string } = {}): Raw {
  const ratio = opts.ratio ?? '16x9';
  const h = hueOf(map);
  return html`<span class="mapart r-${ratio} ${opts.cls ?? ''}" style="--map-h:${h}" role="img" aria-label="Image de la carte ${map}">
    <span class="ma-grid" aria-hidden="true"></span>${opts.label === false ? '' : html`<span class="ma-name">${map}</span>`}
  </span>`;
}

const ATTACKERS = new Set(['Ash', 'Thermite', 'Hibana', 'Ace', 'Thatcher', 'Twitch', 'Iana', 'Zofia', 'Nøkk', 'Flores', 'Grim', 'Brava', 'Dokkaebi']);

/** Operator icon: a square tile, warm for attack and cool for defence, with the name's start. */
export function opIcon(op: string, size = 22, opts: { swapped?: string } = {}): Raw {
  const atk = ATTACKERS.has(op);
  const abbr = op.normalize('NFD').replace(/[̀-ͯ]/g, '').replace('ø', 'o').slice(0, 2).toUpperCase();
  return html`<span class="op ${atk ? 'op-atk' : 'op-def'}${opts.swapped ? ' op-sw' : ''}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px" title="${op}${opts.swapped ? ` (échange : ${opts.swapped} → ${op})` : ''}" role="img" aria-label="${op}${opts.swapped ? `, après échange depuis ${opts.swapped}` : ''}">${abbr}</span>`;
}

/** A player's photo, or Ligo's default image when none was uploaded. */
export function photo(slug: string, size = 96): Raw {
  const p = D.players.get(slug);
  const has = D.playersWithPhoto.has(slug);
  if (has && p) {
    const t = D.teamOf(slug);
    const [c1, c2] = t?.colors ?? ['#5c6268', '#2f3337'];
    return html`<span class="photo has" style="width:${size}px;height:${size}px;--p1:${c1};--p2:${c2}" role="img" aria-label="Photo de ${p.tag}"><span class="ph-in" aria-hidden="true">${p.tag.slice(0, 1)}</span>${size >= 40 ? html`<span class="ph-tag">photo</span>` : ''}</span>`;
  }
  return html`<span class="photo default" style="width:${size}px;height:${size}px" role="img" aria-label="Image par défaut"><svg viewBox="0 0 40 40" width="${Math.round(size * 0.7)}" height="${Math.round(size * 0.7)}" aria-hidden="true"><circle cx="20" cy="15" r="7" fill="currentColor"/><path d="M6 38c1.5-8 7-12 14-12s12.5 4 14 12z" fill="currentColor"/></svg></span>`;
}

export const mvpMark = (): Raw => html`<abbr class="mvp" title="Joueur de la manche (MVP)">MVP</abbr>`;
