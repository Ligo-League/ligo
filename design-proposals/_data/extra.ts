// Everything that is not the LFR Season 3 round robin: the cup and the barrage, the other
// leagues, the recruitment board, the mercato, awards, the staff queue, rules versions, uploads.

import { NOW, paris } from './format.ts';
import { findMatch, matches, type Match, type StatsSource } from './matches.ts';
import { player, players, rosters, starters } from './players.ts';
import { hash, pick, rng, shuffle } from './rng.ts';
import { simulate, MAP_POOL, type GameSim, type MapName } from './sim.ts';
import { team, teams, type Team } from './teams.ts';
import { hasStats, isReplay, totalsFor } from './stats.ts';
import { derived } from './sim.ts';

// ---------------------------------------------------------------------------------------------
// Coupe de France (its own mock date: Thursday 21 January 2027, quarter-finals under way).

export const CUP_NOW = paris(2027, 1, 21, 21, 40);

export interface CupSeed {
  seed: number;
  team: Team;
  division: 'L1' | 'L2';
  finalRank: number;
}

const L1_FINAL = ['greed-esport', 'w-mates', 'rpv-esport', 'civitas-esport', 'devil-black-esport', 'rck-esport', 'greed-academy', 'nts-kastuki'];
const L2_FINAL = ['panaria-lair', 'mixt-n-chill', 'nova-2-esport', 'lunaria-esport', 'iguru-esport', 'askium-esport', 'origins-legion', 'wmates-spectrum', 'click-gaming', 'shade', 'nova-1-esport'];

export const cupSeeds: CupSeed[] = [
  ...L1_FINAL.map((s, i) => ({ seed: i + 1, team: team(s), division: 'L1' as const, finalRank: i + 1 })),
  ...L2_FINAL.map((s, i) => ({ seed: i + 9, team: team(s), division: 'L2' as const, finalRank: i + 1 })),
];

export interface CupGame {
  n: number;
  map: MapName;
  score: [number, number] | null;
  pickedBy: 'a' | 'b' | null;
  startSide: { team: 'a' | 'b'; side: 'atk' | 'def' } | null;
  sim: GameSim | null;
  stats: StatsSource;
  live?: boolean;
}

export interface CupMatch {
  id: number;
  round: 'prelim' | 'r16' | 'qf' | 'sf' | 'final';
  slot: number;
  bestOf: 1 | 3 | 5;
  a: CupSeed | null;
  b: CupSeed | null;
  /** Text for an empty side ("Vainqueur 16e #2"). */
  aFrom?: string;
  bFrom?: string;
  bye?: boolean;
  status: 'done' | 'live' | 'scheduled' | 'proposed' | 'pending' | 'dq';
  dq?: { side: 'a' | 'b'; reason: string };
  series: [number, number] | null;
  games: CupGame[];
  at: number | null;
  winner: 'a' | 'b' | null;
}

export const CUP_ROUNDS = [
  { key: 'prelim', label: 'Tour préliminaire', bestOf: 1, dates: '12–14 janv.' },
  { key: 'r16', label: 'Huitièmes de finale', bestOf: 3, dates: '15–18 janv.' },
  { key: 'qf', label: 'Quarts de finale', bestOf: 3, dates: '19–24 janv.' },
  { key: 'sf', label: 'Demi-finales', bestOf: 5, dates: '28 janv.' },
  { key: 'final', label: 'Finale', bestOf: 5, dates: '4 févr.' },
] as const;

const seedOf = (n: number) => cupSeeds[n - 1] as CupSeed;
let cupId = 7000;

function cupGames(key: string, a: CupSeed, b: CupSeed, scores: [number, number][], maps: MapName[], stats: StatsSource[] = []): CupGame[] {
  return scores.map((score, i) => ({
    n: i + 1,
    map: maps[i] as MapName,
    score,
    pickedBy: maps.length === 1 ? null : i === scores.length - 1 && scores.length === 3 ? null : i % 2 === 0 ? 'a' : 'b',
    startSide: { team: i % 2 === 0 ? 'b' : 'a', side: i === 1 ? 'atk' : 'def' },
    sim: simulate({
      key: `${key}-${i}`, map: maps[i] as MapName, scoreA: score[0], scoreB: score[1],
      lineupA: starters(a.team), lineupB: starters(b.team), startAttacker: i % 2 === 0 ? 'a' : 'b', otAttacker: 'b',
    }),
    stats: stats[i] ?? 'replay_verified',
  }));
}

