// Clubs and rosters. LFR names come from fixtures/lfr-s3-teams.csv (the seed typed from score7);
// display tags are short (2–4 letters) because the seed's tags are internal codes such as
// NIGHTWOLVES. Colours are the seed's colour words turned into hex values.

import { slugify } from './rng.ts';

export type Nat = 'FR' | 'BE' | 'CH' | 'LU' | 'MA' | 'NL' | 'DE';
export type TitleKey = 'r6' | 'valorant' | 'rocket_league';

export interface Club {
  slug: string;
  name: string;
  city: string | null;
  /** association, association 1901, company, amateur (design doc section 7, registration). */
  legalStatus: 'Association loi 1901' | 'Association' | 'Société' | 'Amateur';
  colors: string[];
  founded: number | null;
  socials: { x?: string; twitch?: string; youtube?: string; instagram?: string; tiktok?: string };
  discordUrl: string | null;
  officials: { player: string; role: 'owner' | 'manager' }[];
  honours: { label: string; season: string; team: string }[];
}

export interface Team {
  slug: string;
  name: string;
  tag: string;
  /** The seed's tag, used to read the fixtures. */
  code: string;
  club: string;
  title: TitleKey;
  competition: string;
  division: string;
  /** [primary, secondary]; null falls back to the club's. */
  colors: [string, string];
  canStream: boolean;
  staff: { player: string; role: 'manager' | 'coach' }[];
}

interface TeamSeed {
  division: string;
  name: string;
  tag: string;
  code: string;
  colors: [string, string];
  club?: string;
  city?: string;
}

const LFR: TeamSeed[] = [
  { division: 'ligue-1', name: 'Civitas Esport', tag: 'CIV', code: 'CIVITAS', colors: ['#1F4E9E', '#FFFFFF'], city: 'Lille' },
  { division: 'ligue-1', name: 'Devil Black Esport', tag: 'DBE', code: 'DEVIL', colors: ['#C8102E', '#111111'], city: 'Marseille' },
  { division: 'ligue-1', name: 'GREED Academy', tag: 'GRDA', code: 'GREED2', colors: ['#6B2FB3', '#121212'], club: 'greed' },
  { division: 'ligue-1', name: 'Greed Esport', tag: 'GRD', code: 'GREED1', colors: ['#6B2FB3', '#121212'], club: 'greed' },
  { division: 'ligue-1', name: 'Nightwolves Esport', tag: 'NWE', code: 'NIGHTWOLVES', colors: ['#1A1A1A', '#E8E8E8'], city: 'Liège' },
  { division: 'ligue-1', name: 'NTS kastuki', tag: 'NTS', code: 'NTS', colors: ['#E8579B', '#B5121B'], club: 'not-scam' },
  { division: 'ligue-1', name: 'Outsouki', tag: 'OTK', code: 'OUTSOUKI', colors: ['#D7263D', '#FFFFFF'], city: 'Casablanca' },
  { division: 'ligue-1', name: 'RCK Esport', tag: 'RCK', code: 'RCK', colors: ['#D62828', '#1D3557'], city: 'Rennes' },
  { division: 'ligue-1', name: 'RPV Esport', tag: 'RPV', code: 'RPV', colors: ['#F7BE50', '#141414'], city: 'Bordeaux' },
  { division: 'ligue-1', name: 'W Mates', tag: 'WM', code: 'WMATES', colors: ['#5B2A86', '#0E0E0E'], club: 'w-mates' },
  { division: 'ligue-2', name: 'Askium Esport', tag: 'ASK', code: 'ASKIUM', colors: ['#4B2C83', '#0F0F0F'], city: 'Toulouse' },
  { division: 'ligue-2', name: 'Click Gaming', tag: 'CLK', code: 'CLICK', colors: ['#202020', '#FFFFFF'], city: 'Namur' },
  { division: 'ligue-2', name: 'IGURU ESPORT', tag: 'IGU', code: 'IGURU', colors: ['#8E44AD', '#FFFFFF'], city: 'Lyon' },
  { division: 'ligue-2', name: 'Lunaria Esport', tag: 'LUN', code: 'LUNARIA', colors: ['#141414', '#E63946'], city: 'Genève' },
  { division: 'ligue-2', name: "Mixt N' chill", tag: 'MNC', code: 'MIXNCHILL', colors: ['#E4572E', '#FFFFFF'], city: 'Charleroi' },
  { division: 'ligue-2', name: 'Nova 1 Esport', tag: 'NOV1', code: 'NOVA1', colors: ['#6A3FD8', '#0D0D0D'], club: 'nova' },
  { division: 'ligue-2', name: 'Nova 2 Esport', tag: 'NOV2', code: 'NOVA2', colors: ['#F1EDFA', '#6A3FD8'], club: 'nova' },
  { division: 'ligue-2', name: 'ORIGINS LEGION', tag: 'ORL', code: 'ORIGINS', colors: ['#3E1F6E', '#000000'], city: 'Nantes' },
  { division: 'ligue-2', name: 'Panaria Lair', tag: 'PNL', code: 'PANARIA', colors: ['#B22234', '#2E7D32'], city: 'Luxembourg' },
  { division: 'ligue-2', name: 'Shade', tag: 'SHD', code: 'SHADE', colors: ['#F28C28', '#FFFFFF'], city: 'Montpellier' },
  { division: 'ligue-2', name: 'Starly Esport Club', tag: 'STR', code: 'STARLY', colors: ['#FF9F1C', '#111111'], city: 'Strasbourg' },
  { division: 'ligue-2', name: 'Wmates Spectrum', tag: 'WMS', code: 'SPECTRUM', colors: ['#5B2A86', '#0E0E0E'], club: 'w-mates' },
];

