// Several games on one platform (design doc sections 4, 7, 9 and 12; maintainer, 16 November 2026).
// A title declares what it has (maps, sides, characters, rounds, score unit, veto, rank queues)
// and its metrics; the pages draw only what is declared. Also: Vexo's Valorant career in the LFV
// (a player in two games and two clubs), Rocket League rosters and series stats.

import { rng, hash, pick } from './rng.ts';
import { paris, NOW } from './format.ts';
import { team, teams, type Team } from './teams.ts';
import { players, type Player } from './players.ts';
import { rlSeries, type RlSeries } from './extra.ts';

export type TitleKey = 'r6' | 'valorant' | 'rocket_league';

export interface TitleMetric {
  key: string;
  label: string;
  short: string;
  /** In the manual stat grid. */
  manual: boolean;
}

export interface TitleInfo {
  key: TitleKey;
  name: string;
  route: string;
  maps: boolean;
  sides: boolean;
  rounds: boolean;
  /** Operators, agents, champions: null when the game has none. */
  characters: { one: string; many: string } | null;
  /** Whether a competition of this title has a veto by default (it may still turn it off). */
  veto: boolean;
  scoreUnit: 'rounds' | 'goals' | 'games';
  queues: { key: string; label: string }[];
  metrics: TitleMetric[];
}

