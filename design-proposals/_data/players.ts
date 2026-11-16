// Players: gamer tags of uneven length, nationalities mostly FR and BE. Rosters are generated
// with a seeded RNG except the featured ones (Greed Esport, W Mates), which are written by hand.

import { hash, pick, rng, shuffle, slugify } from './rng.ts';
import { teams, clubs, type Nat, type Team } from './teams.ts';

export type Role = 'IGL' | 'Entry' | 'Support' | 'Flex' | 'Ancre';

export interface Player {
  slug: string;
  tag: string;
  nat: Nat;
  /** Ubisoft rank as the player typed it on /me (M-28). */
  rank: string;
  consent: boolean;
  role: Role | null;
  /** Discord username, shown to logged-in members only. */
  discord: string;
  /** Skill knobs for the simulator, not shown anywhere. */
  skill: number;
  hs: number;
}

export interface RosterEntry {
  player: string;
  role: 'player' | 'sub';
  captain: boolean;
  position: Role;
}

const TAGS = [
  'Kyzo', 'Vexo', 'Mazzi', 'Ikaru', 'Pyrø', 'Tchoupi', 'Waffle', 'Naru', 'Lyrik', 'Rafal',
  'Kenji', 'Zorg', 'Bastii', 'Elyos', 'Frostyy', 'Hanzo', 'Jinxx', 'Koda', 'Lukaa', 'Mizu',
  'Nekro', 'Orphée', 'Qwerty', 'Ryuu', 'Sakko', 'Tenma', 'Ulric', 'Vortek', 'Wakz', 'Xeno',
  'Yoshi', 'Zelos', 'Akira.', 'Caramel', 'Dédé', 'Eskobar', 'Falkør', 'Hexa', 'Isko', 'Kalbo',
  'Lorenzo', 'Matrix', 'Nuage', 'Oxy', 'Pépito', 'Quetzal', 'Rookie', 'Silvh', 'Toumi', 'Uzu',
  'Valouz', 'Wolfy', 'Xyl', 'Yanis.R6', 'Zebulon', 'Aïko', 'Brutus', 'Corentin', 'Darko', 'Ezra',
  'Fennec', 'Gaspard', 'Hydra', 'Ilyes', 'Jomo', 'Moustik', 'Nolan', 'Orcus', 'Pharaon', 'Quinn',
  'Rémi', 'Sly', 'Ursa', 'Vlad', 'Wazabi', 'Xanto', 'Yuki', 'mT.Kenshi', 'Sn0w', 'HaZe',
  'ixel', 'PetitPoney', 'LeFourbe', 'Margoulin', 'TonTon Flingueur', 'Mr. Grenadine', 'xX_Dragonnier_Xx',
  'Chocapic', 'Raclette', 'Speculoos', 'Gaufre', 'Bakou', 'Cypher.', 'Daxx', 'Enzo-', 'Fizz',
  'Gloups', 'Hiro', 'Inkaa', 'Jeyz', 'Kolt', 'Lazuli', 'Mordor', 'Nox', 'Ozone', 'Pakito',
  'Quokka', 'Riko', 'Saphyr', 'Titan', 'Uriel', 'Venom', 'Wyrm', 'Xavii', 'Yzer', 'Zwak',
  'Arès', 'Bolt', 'Ciko', 'Drako', 'Elixir', 'Fafnir', 'Gobz', 'Hakim', 'Ivy', 'Jaxon',
  'Kwak', 'Lumen', 'Merguez', 'Nash', 'Onyx', 'Pistou', 'Rhino', 'Sushi', 'Twix', 'Ugo',
  'Vasco', 'Willow', 'Yaya', 'Zeph', 'Bricoleur', 'Lezard', 'Grimm', 'Coach Mimi', 'Baloo', 'Capi',
  'Dimitri', 'Ernesto', 'Fluffy', 'Gringo', 'Houblon', 'Ichigo', 'Jojo', 'Kaïros', 'Loulou', 'Mamba',
  'Nikko', 'Orion', 'Paprika', 'Rasko', 'Shiro', 'Tango', 'Volt', 'Wasabi', 'Yeti', 'Zap',
  'Albator', 'Biscotte', 'Chewie', 'Dino', 'Frelon', 'Galak', 'Hibou', 'Kiwi', 'Mojito', 'Pingouin',
  'Rafiki', 'Sardine', 'Taupe', 'Vanille', 'Zorro', 'Aquila', 'Bambou', 'Cobalt', 'Duke', 'Fjord',
  'Glace', 'Krypto', 'Limbo', 'Mistral', 'Neutron', 'Pixel', 'Ronin', 'Sigma', 'Tornado', 'Vega',
];