// LFRL (Rocket League): invented names of uneven length, one of them W Mates's RL roster.
const LFRL: TeamSeed[] = [
  { division: 'division-1', name: 'W Mates RL', tag: 'WM', code: 'WMRL', colors: ['#5B2A86', '#0E0E0E'], club: 'w-mates' },
  { division: 'division-1', name: 'Les Turbos de Namur', tag: 'TDN', code: 'TURBOS', colors: ['#0B6E4F', '#F2C14E'], city: 'Namur' },
  { division: 'division-1', name: 'Aéro Club Lyonnais', tag: 'ACL', code: 'AERO', colors: ['#1C3F94', '#E9ECEF'], city: 'Lyon' },
  { division: 'division-1', name: 'Velocity', tag: 'VLC', code: 'VELOCITY', colors: ['#D00000', '#FFBA08'], city: 'Paris' },
  { division: 'division-1', name: 'Drift Collective', tag: 'DFT', code: 'DRIFT', colors: ['#2B2D42', '#8D99AE'], city: 'Bruxelles' },
  { division: 'division-1', name: 'Boost Squad 59', tag: 'BS59', code: 'BOOST', colors: ['#F77F00', '#003049'], city: 'Lille' },
  { division: 'division-1', name: 'Orbital', tag: 'ORB', code: 'ORBITAL', colors: ['#3A0CA3', '#4CC9F0'], city: 'Nancy' },
  { division: 'division-1', name: 'Les Ballons d’Or du Hainaut', tag: 'BOH', code: 'BALLONS', colors: ['#C9A227', '#1B1B1B'], city: 'Mons' },
];

// LFV (Valorant) is in registration: a few rosters that have filed.
const LFV: TeamSeed[] = [
  { division: 'division-1', name: 'Not Scam Valkyr', tag: 'NSV', code: 'VALKYR', colors: ['#E8579B', '#1A1A1A'], club: 'not-scam' },
  { division: 'division-1', name: 'Greed Valorant', tag: 'GRDV', code: 'GREEDV', colors: ['#6B2FB3', '#121212'], club: 'greed' },
  { division: 'division-1', name: 'Kōri Esport', tag: 'KRI', code: 'KORI', colors: ['#0077B6', '#CAF0F8'], city: 'Grenoble' },
  { division: 'division-1', name: 'Les Mouettes', tag: 'MOU', code: 'MOUETTES', colors: ['#264653', '#E9C46A'], city: 'Ostende' },
];