export const TITLE_INFO: Record<TitleKey, TitleInfo> = {
  r6: {
    key: 'r6', name: 'Rainbow Six Siege', route: 'r6', maps: true, sides: true, rounds: true,
    characters: { one: 'Opérateur', many: 'Opérateurs' }, veto: true, scoreUnit: 'rounds',
    queues: [{ key: 'solo_duo', label: 'Solo/Duo' }, { key: 'flex', label: 'Flex' }],
    metrics: [
      { key: 'kills', label: 'Kills', short: 'K', manual: true },
      { key: 'deaths', label: 'Morts', short: 'D', manual: true },
      { key: 'assists', label: 'Assistances', short: 'A', manual: true },
      { key: 'kost', label: 'KOST', short: 'KOST', manual: false },
    ],
  },
  valorant: {
    key: 'valorant', name: 'Valorant', route: 'valorant', maps: true, sides: true, rounds: true,
    characters: { one: 'Agent', many: 'Agents' }, veto: true, scoreUnit: 'rounds',
    queues: [{ key: 'competitive', label: 'Compétition' }],
    metrics: [
      { key: 'kills', label: 'Kills', short: 'K', manual: true },
      { key: 'deaths', label: 'Morts', short: 'D', manual: true },
      { key: 'assists', label: 'Assistances', short: 'A', manual: true },
      { key: 'combat_score', label: 'Score de combat', short: 'CS', manual: true },
      { key: 'first_kills', label: 'Premiers kills', short: 'FK', manual: true },
      { key: 'first_deaths', label: 'Premières morts', short: 'FD', manual: true },
      { key: 'plants', label: 'Spikes posés', short: 'Pl', manual: true },
      { key: 'defuses', label: 'Spikes désamorcés', short: 'Df', manual: true },
    ],
  },
  rocket_league: {
    key: 'rocket_league', name: 'Rocket League', route: 'rocket-league', maps: false, sides: false, rounds: false,
    characters: null, veto: false, scoreUnit: 'goals',
    queues: [{ key: 'doubles', label: '2v2' }, { key: 'standard', label: '3v3' }],
    metrics: [
      { key: 'goals', label: 'Buts', short: 'B', manual: true },
      { key: 'assists', label: 'Passes décisives', short: 'PD', manual: true },
      // From replays only, when they exist (PC): free to collect, never typed.
      { key: 'saves', label: 'Arrêts', short: 'Arr', manual: false },
      { key: 'shots', label: 'Tirs', short: 'Tirs', manual: false },
      { key: 'score', label: 'Score', short: 'Score', manual: false },
      { key: 'demos', label: 'Démolitions', short: 'Dém', manual: false },
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// Game accounts and ranks by queue (self-declared, M-28; which queue the LFR reads is O-34).

export interface GameAccountView {
  title: TitleKey;
  name: string;
  ranks: Record<string, string>;
  shown: string;
  team: string | null;
}

export const gameAccounts: Record<string, GameAccountView[]> = {
  vexo: [
    { title: 'r6', name: 'Vexo.GRD', ranks: { solo_duo: 'Champion', flex: 'Diamant I' }, shown: 'solo_duo', team: 'greed-esport' },
    { title: 'valorant', name: 'Vexo#EUW', ranks: { competitive: 'Ascendant 2' }, shown: 'competitive', team: 'not-scam-valkyr' },
  ],
};

/** The titles a player has played officially, most recent official match first. */
export const titlesOf = (slug: string): TitleKey[] => (gameAccounts[slug] ?? rlAccount(slug)).map((a) => a.title);

// ---------------------------------------------------------------------------------------------
// Vexo in Valorant: LFV Saison 1 with Not Scam Valkyr (another club than his R6 team).

export interface TitleGame {
  at: number;
  competition: string;
  opponent: Team | { name: string; tag: string };
  map: string | null;
  character: string | null;
  won: boolean;
  score: [number, number];
  rounds: number;
  values: Record<string, number | null>;
  source: 'replay' | 'manual';
}

const VALO_MAPS = ['Ascent', 'Bind', 'Haven', 'Lotus', 'Sunset', 'Split', 'Abyss'];
const VALO_OPP: (Team | { name: string; tag: string })[] = [
  team('greed-valorant'), team('kori-esport'), team('les-mouettes'),
  { name: 'Pixel Rush', tag: 'PXR' }, { name: 'Arcane Five', tag: 'ARC' }, { name: 'Les Hiboux', tag: 'HIB' },
];

export const vexoValorant: TitleGame[] = (() => {
  const r = rng(hash('vexo-valorant'));
  const list: TitleGame[] = [];
  for (let i = 0; i < 9; i++) {
    const won = r() < 0.62;
    const lose = 4 + Math.floor(r() * 8);
    const ot = r() < 0.12;
    const score: [number, number] = ot ? (won ? [14, 12] : [12, 14]) : won ? [13, lose] : [lose, 13];
    const rounds = score[0] + score[1];
    const kills = Math.round(rounds * (0.72 + r() * 0.4));
    const deaths = Math.round(rounds * (0.6 + r() * 0.3));
    list.push({
      at: paris(2026, 3, 2 + i * 7, 21), competition: 'LFV Saison 1', opponent: pick(r, VALO_OPP), map: pick(r, VALO_MAPS),
      character: pick(r, ['Jett', 'Jett', 'Raze', 'Neon', 'Sova']), won, score, rounds,
      values: {
        kills, deaths, assists: Math.round(rounds * (0.15 + r() * 0.2)), combat_score: Math.round(rounds * (190 + r() * 90)),
        first_kills: Math.round(rounds * (0.1 + r() * 0.12)), first_deaths: Math.round(rounds * (0.06 + r() * 0.1)),
        plants: Math.floor(r() * 4), defuses: Math.floor(r() * 2),
      },
      source: 'manual',
    });
  }
  return list;
})();

// ---------------------------------------------------------------------------------------------
// Rocket League: three players per LFRL roster, and per-game stats of the validated series
// (goals sum to the game's score; replays add saves, shots, score and demos).

const RL_NAMES = [
  'Turbine', 'Kaz', 'Orbite', 'Gaufre', 'Mosa', 'Lio', 'Zénith', 'Pako', 'Rivet', 'Flux', 'Nebula', 'Grizz',
  'Boulon', 'Sprint', 'Céleste', 'Moka', 'Vortex', 'Pépite', 'Axel', 'Brindille', 'Kami', 'Tornade', 'Nougat', 'Echo',
];
const rlTeams = teams.filter((t) => t.competition === 'lfrl');
export const rlRosters = new Map<string, string[]>();
rlTeams.forEach((t, i) => {
  const slugs = RL_NAMES.slice(i * 3, i * 3 + 3).map((name) => {
    const slug = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
    if (!players.has(slug)) {
      const p: Player = { slug, tag: name, nat: i % 3 === 1 ? 'BE' : 'FR', rank: 'Grand Champion I', consent: true, role: null, discord: slug, skill: 1, hs: 0 };
      players.set(slug, p);
    }
    return slug;
  });
  rlRosters.set(t.slug, slugs);
});

function rlAccount(slug: string): GameAccountView[] {
  const t = [...rlRosters.entries()].find(([, l]) => l.includes(slug));
  return t ? [{ title: 'rocket_league', name: `${players.get(slug)?.tag ?? slug} (Epic)`, ranks: { standard: 'Grand Champion I', doubles: 'Champion III' }, shown: 'standard', team: t[0] }] : [];
}
export const rlTeamOf = (slug: string): Team | null => {
  const t = [...rlRosters.entries()].find(([, l]) => l.includes(slug));
  return t ? team(t[0]) : null;
};

export interface RlPlayerLine { player: string; side: 'a' | 'b'; values: Record<string, number | null> }
export interface RlGame { n: number; score: [number, number]; overtime: boolean; source: 'replay' | 'manual'; lines: RlPlayerLine[] }

export function rlGames(s: RlSeries): RlGame[] {
  const r = rng(hash(`rl-${s.id}`));
  return s.games.map((g, i) => {
    // Console players have no replay: one game of the series is typed by hand.
    const source = i === 1 ? 'manual' : 'replay';
    const lines: RlPlayerLine[] = [];
    for (const side of ['a', 'b'] as const) {
      const roster = rlRosters.get((side === 'a' ? s.a : s.b).slug) ?? [];
      const goals = new Map(roster.map((p) => [p, 0]));
      const assists = new Map(roster.map((p) => [p, 0]));
      for (let k = 0; k < g[side === 'a' ? 0 : 1]; k++) {
        const scorer = pick(r, roster);
        goals.set(scorer, (goals.get(scorer) ?? 0) + 1);
        if (r() < 0.6) {
          const mate = pick(r, roster.filter((p) => p !== scorer));
          assists.set(mate, (assists.get(mate) ?? 0) + 1);
        }
      }
      for (const p of roster) {
        const gl = goals.get(p) ?? 0;
        const as = assists.get(p) ?? 0;
        const saves = Math.floor(r() * 4);
        const shots = gl + Math.floor(r() * 4);
        lines.push({
          player: p, side,
          values: source === 'manual'
            ? { goals: gl, assists: as, saves: null, shots: null, score: null, demos: null }
            : { goals: gl, assists: as, saves, shots, score: gl * 100 + as * 50 + saves * 50 + shots * 20 + Math.floor(r() * 120), demos: Math.floor(r() * 3) },
        });
      }
    }
    return { n: i + 1, score: g, overtime: r() < 0.15, source, lines };
  });
}

/** The featured LFRL series: W Mates RL's latest validated one. */
export const featuredRl: RlSeries = (() => {
  const list = rlSeries.filter((s) => s.status === 'validated' && (s.a.slug === 'w-mates-rl' || s.b.slug === 'w-mates-rl'));
  return list[list.length - 1] as RlSeries;
})();

/** A Rocket League player's games: one row per game of each validated series. */
export function rlPlayerGames(slug: string): TitleGame[] {
  const tm = rlTeamOf(slug);
  if (!tm) return [];
  const out: TitleGame[] = [];
  for (const s of rlSeries.filter((x) => x.status === 'validated' && (x.a.slug === tm.slug || x.b.slug === tm.slug) && x.at <= NOW)) {
    const side = s.a.slug === tm.slug ? 'a' : 'b';
    for (const g of rlGames(s)) {
      const line = g.lines.find((l) => l.player === slug);
      if (!line) continue;
      const mine = g.score[side === 'a' ? 0 : 1];
      const theirs = g.score[side === 'a' ? 1 : 0];
      out.push({ at: s.at, competition: 'LFRL Saison 1', opponent: side === 'a' ? s.b : s.a, map: null, character: null, won: mine > theirs, score: [mine, theirs], rounds: 0, values: line.values, source: g.source });
    }
  }
  return out;
}