function cm(round: CupMatch['round'], slot: number, sa: number | null, sb: number | null, rest: Partial<CupMatch> = {}): CupMatch {
  const bestOf = CUP_ROUNDS.find((r) => r.key === round)?.bestOf as 1 | 3 | 5;
  return {
    id: cupId++, round, slot, bestOf, a: sa ? seedOf(sa) : null, b: sb ? seedOf(sb) : null,
    status: 'pending', series: null, games: [], at: null, winner: null, ...rest,
  };
}

const done = (round: CupMatch['round'], slot: number, sa: number, sb: number, scores: [number, number][], maps: MapName[], at: number): CupMatch => {
  const a = seedOf(sa);
  const b = seedOf(sb);
  const games = cupGames(`cup-${round}-${slot}`, a, b, scores, maps);
  const series: [number, number] = scores.length === 1
    ? [scores[0]?.[0] as number, scores[0]?.[1] as number]
    : [scores.filter((s) => s[0] > s[1]).length, scores.filter((s) => s[1] > s[0]).length];
  return cm(round, slot, sa, sb, { status: 'done', games, series, at, winner: series[0] > series[1] ? 'a' : 'b' });
};

export const cupMatches: CupMatch[] = [
  // Preliminary round, BO1: seeds 14–19. Nova 1 did not show: disqualified.
  cm('prelim', 1, 14, 19, { status: 'dq', dq: { side: 'b', reason: 'Absent à l’heure du match : disqualifié' }, winner: 'a', at: paris(2027, 1, 13, 21, 0) }),
  done('prelim', 2, 15, 18, [[7, 5]], ['Border'], paris(2027, 1, 12, 21, 0)),
  done('prelim', 3, 16, 17, [[8, 7]], ['Kafe Dostoyevsky'], paris(2027, 1, 14, 20, 30)),
  // Round of 16, BO3. Byes for seeds 1–13.
  done('r16', 1, 1, 16, [[7, 3], [7, 4]], ['Clubhouse', 'Bank'], paris(2027, 1, 15, 21, 0)),
  done('r16', 2, 8, 9, [[7, 5], [4, 7], [5, 7]], ['Lair', 'Border', 'Chalet'], paris(2027, 1, 16, 20, 0)),
  done('r16', 3, 5, 12, [[7, 2], [6, 8], [7, 4]], ['Consulate', 'Skyscraper', 'Bank'], paris(2027, 1, 16, 21, 0)),
  done('r16', 4, 4, 13, [[7, 1], [7, 5]], ['Nighthaven Labs', 'Clubhouse'], paris(2027, 1, 17, 21, 0)),
  done('r16', 5, 3, 14, [[7, 4], [7, 6]], ['Chalet', 'Lair'], paris(2027, 1, 17, 20, 0)),
  done('r16', 6, 6, 11, [[3, 7], [6, 8]], ['Bank', 'Kafe Dostoyevsky'], paris(2027, 1, 18, 21, 0)),
  done('r16', 7, 7, 10, [[7, 5], [2, 7], [7, 3]], ['Border', 'Skyscraper', 'Consulate'], paris(2027, 1, 18, 20, 30)),
  done('r16', 8, 2, 15, [[7, 0], [7, 2]], ['Clubhouse', 'Chalet'], paris(2027, 1, 15, 20, 0)),
  // Quarter-finals, BO3: one played, one live, one scheduled, one waiting for a time.
  done('qf', 1, 1, 9, [[7, 5], [4, 7], [8, 6]], ['Clubhouse', 'Border', 'Kafe Dostoyevsky'], paris(2027, 1, 19, 21, 0)),
  cm('qf', 2, 5, 4, {
    status: 'live', series: [1, 0], at: paris(2027, 1, 21, 21, 0),
    games: [
      ...cupGames('cup-qf-2', seedOf(5), seedOf(4), [[7, 4]], ['Consulate']),
      { n: 2, map: 'Bank', score: [3, 2], pickedBy: 'b', startSide: { team: 'a', side: 'atk' }, sim: null, stats: 'none', live: true },
      { n: 3, map: 'Skyscraper', score: null, pickedBy: null, startSide: null, sim: null, stats: 'none' },
    ],
  }),
  cm('qf', 3, 3, 11, { status: 'scheduled', at: paris(2027, 1, 22, 21, 0) }),
  cm('qf', 4, 7, 2, { status: 'proposed', at: paris(2027, 1, 24, 20, 0) }),
  cm('sf', 1, null, null, { aFrom: 'Vainqueur QF 1', bFrom: 'Vainqueur QF 2', status: 'pending', at: paris(2027, 1, 28, 20, 0) }),
  cm('sf', 2, null, null, { aFrom: 'Vainqueur QF 3', bFrom: 'Vainqueur QF 4', status: 'pending', at: paris(2027, 1, 28, 21, 30) }),
  cm('final', 1, null, null, { aFrom: 'Vainqueur DF 1', bFrom: 'Vainqueur DF 2', status: 'pending', at: paris(2027, 2, 4, 21, 0) }),
];
// The semi-final 1 slot A is known: Greed Esport won QF 1.
(cupMatches.find((m) => m.round === 'sf' && m.slot === 1) as CupMatch).a = seedOf(1);