const CLUB_EXTRA: Record<string, Partial<Club> & { name: string }> = {
  greed: {
    name: 'Greed',
    city: 'Paris',
    legalStatus: 'Association loi 1901',
    colors: ['#6B2FB3', '#121212', '#D9C8F2'],
    founded: 2023,
    socials: { x: 'GreedEsportFR', twitch: 'greed_esport', youtube: '@greedesport', instagram: 'greed.esport' },
    discordUrl: 'https://discord.gg/greedesport',
    honours: [
      { label: 'Champion de Ligue 2', season: 'LFR Saison 1', team: 'greed-esport' },
      { label: 'Finaliste de la Coupe de France', season: 'LFR Saison 2', team: 'greed-esport' },
      { label: 'Promotion en Ligue 1 (barrage)', season: 'LFR Saison 2', team: 'greed-academy' },
    ],
  },
  'w-mates': {
    name: 'W Mates',
    city: 'Bruxelles',
    legalStatus: 'Association',
    colors: ['#5B2A86', '#0E0E0E', '#FFFFFF'],
    founded: 2022,
    socials: { x: 'WMatesGG', twitch: 'wmatesgg', tiktok: 'wmates.gg' },
    discordUrl: 'https://discord.gg/wmates',
    honours: [
      { label: 'Champion de Ligue 1', season: 'LFR Saison 2', team: 'w-mates' },
      { label: 'Vainqueur de la Coupe de France', season: 'LFR Saison 1', team: 'w-mates' },
    ],
  },
  nova: {
    name: 'Nova Esport',
    city: 'Reims',
    legalStatus: 'Amateur',
    colors: ['#6A3FD8', '#0D0D0D'],
    founded: 2024,
    socials: { x: 'NovaEsportFR' },
    discordUrl: null,
  },
  'not-scam': {
    name: 'Not Scam',
    city: 'Toulon',
    legalStatus: 'Association loi 1901',
    colors: ['#E8579B', '#B5121B', '#1A1A1A'],
    founded: 2021,
    socials: { x: 'NotScamGG', twitch: 'notscamgg' },
    discordUrl: 'https://discord.gg/notscam',
  },
};

function build(seeds: TeamSeed[], competition: string, title: TitleKey) {
  return seeds.map(
    (s): Team => ({
      slug: slugify(s.name),
      name: s.name,
      tag: s.tag,
      code: s.code,
      club: s.club ?? slugify(s.name),
      title,
      competition,
      division: s.division,
      colors: s.colors,
      canStream: s.code.length % 2 === 0,
      staff: [],
    }),
  );
}

export const teams: Team[] = [
  ...build(LFR, 'lfr', 'r6'),
  ...build(LFRL, 'lfrl', 'rocket_league'),
  ...build(LFV, 'lfv', 'valorant'),
];

export const clubs: Club[] = (() => {
  const out = new Map<string, Club>();
  for (const seed of [...LFR, ...LFRL, ...LFV]) {
    const slug = seed.club ?? slugify(seed.name);
    if (out.has(slug)) continue;
    const extra = CLUB_EXTRA[slug];
    out.set(slug, {
      slug,
      name: extra?.name ?? seed.name,
      city: extra?.city ?? seed.city ?? null,
      legalStatus: extra?.legalStatus ?? 'Association loi 1901',
      colors: extra?.colors ?? [...seed.colors],
      founded: extra?.founded ?? null,
      socials: extra?.socials ?? {},
      discordUrl: extra?.discordUrl ?? null,
      officials: [],
      honours: extra?.honours ?? [],
    });
  }
  return [...out.values()];
})();

export const teamBySlug = new Map(teams.map((t) => [t.slug, t]));
export const teamByCode = new Map(teams.map((t) => [`${t.competition}:${t.code}`, t]));
export const clubBySlug = new Map(clubs.map((c) => [c.slug, c]));

export function team(slug: string): Team {
  const t = teamBySlug.get(slug);
  if (!t) throw new Error(`unknown team ${slug}`);
  return t;
}
