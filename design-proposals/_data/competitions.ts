// The organisation (MBL Group), its four competitions and their seasons. `theme` is what
// `competition.theme_json` would hold; each proposal maps it onto its own CSS variables.

import { paris } from './format.ts';

export interface Theme {
  /** Main brand colour of the league (bars, active tab, links on its pages). */
  primary: string;
  /** Second colour (zone bars, secondary marks). */
  secondary: string;
  /** Small highlights (live dot, current week). */
  accent: string;
  /** Text on a `primary` field; chosen for AA contrast. */
  onPrimary: string;
  /** Optional stripe, e.g. LFR's tricolour. */
  stripe?: string[];
}

export type SeasonStatus = 'registration' | 'active' | 'cup' | 'closed';

export interface Division {
  slug: string;
  name: string;
  level: number;
  /** Number of weeks of its round robin (a division's size is data). */
  weeks: number;
  bestOf: number;
}

export interface Season {
  slug: string;
  name: string;
  status: SeasonStatus;
  startsOn: number;
  endsOn: number;
  divisions: Division[];
  currentWeek: number | null;
  note?: string;
}

export interface Competition {
  slug: string;
  short: string;
  name: string;
  title: 'r6' | 'valorant' | 'rocket_league';
  titleLabel: string;
  platform?: string;
  mode: 'team' | 'mixed';
  discordInvite: string;
  discordMembers: number;
  theme: Theme;
  scoreUnit: 'rounds' | 'goals';
  seasons: Season[];
}

const weekStart = (start: number, n: number) => start + (n - 1) * 7 * 86_400_000;

export const LFR_S3_START = paris(2026, 10, 19);
export const weekRange = (n: number, start = LFR_S3_START) => ({
  start: weekStart(start, n),
  end: weekStart(start, n + 1) - 60_000,
});

export const org = {
  slug: 'mbl-group',
  name: 'MBL Group',
  locale: 'fr',
  about:
    'Groupe associatif qui organise quatre ligues communautaires francophones, chacune avec son serveur Discord, son staff et son règlement.',
  founded: 2024,
  contact: 'contact via le Discord de chaque ligue',
};