export const cupByes = cupSeeds.filter((s) => s.seed <= 13);

/** The barrage, before the cup: Ligue 1's 8th against Ligue 2's 3rd, BO1. */
export const barrage = {
  label: 'Barrage de montée / maintien',
  a: { team: team('nts-kastuki'), note: 'Ligue 1 · 8e' },
  b: { team: team('nova-2-esport'), note: 'Ligue 2 · 3e' },
  bestOf: 1,
  map: 'Chalet' as MapName,
  score: [5, 7] as [number, number],
  at: paris(2027, 1, 9, 20, 0),
  outcome: 'Nova 2 Esport monte en Ligue 1 ; NTS kastuki descend en Ligue 2 pour la Saison 4.',
};

/** BO3 veto of QF 1 (Greed Esport v Panaria Lair): bans, picks, decider and sides. */
export const cupVetoQf1 = [
  { seq: 1, team: 'a', action: 'ban', map: 'Skyscraper' },
  { seq: 2, team: 'b', action: 'ban', map: 'Nighthaven Labs' },
  { seq: 3, team: 'a', action: 'ban', map: 'Lair' },
  { seq: 4, team: 'b', action: 'ban', map: 'Chalet' },
  { seq: 5, team: 'a', action: 'pick', map: 'Clubhouse' },
  { seq: 6, team: 'b', action: 'side', map: 'Clubhouse', side: 'def', game: 1 },
  { seq: 7, team: 'a', action: 'ot_side', map: 'Clubhouse', side: 'atk', game: 1 },
  { seq: 8, team: 'b', action: 'pick', map: 'Border' },
  { seq: 9, team: 'a', action: 'side', map: 'Border', side: 'atk', game: 2 },
  { seq: 10, team: 'b', action: 'ot_side', map: 'Border', side: 'def', game: 2 },
  { seq: 11, team: 'a', action: 'ban', map: 'Bank' },
  { seq: 12, team: 'b', action: 'ban', map: 'Consulate', timedOut: true },
  { seq: 13, team: null, action: 'decider', map: 'Kafe Dostoyevsky' },
  { seq: 14, team: 'b', action: 'side', map: 'Kafe Dostoyevsky', side: 'def', game: 3, coin: true },
  { seq: 15, team: 'a', action: 'ot_side', map: 'Kafe Dostoyevsky', side: 'atk', game: 3 },
] as const;

// ---------------------------------------------------------------------------------------------
// LFRL (Rocket League): series in BO5, the standings score is goals.

export interface RlSeries {
  id: number;
  week: number;
  a: Team;
  b: Team;
  games: [number, number][];
  at: number;
  status: 'validated' | 'scheduled' | 'to_schedule' | 'reported';
}