const RANKS = ['Champion', 'Diamant I', 'Diamant II', 'Diamant III', 'Émeraude I', 'Émeraude II', 'Émeraude III', 'Platine I', 'Platine II'];

function natFor(r: () => number): Nat {
  const x = r();
  return x < 0.62 ? 'FR' : x < 0.84 ? 'BE' : x < 0.91 ? 'CH' : x < 0.96 ? 'LU' : 'MA';
}

const pool = [...TAGS];
const taken = new Set<string>();
function takeTag(r: () => number, wanted?: string): string {
  if (wanted) {
    taken.add(wanted);
    return wanted;
  }
  for (let tries = 0; ; tries++) {
    let tag = pool[Math.floor(r() * pool.length)] as string;
    // The hand list runs out before the officials: compose a variant, as players do.
    if (tries > 40) tag = `${tag}${pick(r, ['', '.', '_'])}${pick(r, ['TV', 'GG', '59', '13', 'V2', 'Jr', 'x', '77', 'off'])}`;
    if (!taken.has(tag) && !players.has(slugify(tag))) {
      taken.add(tag);
      return tag;
    }
  }
}

export const players = new Map<string, Player>();
export const rosters = new Map<string, RosterEntry[]>();

function addPlayer(r: () => number, tag: string, opts: Partial<Player> = {}): Player {
  const p: Player = {
    slug: slugify(tag),
    tag,
    nat: opts.nat ?? natFor(r),
    rank: opts.rank ?? pick(r, RANKS),
    consent: opts.consent ?? r() > 0.06,
    role: opts.role ?? null,
    discord: slugify(tag).replace(/-/g, '_') + (r() > 0.5 ? String(Math.floor(r() * 90 + 10)) : ''),
    skill: opts.skill ?? 0.75 + r() * 0.5,
    hs: opts.hs ?? 0.35 + r() * 0.25,
  };
  players.set(p.slug, p);
  return p;
}

// Hand-written featured rosters: the team page, player page and the anchor match use them.
const FEATURED: Record<string, { tag: string; nat: Nat; pos: Role; sub?: true; captain?: true; consent?: false; skill?: number; rank?: string }[]> = {
  'greed-esport': [
    { tag: 'Kyzo', nat: 'FR', pos: 'IGL', captain: true, skill: 1.0, rank: 'Champion' },
    { tag: 'Vexo', nat: 'FR', pos: 'Entry', skill: 1.45, rank: 'Champion' },
    { tag: 'Mazzi', nat: 'BE', pos: 'Support', skill: 0.95, rank: 'Diamant I' },
    { tag: 'Ikaru', nat: 'CH', pos: 'Flex', skill: 1.1, rank: 'Diamant II' },
    { tag: 'Pyrø', nat: 'FR', pos: 'Ancre', consent: false, skill: 1.0, rank: 'Diamant I' },
    { tag: 'Tchoupi', nat: 'FR', pos: 'Flex', sub: true, rank: 'Émeraude I' },
    { tag: 'Waffle', nat: 'BE', pos: 'Support', sub: true, rank: 'Diamant III' },
  ],
  'w-mates': [
    { tag: 'Naru', nat: 'BE', pos: 'IGL', captain: true, skill: 1.05 },
    { tag: 'Lyrik', nat: 'BE', pos: 'Entry', skill: 1.2 },
    { tag: 'TonTon Flingueur', nat: 'FR', pos: 'Support', skill: 1.0 },
    { tag: 'Rafal', nat: 'LU', pos: 'Flex', skill: 1.1 },
    { tag: 'Kenji', nat: 'FR', pos: 'Ancre', skill: 1.0 },
    { tag: 'Speculoos', nat: 'BE', pos: 'Entry', sub: true },
  ],
};