export const competitions: Competition[] = [
  {
    slug: 'lfr',
    short: 'LFR',
    name: 'Ligue Française Rainbow Six',
    title: 'r6',
    titleLabel: 'Rainbow Six Siege',
    platform: 'PC',
    mode: 'team',
    discordInvite: 'https://discord.gg/lfr-r6',
    discordMembers: 2_184,
    // Navy and French red, with the tricolour stripe of LFR's own posts.
    theme: { primary: '#14306B', secondary: '#D3263A', accent: '#2F6FE0', onPrimary: '#FFFFFF', stripe: ['#1F3F9A', '#FFFFFF', '#D3263A'] },
    scoreUnit: 'rounds',
    seasons: [
      {
        slug: 's3',
        name: 'Saison 3',
        status: 'active',
        startsOn: LFR_S3_START,
        endsOn: paris(2026, 12, 20, 23, 59),
        currentWeek: 6,
        divisions: [
          { slug: 'ligue-1', name: 'Ligue 1', level: 1, weeks: 9, bestOf: 1 },
          { slug: 'ligue-2', name: 'Ligue 2', level: 2, weeks: 11, bestOf: 1 },
        ],
      },
      {
        slug: 's2',
        name: 'Saison 2',
        status: 'closed',
        startsOn: paris(2026, 5, 4),
        endsOn: paris(2026, 7, 26),
        currentWeek: null,
        divisions: [
          { slug: 'ligue-1', name: 'Ligue 1', level: 1, weeks: 9, bestOf: 1 },
          { slug: 'ligue-2', name: 'Ligue 2', level: 2, weeks: 9, bestOf: 1 },
        ],
      },
      {
        slug: 's1',
        name: 'Saison 1',
        status: 'closed',
        startsOn: paris(2025, 11, 3),
        endsOn: paris(2026, 2, 8),
        currentWeek: null,
        divisions: [{ slug: 'ligue-1', name: 'Ligue 1', level: 1, weeks: 9, bestOf: 1 }],
      },
    ],
  },
  {
    slug: 'lfrl',
    short: 'LFRL',
    name: 'Ligue Francophone Rocket League',
    title: 'rocket_league',
    titleLabel: 'Rocket League',
    platform: 'PC et consoles',
    mode: 'team',
    discordInvite: 'https://discord.gg/lfrl',
    discordMembers: 912,
    // Orange and deep teal: nothing in common with LFR, to prove the theme carries the page.
    theme: { primary: '#0E4B50', secondary: '#F26B1D', accent: '#F26B1D', onPrimary: '#FFFFFF' },
    scoreUnit: 'goals',
    seasons: [
      {
        slug: 's1',
        name: 'Saison 1',
        status: 'active',
        startsOn: paris(2026, 11, 2),
        endsOn: paris(2026, 12, 20, 23, 59),
        currentWeek: 4,
        divisions: [{ slug: 'division-1', name: 'Division 1', level: 1, weeks: 7, bestOf: 5 }],
      },
    ],
  },
  {
    slug: 'lfv',
    short: 'LFV',
    name: 'Ligue Francophone Valorant',
    title: 'valorant',
    titleLabel: 'Valorant',
    platform: 'PC',
    mode: 'team',
    discordInvite: 'https://discord.gg/lfv-valorant',
    discordMembers: 1_376,
    theme: { primary: '#7A1F2B', secondary: '#E8C547', accent: '#C2303F', onPrimary: '#FFFFFF' },
    scoreUnit: 'rounds',
    seasons: [
      {
        slug: 's2',
        name: 'Saison 2',
        status: 'registration',
        startsOn: paris(2027, 1, 11),
        endsOn: paris(2027, 3, 14),
        currentWeek: null,
        note: 'Inscriptions jusqu’au 20 déc. · 4 équipes inscrites, 12 places',
        divisions: [{ slug: 'division-1', name: 'Division 1', level: 1, weeks: 9, bestOf: 1 }],
      },
      {
        slug: 's1',
        name: 'Saison 1',
        status: 'cup',
        startsOn: paris(2026, 9, 7),
        endsOn: paris(2026, 11, 8),
        currentWeek: null,
        note: 'Coupe LFV : demi-finales le 3 déc.',
        divisions: [{ slug: 'division-1', name: 'Division 1', level: 1, weeks: 9, bestOf: 1 }],
      },
    ],
  },
  {
    slug: 'frfl',
    short: 'FRFL',
    name: 'French Rainbow FACEIT League',
    title: 'r6',
    titleLabel: 'Rainbow Six Siege',
    platform: 'FACEIT, équipes mixtes',
    mode: 'mixed',
    discordInvite: 'https://discord.gg/frfl',
    discordMembers: 640,
    theme: { primary: '#2B2B2B', secondary: '#FF5500', accent: '#FF5500', onPrimary: '#FFFFFF' },
    scoreUnit: 'rounds',
    seasons: [
      {
        slug: 's1',
        name: 'Saison 1',
        status: 'active',
        startsOn: paris(2026, 11, 2),
        endsOn: paris(2027, 1, 31),
        currentWeek: 4,
        note: 'Classement individuel · lobbys le mardi et le jeudi',
        divisions: [{ slug: 'open', name: 'Classement joueurs', level: 1, weeks: 13, bestOf: 1 }],
      },
    ],
  },
];

export const competition = (slug: string): Competition => {
  const c = competitions.find((x) => x.slug === slug);
  if (!c) throw new Error(`unknown competition ${slug}`);
  return c;
};

/** The ban list shared by every league of the group (org_ban). Public reason only. */
export const orgBans = [
  { account: 'Snipz_off', since: paris(2026, 10, 4), reason: 'Triche : logiciel tiers (MOSS)', leagues: ['LFR', 'LFV', 'LFRL'] },
  { account: 'k1ller.exe', since: paris(2026, 6, 21), reason: 'Triche : macro de recul', leagues: ['LFR', 'LFV', 'LFRL'] },
  { account: 'Breezy-77', since: paris(2026, 3, 2), reason: 'Compte partagé (smurf) et triche', leagues: ['LFR', 'LFV', 'LFRL'] },
];