const rlTeams = teams.filter((t) => t.competition === 'lfrl');
export const rlSeries: RlSeries[] = (() => {
  const r = rng(4242);
  const list: RlSeries[] = [];
  const order = [...rlTeams];
  let id = 8100;
  for (let w = 1; w <= 7; w++) {
    for (let i = 0; i < 4; i++) {
      const a = order[i] as Team;
      const b = order[order.length - 1 - i] as Team;
      const at = paris(2026, 11, 2 + (w - 1) * 7 + 1 + Math.floor(r() * 3), pick(r, [20, 21]), pick(r, [0, 30]));
      let status: RlSeries['status'] = at < NOW ? 'validated' : w <= 4 ? 'scheduled' : 'to_schedule';
      if (w === 4 && i === 0) status = 'scheduled';
      const games: [number, number][] = [];
      if (status === 'validated') {
        const aWins = r() > 0.5;
        let wa = 0;
        let wb = 0;
        while (wa < 3 && wb < 3) {
          const aw = r() < (aWins ? 0.65 : 0.35);
          const lose = Math.floor(r() * 3);
          const win = lose + 1 + Math.floor(r() * 3);
          games.push(aw ? [win, lose] : [lose, win]);
          if (aw) wa++;
          else wb++;
        }
      }
      list.push({ id: id++, week: w, a, b, games, at, status });
    }
    order.splice(1, 0, order.pop() as Team);
  }
  // Tonight's series in LFRL: W Mates RL against the Turbos, 21:30.
  const tonight = list.find((s) => s.week === 4 && s.status === 'scheduled');
  if (tonight) tonight.at = paris(2026, 11, 26, 21, 30);
  return list;
})();

export function rlStandings() {
  const rows = new Map(rlTeams.map((t) => [t.slug, { team: t, played: 0, wins: 0, losses: 0, gf: 0, ga: 0, gw: 0, gl: 0, points: 0, form: [] as ('W' | 'L')[] }]));
  for (const s of rlSeries) {
    if (s.status !== 'validated') continue;
    const wa = s.games.filter((g) => g[0] > g[1]).length;
    const wb = s.games.length - wa;
    for (const [t, mine, theirs, gw, gl] of [[s.a, 0, 1, wa, wb], [s.b, 1, 0, wb, wa]] as const) {
      const row = rows.get(t.slug);
      if (!row) continue;
      row.played++;
      row.gw += gw;
      row.gl += gl;
      for (const g of s.games) {
        row.gf += g[mine];
        row.ga += g[theirs];
      }
      const won = gw > gl;
      row.wins += won ? 1 : 0;
      row.losses += won ? 0 : 1;
      row.points += won ? 3 : 0;
      row.form.push(won ? 'W' : 'L');
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, diff: r.gf - r.ga, form: r.form.slice(-5) }))
    .sort((x, y) => y.points - x.points || y.diff - x.diff)
    .map((r, i) => ({ ...r, rank: i + 1, zone: i === 0 ? ('champion' as const) : null }));
}

// ---------------------------------------------------------------------------------------------
// FRFL (FACEIT, mixed teams): player standings.

export const frflStandings = (() => {
  const r = rng(99);
  const pool = shuffle(r, [...players.values()].filter((p) => p.role !== null)).slice(0, 22);
  return pool
    .map((p) => {
      const games = 4 + Math.floor(r() * 9);
      const wins = Math.round(games * (0.25 + r() * 0.55));
      return { player: p.slug, games, wins, rating: 22 + r() * 9, diffPerGame: (r() - 0.4) * 4 };
    })
    .sort((x, y) => y.wins * 3 - x.wins * 3 || y.wins / y.games - x.wins / x.games)
    .map((row, i) => ({ ...row, rank: i + 1, qualified: row.games >= 6 }));
})();

// ---------------------------------------------------------------------------------------------
// Home feed: tonight's and this week's matches across competitions.

export const otherTonight = [
  { competition: 'lfrl', label: 'LFRL · Division 1 · Semaine 4', a: 'w-mates-rl', b: 'les-turbos-de-namur', at: paris(2026, 11, 26, 21, 30), bestOf: 5, status: 'scheduled' },
  { competition: 'frfl', label: 'FRFL · Lobby #31', a: null, b: null, at: paris(2026, 11, 26, 22, 0), bestOf: 1, status: 'scheduled', note: '10 joueurs inscrits · équipes tirées à 21:45' },
  { competition: 'lfv', label: 'LFV · Coupe · Demi-finale', a: 'kori-esport', b: 'not-scam-valkyr', at: paris(2026, 12, 3, 21, 0), bestOf: 3, status: 'scheduled' },
];

// ---------------------------------------------------------------------------------------------
// Past meetings for the match preview (Season 2 is closed; typed as history).

export const pastMeetings: Record<string, { season: string; stage: string; at: number; a: string; b: string; score: string; maps: string }[]> = {
  'w-mates|greed-academy': [
    { season: 'LFR Saison 2', stage: 'Coupe de France · Huitième', at: paris(2026, 8, 9, 21, 0), a: 'w-mates', b: 'greed-academy', score: '2–0', maps: 'Clubhouse 7–3 · Bank 7–5' },
    { season: 'LFR Saison 2', stage: 'Barrage', at: paris(2026, 7, 30, 20, 0), a: 'greed-academy', b: 'w-mates', score: '—', maps: 'Pas de rencontre : W Mates était en Ligue 1' },
  ],
};