const POSITIONS: Role[] = ['IGL', 'Entry', 'Support', 'Flex', 'Ancre'];

// Reserve the hand-written tags so a generated roster never takes them first.
for (const list of Object.values(FEATURED)) for (const f of list) taken.add(f.tag);
for (const t of ['Grimm', 'Houblon', 'Lezard', 'Bricoleur']) taken.add(t);

for (const t of teams) {
  const r = rng(hash(t.slug));
  const featured = FEATURED[t.slug];
  const entries: RosterEntry[] = [];
  if (featured) {
    for (const f of featured) {
      const p = addPlayer(r, takeTag(r, f.tag), {
        nat: f.nat,
        consent: f.consent ?? true,
        role: f.pos,
        ...(f.skill !== undefined ? { skill: f.skill } : {}),
        ...(f.rank !== undefined ? { rank: f.rank } : {}),
      });
      entries.push({ player: p.slug, role: f.sub ? 'sub' : 'player', captain: !!f.captain, position: f.pos });
    }
  } else {
    const size = t.title === 'rocket_league' ? 3 : 5;
    const subs = t.title === 'rocket_league' ? (r() > 0.5 ? 1 : 0) : Math.floor(r() * 3);
    const positions = shuffle(r, POSITIONS);
    for (let i = 0; i < size + subs; i++) {
      const pos = t.title === 'r6' ? (positions[i % 5] as Role) : 'Flex';
      const p = addPlayer(r, takeTag(r), { role: t.title === 'r6' ? pos : null });
      entries.push({ player: p.slug, role: i < size ? 'player' : 'sub', captain: i === 0, position: pos });
    }
  }
  rosters.set(t.slug, entries);
}

// Officials: one owner per club, managers and a coach per roster.
const staffRng = rng(77);
for (const c of clubs) {
  const owner = addPlayer(staffRng, takeTag(staffRng, c.slug === 'greed' ? 'Grimm' : undefined), { consent: true });
  c.officials.push({ player: owner.slug, role: 'owner' });
  if (staffRng() > 0.5 || c.slug === 'greed') {
    const m = addPlayer(staffRng, takeTag(staffRng, c.slug === 'greed' ? 'Houblon' : undefined), {});
    c.officials.push({ player: m.slug, role: 'manager' });
  }
}
for (const t of teams) {
  const isGreed = t.slug === 'greed-esport';
  const manager = addPlayer(staffRng, takeTag(staffRng, isGreed ? 'Lezard' : undefined), {});
  t.staff.push({ player: manager.slug, role: 'manager' });
  if (t.title !== 'rocket_league' && (staffRng() > 0.3 || isGreed)) {
    const coach = addPlayer(staffRng, takeTag(staffRng, isGreed ? 'Bricoleur' : undefined), {});
    t.staff.push({ player: coach.slug, role: 'coach' });
  }
}

export function player(slug: string): Player {
  const p = players.get(slug);
  if (!p) throw new Error(`unknown player ${slug}`);
  return p;
}

export const starters = (t: Team | string): string[] =>
  (rosters.get(typeof t === 'string' ? t : t.slug) ?? []).filter((e) => e.role === 'player').map((e) => e.player);

/** Which roster a player is on (current season), if any. */
export function teamOf(playerSlug: string): Team | null {
  for (const t of teams) if ((rosters.get(t.slug) ?? []).some((e) => e.player === playerSlug)) return t;
  return null;
}
