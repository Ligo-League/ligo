// Ligo as a platform (design doc section 7, 16 November 2026): several organisations on one
// instance, games as entry points, teams that only record scrims. Teams of the other groups are
// lightweight and kept out of `teams`, so the LFR data (and proposals A, B, C) stay unchanged.

import { paris } from './format.ts';
import { competitions } from './competitions.ts';
import type { Team } from './teams.ts';

export interface Org {
  slug: string;
  name: string;
  /** Text of the logo placeholder (no real logos in the mockups). */
  mark: string;
  color: string;
  description: string;
  country: string;
  verified: boolean;
  competitions: string[];
}

export const orgs: Org[] = [
  {
    slug: 'mbl-group', name: 'MBL Group', mark: 'MBL', color: '#1B1B1B', country: 'FR',
    description: 'Groupe associatif qui organise quatre ligues communautaires francophones, chacune avec son serveur Discord, son staff et son règlement.',
    verified: true, competitions: ['lfr', 'frfl', 'lfv', 'lfrl'],
  },
  {
    slug: 'lowlands-esports', name: 'Lowlands Esports', mark: 'LLE', color: '#E5662B', country: 'BE',
    description: 'Ligues R6 et Valorant pour la Belgique, les Pays-Bas et le Luxembourg. Tout en anglais, traduit en néerlandais et en français.',
    verified: false, competitions: ['bsl', 'llv'],
  },
  {
    // A league on its own is an organisation with one competition.
    slug: 'ligue-romande', name: 'Ligue Romande R6', mark: 'LR6', color: '#B3122E', country: 'CH',
    description: 'Une division de huit équipes de Suisse romande, le mardi soir.',
    verified: false, competitions: ['lr6'],
  },
];

export interface GameInfo {
  key: 'r6' | 'valorant' | 'rocket_league';
  name: string;
  short: string;
  /** Placeholder colour for the game icon. */
  color: string;
}

export const games: GameInfo[] = [
  { key: 'r6', name: 'Rainbow Six Siege', short: 'R6', color: '#3A3F47' },
  { key: 'valorant', name: 'Valorant', short: 'VAL', color: '#C2303F' },
  { key: 'rocket_league', name: 'Rocket League', short: 'RL', color: '#0E4B50' },
];

/** One line per competition on a game home: what is running, where, how far. */
export interface CompetitionCard {
  org: string;
  slug: string;
  short: string;
  name: string;
  game: GameInfo['key'];
  season: string;
  status: 'registration' | 'active' | 'cup' | 'closed';
  divisions: string[];
  teams: number;
  progress: string;
  language: string;
  primary: string;
  /** Matches today, across its divisions. */
  today: number;
}

export const competitionCards: CompetitionCard[] = [
  { org: 'mbl-group', slug: 'lfr', short: 'LFR', name: 'Ligue Française Rainbow Six', game: 'r6', season: 'Saison 3', status: 'active', divisions: ['Ligue 1', 'Ligue 2'], teams: 22, progress: 'Semaine 6 sur 9', language: 'FR', primary: '#14306B', today: 2 },
  { org: 'lowlands-esports', slug: 'bsl', short: 'BSL', name: 'Benelux Siege League', game: 'r6', season: 'Season 2', status: 'active', divisions: ['Division 1', 'Division 2'], teams: 16, progress: 'Week 5 of 7', language: 'EN', primary: '#E5662B', today: 2 },
  { org: 'mbl-group', slug: 'frfl', short: 'FRFL', name: 'French Rainbow FACEIT League', game: 'r6', season: 'Saison 1', status: 'active', divisions: ['Classement joueurs'], teams: 0, progress: 'Semaine 4 sur 13', language: 'FR', primary: '#2B2B2B', today: 1 },
  { org: 'ligue-romande', slug: 'lr6', short: 'LR6', name: 'Ligue Romande R6', game: 'r6', season: 'Saison 1', status: 'cup', divisions: ['Division unique'], teams: 8, progress: 'Coupe : demi-finales', language: 'FR', primary: '#B3122E', today: 0 },
  { org: 'mbl-group', slug: 'lfv', short: 'LFV', name: 'Ligue Francophone Valorant', game: 'valorant', season: 'Saison 2', status: 'registration', divisions: ['Division 1'], teams: 4, progress: 'Inscriptions jusqu’au 20 déc.', language: 'FR', primary: '#7A1F2B', today: 0 },
  { org: 'lowlands-esports', slug: 'llv', short: 'LLV', name: 'Lowlands Valorant League', game: 'valorant', season: 'Season 1', status: 'active', divisions: ['Division 1'], teams: 10, progress: 'Week 3 of 9', language: 'EN', primary: '#E5662B', today: 1 },
  { org: 'mbl-group', slug: 'lfrl', short: 'LFRL', name: 'Ligue Francophone Rocket League', game: 'rocket_league', season: 'Saison 1', status: 'active', divisions: ['Division 1'], teams: 8, progress: 'Semaine 4 sur 7', language: 'FR', primary: '#0E4B50', today: 1 },
];