// ---------------------------------------------------------------------------------------------
// Recruitment board.

export const listings = {
  players: [
    { player: 'Mirabelle', roles: ['Entry', 'Flex'], rank: 'Diamant II', languages: ['FR', 'EN'], availability: 'lun., mer., jeu. · 20:00–23:30', note: 'Ex-Ligue 2 (Saison 2). Cherche une équipe qui scrim 3 soirs par semaine.', posted: paris(2026, 11, 20), expires: paris(2026, 12, 20), nat: 'FR' },
    { player: 'Kestrel', roles: ['Support'], rank: 'Émeraude I', languages: ['FR', 'NL', 'EN'], availability: 'Tous les soirs sauf vendredi', note: 'Support patient, à l’aise sur Thermite et Thatcher. Basé à Gand.', posted: paris(2026, 11, 24), expires: paris(2026, 12, 24), nat: 'BE' },
    { player: 'Babouche', roles: ['IGL'], rank: 'Diamant I', languages: ['FR'], availability: 'mar., jeu., dim.', note: 'IGL depuis 2 saisons en ligue communautaire, cherche un projet sérieux pour la Saison 4.', posted: paris(2026, 11, 9), expires: paris(2026, 12, 9), nat: 'CH' },
    { player: 'Zéphyr', roles: ['Ancre', 'Support'], rank: 'Platine I', languages: ['FR', 'AR'], availability: 'Week-end uniquement', note: 'Disponible comme remplaçant.', posted: paris(2026, 11, 2), expires: paris(2026, 12, 2), nat: 'MA' },
    { player: 'Nordik', roles: ['Flex'], rank: 'Champion', languages: ['FR', 'EN', 'DE'], availability: 'lun.–jeu. · 21:00–00:00', note: '', posted: paris(2026, 11, 25), expires: paris(2026, 12, 25), nat: 'LU' },
  ],
  teams: [
    { team: 'shade', role: 'Entry', note: 'On cherche un entry FR/BE pour finir la saison et préparer la Saison 4. Scrims mar. et jeu.', posted: paris(2026, 11, 18), expires: paris(2026, 12, 18) },
    { team: 'click-gaming', role: 'Remplaçant (tous rôles)', note: 'Remplaçant pour la Coupe de France.', posted: paris(2026, 11, 22), expires: paris(2026, 12, 22) },
    { team: 'askium-esport', role: 'Coach', note: 'Coach bénévole, analyse de replays bienvenue.', posted: paris(2026, 10, 29), expires: paris(2026, 11, 28) },
  ],
};

// Listing players are free agents: make them exist as players with no roster.
for (const l of listings.players) {
  const slug = l.player.toLowerCase();
  if (!players.has(slug)) {
    players.set(slug, { slug, tag: l.player, nat: l.nat as 'FR', rank: l.rank, consent: true, role: null, discord: slug, skill: 1, hs: 0.5 });
  }
}

// ---------------------------------------------------------------------------------------------
// Mercato (the mid-season window of 9–15 November).

export const mercatoWindow = { name: 'Mercato de mi-saison', opens: paris(2026, 11, 9), closes: paris(2026, 11, 15, 23, 59), maxMoves: 3 };
export const mercatoMoves = [
  { at: paris(2026, 11, 15, 19, 2), player: 'Waffle', from: 'click-gaming', to: 'greed-esport', kind: 'transfer', competition: 'lfr' },
  { at: paris(2026, 11, 14, 11, 40), player: 'Moustik', from: null, to: 'shade', kind: 'arrival', competition: 'lfr' },
  { at: paris(2026, 11, 13, 22, 15), player: 'Gaspard', from: 'starly-esport-club', to: null, kind: 'departure', competition: 'lfr' },
  { at: paris(2026, 11, 12, 20, 5), player: 'Elixir', from: 'les-turbos-de-namur', to: 'velocity', kind: 'transfer', competition: 'lfrl' },
  { at: paris(2026, 11, 10, 18, 30), player: 'Coach Mimi', from: null, to: 'lunaria-esport', kind: 'staff', competition: 'lfr' },
];
for (const m of mercatoMoves) {
  const slug = m.player.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (!players.has(slug)) players.set(slug, { slug, tag: m.player, nat: 'FR', rank: 'Diamant III', consent: true, role: null, discord: slug, skill: 1, hs: 0.5 });
}

