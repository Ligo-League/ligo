// Shared template helpers. Templates are plain template literals, as Hono's `html` tag will be in
// production: interpolated values are escaped, only other `html` results are inserted raw.

import type { Nat, Team } from '../_data/index.ts';

export class Raw {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

type Value = Raw | string | number | null | undefined | false | true | Value[];

function render(v: Value): string {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return escape(String(v));
}

/** `html\`<p>${text}</p>\`` escapes `text`; nest `html` results freely. */
export function html(strings: TemplateStringsArray, ...values: Value[]): Raw {
  let out = strings[0] ?? '';
  values.forEach((v, i) => {
    out += render(v) + (strings[i + 1] ?? '');
  });
  return new Raw(out);
}

export const raw = (s: string): Raw => new Raw(s);
export const join = (items: Value[], sep: Raw | string = ''): Raw => raw(items.map(render).join(render(sep)));

// ---------------------------------------------------------------------------------------------
// Colour: contrast checks, used both to pick badge text and to report ratios in the READMEs.

export function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (lin[0] as number) + 0.7152 * (lin[1] as number) + 0.0722 * (lin[2] as number);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Black or white, whichever reads better on `bg`. */
export const textOn = (bg: string): string => (contrast(bg, '#FFFFFF') >= contrast(bg, '#111111') ? '#FFFFFF' : '#111111');

/** The team's colour that stands out best on a given page background (for thin accents). */
export function accentOn(team: Team, pageBg: string): string {
  const [p, s] = team.colors;
  return contrast(p, pageBg) >= contrast(s, pageBg) ? p : s;
}

// ---------------------------------------------------------------------------------------------
// Team badge: the platform's rule for a team without a logo is its colours and its tag.

export interface BadgeOpts {
  size?: number;
  shape?: 'square' | 'round' | 'shield' | 'rect';
  /** Draw the tag; a very small badge may show colours only. */
  tag?: boolean;
  cls?: string;
}

export function teamBadge(team: Team, opts: BadgeOpts = {}): Raw {
  const size = opts.size ?? 24;
  const shape = opts.shape ?? 'square';
  const [p, s] = team.colors;
  const fg = textOn(p);
  const w = shape === 'rect' ? Math.round(size * 1.5) : size;
  const h = size;
  const tag = team.tag;
  const fontSize = Math.max(6, Math.round((h * (tag.length <= 2 ? 0.46 : tag.length === 3 ? 0.38 : 0.3))));
  const clip =
    shape === 'round'
      ? `<clipPath id="c"><circle cx="${w / 2}" cy="${h / 2}" r="${h / 2}"/></clipPath>`
      : shape === 'shield'
        ? `<clipPath id="c"><path d="M0 0H${w}V${h * 0.62}C${w} ${h * 0.86} ${w * 0.5} ${h} ${w * 0.5} ${h}C${w * 0.5} ${h} 0 ${h * 0.86} 0 ${h * 0.62}Z"/></clipPath>`
        : `<clipPath id="c"><rect width="${w}" height="${h}" rx="${Math.max(1, Math.round(size * 0.08))}"/></clipPath>`;
  // The secondary colour runs as a band along the bottom: both colours visible at any size.
  const band = Math.max(2, Math.round(h * 0.16));
  const text =
    opts.tag === false
      ? ''
      : `<text x="${w / 2}" y="${(h - band) / 2 + fontSize * 0.36}" text-anchor="middle" font-size="${fontSize}" font-weight="700" fill="${fg}" font-family="inherit" letter-spacing="0.02em">${escape(tag)}</text>`;
  const outline = contrast(p, '#FFFFFF') < 1.25 || contrast(p, '#111111') < 1.25 ? `<rect width="${w}" height="${h}" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="2" clip-path="url(#c)"/>` : '';
  return raw(
    `<svg class="badge ${opts.cls ?? ''}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(team.name)}"><defs>${clip}</defs><g clip-path="url(#c)"><rect width="${w}" height="${h}" fill="${p}"/><rect y="${h - band}" width="${w}" height="${band}" fill="${s}"/>${outline}</g>${text}</svg>`.replace(/id="c"/g, `id="c-${team.slug}-${size}-${shape}"`).replace(/url\(#c\)/g, `url(#c-${team.slug}-${size}-${shape})`),
  );
}

// ---------------------------------------------------------------------------------------------
// Flags as small inline SVGs (never emoji).

const NAT_NAMES: Record<Nat, string> = { FR: 'France', BE: 'Belgique', CH: 'Suisse', LU: 'Luxembourg', MA: 'Maroc', NL: 'Pays-Bas', DE: 'Allemagne' };

export function flag(nat: Nat, h = 11): Raw {
  const w = Math.round(h * 1.45);
  const body: Record<Nat, string> = {
    FR: `<rect width="3" height="2" fill="#ED2939"/><rect width="2" height="2" fill="#fff"/><rect width="1" height="2" fill="#002395"/>`,
    BE: `<rect width="3" height="2" fill="#EF3340"/><rect width="2" height="2" fill="#FDDA24"/><rect width="1" height="2" fill="#000"/>`,
    CH: `<rect width="3" height="2" fill="#DA291C"/><rect x="1.3" y=".45" width=".4" height="1.1" fill="#fff"/><rect x=".95" y=".8" width="1.1" height=".4" fill="#fff"/>`,
    LU: `<rect width="3" height="2" fill="#00A1DE"/><rect width="3" height="1.333" fill="#fff"/><rect width="3" height=".667" fill="#EA141D"/>`,
    MA: `<rect width="3" height="2" fill="#C1272D"/><path d="M1.5 .55l.26.8h-.68l.55-.4h.68l-.55.4z" fill="none" stroke="#006233" stroke-width=".08"/>`,
    NL: `<rect width="3" height="2" fill="#21468B"/><rect width="3" height="1.333" fill="#fff"/><rect width="3" height=".667" fill="#AE1C28"/>`,
    DE: `<rect width="3" height="2" fill="#FFCE00"/><rect width="3" height="1.333" fill="#DD0000"/><rect width="3" height=".667" fill="#000"/>`,
  };
  return raw(
    `<svg class="flag" width="${w}" height="${h}" viewBox="0 0 3 2" preserveAspectRatio="none" role="img" aria-label="${NAT_NAMES[nat]}"><title>${NAT_NAMES[nat]}</title>${body[nat]}<rect width="3" height="2" fill="none" stroke="rgba(0,0,0,.25)" stroke-width=".08"/></svg>`,
  );
}

export const natName = (n: Nat) => NAT_NAMES[n];

// ---------------------------------------------------------------------------------------------
// One icon set: 24-unit grid, 1.75 stroke, round joins. Only icons that carry meaning.

const ICONS = {
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  up: '<path d="M12 18V6M6.5 11.5L12 6l5.5 5.5"/>',
  down: '<path d="M12 6v12M6.5 12.5L12 18l5.5-5.5"/>',
  chevronRight: '<path d="M9.5 6l6 6-6 6"/>',
  chevronDown: '<path d="M6 9.5l6 6 6-6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  shield: '<path d="M12 3.5l7 2.5v5.5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z"/>',
  file: '<path d="M14 3.5H7a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7.5z"/><path d="M14 3.5v4h4"/>',
  play: '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><path d="M10.5 9.5v5l4-2.5z"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V10M10 3h4"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.3 3.4 8.5S14.3 18.1 12 20.5M12 3.5C9.7 5.9 8.6 8.8 8.6 12s1.1 6.1 3.4 8.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  filter: '<path d="M4 5.5h16l-6.2 7.2v5.6l-3.6 1.7v-7.3z"/>',
  swap: '<path d="M7 4L4 7l3 3M4 7h13M17 20l3-3-3-3M20 17H7"/>',
  // Discord: a plain speech-controller glyph drawn in the set's own stroke, not the brand mark.
  discord: '<path d="M7.5 6.5c1.4-.7 3-1 4.5-1s3.1.3 4.5 1c1.6 2.3 2.4 4.8 2.5 7.6-1.3 1.3-3 2.2-4.6 2.6l-.8-1.4M7.5 6.5c-1.6 2.3-2.4 4.8-2.5 7.6 1.3 1.3 3 2.2 4.6 2.6l.8-1.4M8.3 14.6c2.5 1 4.9 1 7.4 0"/><circle cx="9.6" cy="11.4" r=".9" fill="currentColor"/><circle cx="14.4" cy="11.4" r=".9" fill="currentColor"/>',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 16, label?: string): Raw {
  const a11y = label ? `role="img" aria-label="${escape(label)}"` : 'aria-hidden="true"';
  return raw(
    `<svg class="icon icon-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${ICONS[name]}</svg>`,
  );
}

// ---------------------------------------------------------------------------------------------
// Pages and links between them.

export interface Page {
  /** File written inside the proposal folder, e.g. "teams/greed-esport.html". */
  file: string;
  /** The production route this page shows, e.g. "/teams/greed-esport". */
  route: string;
  title: string;
  /** Group on the proposal's index page. */
  group: string;
  /** One line on the index: which state or variant this is. */
  note?: string;
  /** An anchor page (screenshotted and reviewed first). */
  anchor?: boolean;
  /** Language of the page; 'de' and 'nl' render the label-length check. */
  lang?: 'fr' | 'de' | 'nl';
  render: () => Raw | string;
}

let currentFile = 'index.html';
let routes = new Map<string, string>();
const FALLBACKS: [RegExp, string][] = [];

/** Called by the build before rendering, so links resolve to built files. */
export function setRoutes(pages: Page[], fallbacks: [RegExp, string][]) {
  routes = new Map(pages.map((p) => [p.route, p.file]));
  FALLBACKS.length = 0;
  FALLBACKS.push(...fallbacks);
}
export const setCurrentFile = (file: string) => {
  currentFile = file;
};

/** Relative path from the page being rendered to another file of the proposal. */
export function rel(file: string): string {
  const depth = currentFile.split('/').length - 1;
  return '../'.repeat(depth) + file;
}

/**
 * A link to a production route. Built routes resolve to their file; other routes of a built kind
 * fall back to the example of that kind (every team links to the Greed Esport page), so the
 * mockup stays navigable without building 30 team pages.
 */
export function href(route: string): string {
  const [path, hash] = route.split('#') as [string, string | undefined];
  let file = routes.get(path);
  // First match wins: specific fallbacks come before the generic ones.
  if (!file) for (const [re, f] of FALLBACKS) if (re.test(path) && routes.has(f)) { file = routes.get(f); break; }
  if (!file) return '#' + path;
  return rel(file) + (hash ? `#${hash}` : '');
}

export const teamRoute = (t: Team) => `/teams/${t.slug}`;
export const playerRoute = (slug: string) => `/players/${slug}`;
export const matchRoute = (id: number) => `/matches/${id}`;