/** A Team-shaped value for another group's team: enough for a badge and a name. */
export const extTeam = (competition: string, name: string, tag: string, colors: [string, string]): Team => ({
  slug: tag.toLowerCase(), name, tag, code: tag, club: tag.toLowerCase(), title: 'r6', competition, division: 'division-1', colors, canStream: false, staff: [],
});

/** Other groups' matches today and tonight, for the Ligo and game homes. */
export const otherMatchesToday = [
  { competition: 'bsl', context: 'BSL · Division 1 · Week 5', a: extTeam('bsl', 'Polder Five', 'PLD', ['#0A3D62', '#F8C291']), b: extTeam('bsl', 'Ardennes Esports', 'ARD', ['#2D6A4F', '#FFFFFF']), at: paris(2026, 11, 26, 20, 0), status: 'validated' as const, score: [7, 4] as [number, number], map: 'Bank' },
  { competition: 'bsl', context: 'BSL · Division 2 · Week 5', a: extTeam('bsl', 'Team Waterzooi', 'WTZ', ['#F4D35E', '#1B1B1B']), b: extTeam('bsl', 'Esch Unlimited', 'ESU', ['#C1121F', '#FDF0D5']), at: paris(2026, 11, 26, 21, 30), status: 'scheduled' as const, score: null, map: null },
  { competition: 'llv', context: 'LLV · Division 1 · Week 3', a: extTeam('llv', 'Gent Gaming', 'GNT', ['#1D3557', '#E63946']), b: extTeam('llv', 'Maas Valley', 'MAAS', ['#6A994E', '#F2E8CF']), at: paris(2026, 11, 26, 21, 0), status: 'scheduled' as const, score: null, map: null },
];

/** Clubs with a roster in no competition: they use Ligo for scrims only (M-33). */
export const scrimOnlyTeams = [
  { team: extTeam('', 'Kraken Five', 'KRK5', ['#264653', '#2A9D8F']), city: 'Brest', practiceMaps: 23, lastScrim: paris(2026, 11, 25, 21, 0) },
  { team: extTeam('', 'Les Castors du Jura', 'CAST', ['#7F4F24', '#EDE0D4']), city: 'Delémont', practiceMaps: 9, lastScrim: paris(2026, 11, 22, 20, 0) },
];

/** Players who uploaded a photo (placeholders in the mockup); everyone else shows the default image. */
export const playersWithPhoto = new Set(['vexo', 'kyzo', 'ikaru', 'naru', 'lyrik', 'mazzi']);

export const orgOf = (competitionSlug: string): Org => orgs.find((o) => o.competitions.includes(competitionSlug)) as Org;

/** Routes under the organisation (section 7, 16 November 2026). */
export const compRoute = (comp: string, season?: string, rest = '') =>
  `/${orgOf(comp).slug}/${comp}${season ? `/${season}` : ''}${rest}`;

export const lfrCompetition = competitions.find((c) => c.slug === 'lfr');