// ---------------------------------------------------------------------------------------------
// Awards: player of the week (best K/D over the week's replay games, at least 10 rounds).

export const AWARD_RULE = { metric: 'K/D', minRounds: 7, source: 'replays vérifiés ou non' };

export function playerOfWeek(division: string, week: number) {
  let best: { player: string; team: Team; kd: number; kills: number; deaths: number; rounds: number } | null = null;
  for (const t of teams.filter((x) => x.competition === 'lfr' && x.division === division)) {
    for (const e of rosters.get(t.slug) ?? []) {
      const p = player(e.player);
      if (!p.consent) continue;
      const tot = totalsFor(e.player, (m) => m.division === division && m.week === week && isReplay(m));
      if (tot.rounds < AWARD_RULE.minRounds) continue;
      const kd = derived(tot).kd;
      if (!best || kd > best.kd) best = { player: e.player, team: t, kd, kills: tot.kills, deaths: tot.deaths, rounds: tot.rounds };
    }
  }
  return best;
}

export const seasonAwardsS2 = [
  { award: 'MVP de la saison', division: 'Ligue 1', player: 'lyrik', team: 'w-mates', value: 'K/D 1,41 · KOST 74 %' },
  { award: 'Meilleur entry', division: 'Ligue 1', player: 'vexo', team: 'greed-esport', value: 'Entry +23' },
  { award: 'Meilleur clutcher', division: 'Ligue 1', player: 'naru', team: 'w-mates', value: '9 clutchs sur 21' },
  { award: 'MVP de la saison', division: 'Ligue 2', player: 'kyzo', team: 'greed-esport', value: 'K/D 1,33 · KOST 71 %' },
  { award: 'Révélation', division: 'Ligue 2', player: 'ikaru', team: 'greed-esport', value: 'KPR 0,94' },
];
export const seasonAwardsS3 = ['MVP de la saison', 'Meilleur entry', 'Meilleur clutcher', 'Révélation', 'Meilleur IGL (vote des capitaines)'];

// ---------------------------------------------------------------------------------------------
// Staff queue.

const H = 3_600_000;
export const staffQueue = {
  reports: [
    { match: findMatch('ligue-2', 6, 'wmates-spectrum', 'mixt-n-chill'), reportedAt: paris(2026, 11, 26, 20, 12), by: 'b', score: [5, 7], waitingFor: 'Confirmation de Wmates Spectrum' },
  ],
  disputes: [
    { match: findMatch('ligue-2', 5, 'iguru-esport', 'click-gaming'), raisedAt: paris(2026, 11, 24, 23, 2), reason: 'Score incorrect', details: 'La manche 9 a été rejouée après un crash ; le score de la capture ne tient pas compte du re-host. Replays disponibles.', evidence: 2 },
  ],
  requests: [
    { kind: 'Ajout d’un manager', team: 'lunaria-esport', who: 'Coach Mimi', by: 'Rafiki', at: NOW - 30 * H, due: NOW - 6 * H, late: true },
    { kind: 'Ajout d’un coach', team: 'shade', who: 'Bambou', by: 'Pistou', at: NOW - 15 * H, due: NOW + 9 * H, late: false },
    { kind: 'Transfert de propriétaire', team: 'origins-legion', who: 'Onyx', by: 'Ozone', at: NOW - 4 * H, due: NOW + 20 * H, late: false },
    { kind: 'Inscription Saison 2 (LFV)', team: 'kori-esport', who: '5 joueurs, 1 remplaçant', by: 'Aquila', at: NOW - 50 * H, due: NOW - 26 * H, late: true },
  ],
  mismatches: [
    { match: findMatch('ligue-2', 4, 'panaria-lair', 'iguru-esport'), file: 'Match-2026-11-16_21-04-12-60/R07.rec', detail: 'Kills du round 7 différents (JSON envoyé : 3, re-parse : 2)', uploader: 'Saphyr', at: paris(2026, 11, 17, 0, 41) },
  ],
  unknownPlayers: [
    { match: findMatch('ligue-2', 6, 'click-gaming', 'lunaria-esport'), account: 'ShadowFox.LUN', profile: '7c1e…a2f9', side: 'Lunaria Esport', at: paris(2026, 11, 23, 23, 10) },
  ],
  external: [
    { team: 'greed-esport', event: 'Northern Siege Open #4', placement: '3e', teams: 32, at: paris(2026, 11, 22, 14, 0) },
  ],
};

// ---------------------------------------------------------------------------------------------
// Rules versions (the page shows the latest whose effective date has passed).

export const rulesVersions = [
  { version: '3.2', effective: paris(2026, 11, 14), published: paris(2026, 11, 13, 18, 30), by: 'Mistral', summary: 'La confirmation de l’adversaire valide le résultat ; le staff tranche les contestations.' },
  { version: '3.1', effective: paris(2026, 11, 2), published: paris(2026, 10, 30, 21, 0), by: 'Mistral', summary: 'Pool de cartes : Nighthaven Labs remplace Oregon.' },
  { version: '3.0', effective: paris(2026, 10, 19), published: paris(2026, 10, 12, 20, 0), by: 'Sigma', summary: 'Règlement de la Saison 3, voté par les capitaines le 10 octobre.' },
  { version: '2.0', effective: paris(2026, 5, 4), published: paris(2026, 4, 27), by: 'Sigma', summary: 'Règlement de la Saison 2.' },
];

// ---------------------------------------------------------------------------------------------
// Replay upload for Wmates Spectrum v Mixt N' chill (reported tonight), seen by a MNC player.

export const upload = {
  match: findMatch('ligue-2', 6, 'wmates-spectrum', 'mixt-n-chill'),
  uploader: starters('mixt-n-chill')[0] as string,
  folders: [
    { name: 'Match-2026-11-26_19-04-51-104', files: 7, size: 74.2, lobby: '7f3a…19c2', inWindow: true },
    { name: 'Match-2026-11-26_19-31-08-104', files: 6, size: 61.9, lobby: 'b81e…04d7', inWindow: true },
    { name: 'Match-2026-11-24_21-12-33-104', files: 11, size: 129.4, lobby: '22c0…77aa', inWindow: false, note: 'Scrim du 24 nov. : hors de la fenêtre du match' },
  ],
  map: 'Kafe Dostoyevsky' as MapName,
  lobbies: [
    { n: 1, rounds: [['b', 'a', 'b', 'b', 'a', 'b'], 'interrupted'], scoreA: 2, scoreB: 4 },
    { n: 2, rounds: [['a', 'a', 'b', 'a', 'b', 'b']], scoreA: 3, scoreB: 3 },
  ],
  unknown: [{ name: 'ShadowFox.LUN', profile: '7c1e…a2f9', side: 'a' as const }],
  files: [
    { name: 'R01.rec', size: 10.8, progress: 1 },
    { name: 'R02.rec', size: 11.9, progress: 1 },
    { name: 'R03.rec', size: 9.7, progress: 1 },
    { name: 'R04.rec', size: 12.4, progress: 0.82 },
    { name: 'R05.rec', size: 10.2, progress: 0.47 },
    { name: 'R06.rec', size: 13.1, progress: 0.12 },
    { name: 'R07.rec', size: 6.1, progress: 0 },
    { name: 'R01.rec (lobby 2)', size: 10.5, progress: 0 },
  ],
};

// ---------------------------------------------------------------------------------------------
// External results (approved), for the Palmarès tab; tiers set by staff.

export const externalResults: Record<string, { event: string; organiser: string; tier: 'A' | 'B' | 'C' | 'D'; date: number; placement: string; teams: number; prize: string | null; roster: string[] }[]> = {
  'greed-esport': [
    { event: 'Northern Siege Open #3', organiser: 'Northern Siege', tier: 'C', date: paris(2026, 9, 27), placement: '1er', teams: 24, prize: '150 €', roster: ['kyzo', 'vexo', 'mazzi', 'ikaru', 'pyro'] },
    { event: 'Coupe du Grand Est R6', organiser: 'Asso Grand Est Gaming', tier: 'D', date: paris(2026, 8, 16), placement: '2e', teams: 12, prize: null, roster: ['kyzo', 'vexo', 'mazzi', 'ikaru', 'tchoupi'] },
    { event: 'Siege Weekly Cup EU #118', organiser: 'Siege Weekly', tier: 'C', date: paris(2026, 7, 5), placement: '5e–8e', teams: 64, prize: null, roster: ['kyzo', 'vexo', 'mazzi', 'ikaru', 'pyro'] },
    { event: 'LAN Ch’ti 2026', organiser: 'LAN Ch’ti', tier: 'D', date: paris(2026, 4, 19), placement: '3e', teams: 16, prize: '60 €', roster: ['kyzo', 'vexo', 'mazzi', 'ikaru', 'pyro'] },
  ],
};

export const platformResults: Record<string, { season: string; competition: string; stage: string; placement: string; record: string; tier: string }[]> = {
  'greed-esport': [
    { season: 'Saison 3', competition: 'LFR', stage: 'Ligue 1 (en cours)', placement: '1er après 6 semaines', record: '6–1', tier: 'Ligue' },
    { season: 'Saison 2', competition: 'LFR', stage: 'Coupe de France', placement: 'Finaliste', record: '4–1', tier: 'Coupe' },
    { season: 'Saison 2', competition: 'LFR', stage: 'Ligue 1', placement: '3e', record: '6–3', tier: 'Ligue' },
    { season: 'Saison 1', competition: 'LFR', stage: 'Ligue 2', placement: 'Champion, monte en Ligue 1', record: '8–1', tier: 'Ligue' },
  ],
};

// ---------------------------------------------------------------------------------------------
// Careers (player page, as a CV).

export const careers: Record<string, { season: string; competition: string; team: string; division: string; rank: string; maps: number; kd: string; awards: string[] }[]> = {
  vexo: [
    { season: 'Saison 3', competition: 'LFR', team: 'greed-esport', division: 'Ligue 1', rank: '1er (en cours)', maps: 0, kd: '', awards: [] },
    { season: 'Saison 2', competition: 'LFR', team: 'greed-esport', division: 'Ligue 1', rank: '3e · finaliste de la Coupe', maps: 13, kd: '1,24', awards: ['Meilleur entry de Ligue 1'] },
    { season: 'Saison 1', competition: 'LFR', team: 'greed-esport', division: 'Ligue 2', rank: 'Champion', maps: 9, kd: '1,31', awards: ['Joueur de la semaine ×2'] },
  ],
};

export const viewers = {
  anonymous: null,
  player: { name: 'Vexo', player: 'vexo', team: 'greed-esport', role: 'Joueur' },
  official: { name: 'Houblon', player: 'houblon', team: 'greed-academy', role: 'Manager du club Greed' },
  staff: { name: 'Mistral', player: 'mistral', team: null, role: 'Staff LFR' },
};

export const lfrStaff = ['Mistral', 'Sigma', 'Cobalt', 'Aquila'];

/** Matches whose page every proposal renders, by role. */
export const featured = {
  toPlay: findMatch('ligue-1', 6, 'w-mates', 'greed-academy'),
  proposed: findMatch('ligue-2', 6, 'nova-2-esport', 'iguru-esport'),
  played: findMatch('ligue-1', 3, 'greed-esport', 'devil-black-esport'),
  overtime87: findMatch('ligue-2', 1, 'origins-legion', 'askium-esport'),
  forfeit: findMatch('ligue-1', 6, 'nts-kastuki', 'rck-esport'),
  disputed: findMatch('ligue-2', 5, 'iguru-esport', 'click-gaming'),
  reported: findMatch('ligue-2', 6, 'wmates-spectrum', 'mixt-n-chill'),
  unverified: findMatch('ligue-2', 6, 'click-gaming', 'lunaria-esport'),
  manual: findMatch('ligue-2', 6, 'panaria-lair', 'origins-legion'),
  noStats: findMatch('ligue-1', 6, 'civitas-esport', 'greed-esport'),
  autoScheduled: findMatch('ligue-2', 5, 'askium-esport', 'wmates-spectrum'),
  extensionAgreed: findMatch('ligue-1', 5, 'rck-esport', 'devil-black-esport'),
  void: findMatch('ligue-1', 4, 'devil-black-esport', 'nts-kastuki'),
  converted: findMatch('ligue-1', 1, 'greed-esport', 'outsouki'),
  bothExcluded: findMatch('ligue-1', 5, 'nightwolves-esport', 'outsouki'),
  cupBo3: cupMatches.find((m) => m.round === 'qf' && m.slot === 1) as CupMatch,
  team: 'greed-esport',
  club: 'w-mates',
  clubTwoRosters: 'greed',
  player: 'vexo',
  noConsent: 'pyro',
};

export const allMaps = MAP_POOL;
export { hasStats };
export type { Match };
export const allMatches = matches;
