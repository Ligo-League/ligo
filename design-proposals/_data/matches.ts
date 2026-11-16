// LFR Season 3 fixtures. Weeks 1–5 keep the real results of fixtures/lfr-s3-matches.csv; from
// week 6 (the mock "now") the states are set by hand so every status of the brief appears once.

import { NOW, paris } from './format.ts';
import { weekRange } from './competitions.ts';
import { hash, pick, rng, shuffle } from './rng.ts';
import { teamByCode, type Team } from './teams.ts';
import { MAP_POOL, simulate, type GameSim, type MapName } from './sim.ts';
import { starters } from './players.ts';

export type MatchStatus =
  | 'to_schedule'
  | 'proposed'
  | 'scheduled'
  | 'reported'
  | 'disputed'
  | 'validated'
  | 'forfeit'
  | 'void'
  | 'no_result';

export type StatsSource = 'replay_verified' | 'replay_unverified' | 'manual' | 'none';

export interface VetoStep {
  seq: number;
  team: 'a' | 'b' | null;
  action: 'ban' | 'pick' | 'decider' | 'side' | 'ot_side';
  map: MapName | null;
  side?: 'atk' | 'def';
  timedOut?: boolean;
  /** Seconds the team took. */
  took?: number;
  by?: string;
}

export interface Match {
  id: number;
  competition: string;
  season: string;
  division: string;
  stage: 'league' | 'cup' | 'barrage';
  round?: string;
  week: number;
  bestOf: number;
  a: Team;
  b: Team;
  status: MatchStatus;
  /** Played in the extension week (a match of the previous week). */
  extension: boolean;
  autoScheduled: boolean;
  scheduledAt: number | null;
  proposal: { by: 'a' | 'b'; at: number; madeAt: number } | null;
  score: [number, number] | null;
  forfeit: { by: 'a' | 'b' | 'both'; reason: 'no_show' | 'exclusion' } | null;
  /** The original score when the 50% rule turned a played match into a forfeit. */
  convertedFrom: [number, number] | null;
  reported: { by: 'a' | 'b'; at: number; score: [number, number] } | null;
  disputed: { by: 'a' | 'b'; at: number } | null;
  voidReason?: string;
  /** League: lower rank has side selection and bans first; higher rank hosts. */
  host: 'a' | 'b' | null;
  sideChooser: 'a' | 'b' | null;
  otSideChooser: 'a' | 'b' | null;
  coinToss: { winner: 'a' | 'b'; chose: 'side' | 'first_ban' } | null;
  map: MapName | null;
  veto: VetoStep[];
  vetoState: 'not_started' | 'in_progress' | 'done';
  stats: StatsSource;
  game: GameSim | null;
  stream: string | null;
  validatedAt: number | null;
}

// division, week, a, b, result, score_a, score_b, forfeit_by (the seed's columns)
const CSV = `Ligue 1,1,GREED1,OUTSOUKI,played,7,1,
Ligue 1,1,NIGHTWOLVES,RPV,forfeit,,,NIGHTWOLVES
Ligue 1,1,DEVIL,WMATES,played,5,7,
Ligue 1,1,RCK,GREED2,played,5,7,
Ligue 1,1,NTS,CIVITAS,played,1,7,
Ligue 1,2,RPV,GREED1,played,7,4,
Ligue 1,2,OUTSOUKI,DEVIL,forfeit,,,OUTSOUKI
Ligue 1,2,GREED2,NIGHTWOLVES,forfeit,,,NIGHTWOLVES
Ligue 1,2,WMATES,NTS,played,7,2,
Ligue 1,2,CIVITAS,RCK,played,7,2,
Ligue 1,3,GREED1,DEVIL,played,8,6,
Ligue 1,3,RPV,GREED2,played,7,1,
Ligue 1,3,NTS,OUTSOUKI,forfeit,,,OUTSOUKI
Ligue 1,3,NIGHTWOLVES,CIVITAS,forfeit,,,NIGHTWOLVES
Ligue 1,3,RCK,WMATES,played,3,7,
Ligue 1,4,GREED2,GREED1,played,1,7,
Ligue 1,4,DEVIL,NTS,,,,
Ligue 1,4,CIVITAS,RPV,played,3,7,
Ligue 1,4,OUTSOUKI,RCK,forfeit,,,OUTSOUKI
Ligue 1,4,WMATES,NIGHTWOLVES,forfeit,,,NIGHTWOLVES
Ligue 1,5,GREED1,NTS,forfeit,,,NTS
Ligue 1,5,GREED2,CIVITAS,played,1,7,
Ligue 1,5,RCK,DEVIL,,,,
Ligue 1,5,RPV,WMATES,played,4,7,
Ligue 1,5,NIGHTWOLVES,OUTSOUKI,,,,
Ligue 1,6,CIVITAS,GREED1,played,1,7,
Ligue 1,6,NTS,RCK,forfeit,,,NTS
Ligue 1,6,WMATES,GREED2,,,,
Ligue 1,6,DEVIL,NIGHTWOLVES,,,,
Ligue 1,6,OUTSOUKI,RPV,,,,
Ligue 1,7,GREED1,RCK,,,,
Ligue 1,7,CIVITAS,WMATES,,,,
Ligue 1,7,NIGHTWOLVES,NTS,,,,
Ligue 1,7,GREED2,OUTSOUKI,,,,
Ligue 1,7,RPV,DEVIL,,,,
Ligue 1,8,WMATES,GREED1,,,,
Ligue 1,8,RCK,NIGHTWOLVES,,,,
Ligue 1,8,OUTSOUKI,CIVITAS,,,,
Ligue 1,8,NTS,RPV,,,,
Ligue 1,8,DEVIL,GREED2,,,,
Ligue 1,9,GREED1,NIGHTWOLVES,,,,
Ligue 1,9,WMATES,OUTSOUKI,,,,
Ligue 1,9,RPV,RCK,,,,
Ligue 1,9,CIVITAS,DEVIL,,,,
Ligue 1,9,GREED2,NTS,,,,
Ligue 2,1,SHADE,PANARIA,forfeit,,,SHADE
Ligue 2,1,ORIGINS,ASKIUM,played,8,7,
Ligue 2,1,CLICK,STARLY,forfeit,,,STARLY
Ligue 2,1,LUNARIA,MIXNCHILL,played,4,7,
Ligue 2,1,NOVA2,SPECTRUM,played,8,7,
Ligue 2,1,IGURU,NOVA1,forfeit,,,NOVA1
Ligue 2,2,ASKIUM,SHADE,played,7,3,
Ligue 2,2,PANARIA,CLICK,played,7,3,
Ligue 2,2,MIXNCHILL,ORIGINS,played,7,4,
Ligue 2,2,STARLY,NOVA2,forfeit,,,STARLY
Ligue 2,2,NOVA1,LUNARIA,played,3,7,
Ligue 2,2,SPECTRUM,IGURU,played,3,7,
Ligue 2,3,SHADE,CLICK,played,5,7,
Ligue 2,3,ASKIUM,MIXNCHILL,played,2,7,
Ligue 2,3,NOVA2,PANARIA,played,4,7,
Ligue 2,3,ORIGINS,NOVA1,played,7,2,
Ligue 2,3,IGURU,STARLY,,,,
Ligue 2,3,LUNARIA,SPECTRUM,played,7,0,
Ligue 2,4,MIXNCHILL,SHADE,played,7,3,
Ligue 2,4,CLICK,NOVA2,played,4,7,
Ligue 2,4,NOVA1,ASKIUM,played,2,7,
Ligue 2,4,PANARIA,IGURU,played,7,4,
Ligue 2,4,SPECTRUM,ORIGINS,played,7,1,
Ligue 2,4,STARLY,LUNARIA,forfeit,,,STARLY
Ligue 2,5,SHADE,NOVA2,forfeit,,,SHADE
Ligue 2,5,MIXNCHILL,NOVA1,played,7,3,
Ligue 2,5,IGURU,CLICK,,,,
Ligue 2,5,ASKIUM,SPECTRUM,,,,
Ligue 2,5,LUNARIA,PANARIA,played,3,7,
Ligue 2,5,ORIGINS,STARLY,forfeit,,,STARLY
Ligue 2,6,NOVA1,SHADE,forfeit,,,NOVA1
Ligue 2,6,NOVA2,IGURU,,,,
Ligue 2,6,SPECTRUM,MIXNCHILL,,,,
Ligue 2,6,CLICK,LUNARIA,played,2,7,
Ligue 2,6,STARLY,ASKIUM,,,,
Ligue 2,6,PANARIA,ORIGINS,played,7,1,
Ligue 2,7,SHADE,IGURU,,,,
Ligue 2,7,NOVA1,SPECTRUM,,,,
Ligue 2,7,LUNARIA,NOVA2,,,,
Ligue 2,7,MIXNCHILL,STARLY,,,,
Ligue 2,7,ORIGINS,CLICK,,,,
Ligue 2,7,ASKIUM,PANARIA,,,,
Ligue 2,8,SPECTRUM,SHADE,,,,
Ligue 2,8,IGURU,LUNARIA,,,,
Ligue 2,8,STARLY,NOVA1,,,,
Ligue 2,8,NOVA2,ORIGINS,,,,
Ligue 2,8,PANARIA,MIXNCHILL,,,,
Ligue 2,8,CLICK,ASKIUM,,,,
Ligue 2,9,SHADE,LUNARIA,,,,
Ligue 2,9,SPECTRUM,STARLY,,,,
Ligue 2,9,ORIGINS,IGURU,,,,
Ligue 2,9,NOVA1,PANARIA,,,,
Ligue 2,9,ASKIUM,NOVA2,,,,
Ligue 2,9,MIXNCHILL,CLICK,,,,
Ligue 2,10,STARLY,SHADE,,,,
Ligue 2,10,LUNARIA,ORIGINS,,,,
Ligue 2,10,PANARIA,SPECTRUM,,,,
Ligue 2,10,IGURU,ASKIUM,,,,
Ligue 2,10,CLICK,NOVA1,,,,
Ligue 2,10,NOVA2,MIXNCHILL,,,,
Ligue 2,11,SHADE,ORIGINS,,,,
Ligue 2,11,STARLY,PANARIA,,,,
Ligue 2,11,ASKIUM,LUNARIA,,,,
Ligue 2,11,SPECTRUM,CLICK,,,,
Ligue 2,11,MIXNCHILL,IGURU,,,,
Ligue 2,11,NOVA1,NOVA2,,,,`;

/** Teams excluded after their third forfeit (design doc section 5). */
export const EXCLUDED: Record<string, { at: number; reason: string }> = {
  'nightwolves-esport': { at: paris(2026, 11, 8, 23, 59), reason: '3e forfait (semaine 3)' },
  outsouki: { at: paris(2026, 11, 15, 23, 59), reason: '3e forfait (semaine 4)' },
  'starly-esport-club': { at: paris(2026, 11, 15, 23, 59), reason: '3e forfait (semaine 4)' },
};

export const SANCTIONS = [
  {
    team: 'rck-esport',
    division: 'ligue-1',
    points: -3,
    at: paris(2026, 11, 12, 18, 0),
    reason: 'Fichiers MOSS non transmis (semaines 2 et 4), article 10.2',
  },
  {
    team: 'nova-1-esport',
    division: 'ligue-2',
    points: 0,
    at: paris(2026, 11, 25, 23, 59),
    reason: 'Avertissement : 2e forfait (semaine 6)',
  },
];

const STREAMS = ['https://twitch.tv/lfr_r6', 'https://twitch.tv/greed_esport', 'https://twitch.tv/castfr_siege'];

/** Hand-set states from week 4 on, keyed "division:week:A:B". */
type Override = Partial<Omit<Match, 'a' | 'b'>> & { day?: [number, number, number, number, number] };
const OVERRIDES: Record<string, Override> = {
  // Ligue 1
  'Ligue 1:4:DEVIL:NTS': { status: 'void', voidReason: 'Annulé par le staff : serveur hôte hors service, match rejoué en semaine 9' },
  'Ligue 1:5:RCK:DEVIL': { status: 'scheduled', extension: true, day: [2026, 11, 28, 20, 0], proposal: null },
  'Ligue 1:5:NIGHTWOLVES:OUTSOUKI': { status: 'no_result' },
  'Ligue 1:6:CIVITAS:GREED1': { day: [2026, 11, 24, 21, 0], stats: 'none' },
  'Ligue 1:6:NTS:RCK': { day: [2026, 11, 25, 21, 0] },
  'Ligue 1:6:WMATES:GREED2': { status: 'scheduled', day: [2026, 11, 26, 21, 0], vetoState: 'in_progress', stream: 'https://twitch.tv/lfr_r6' },
  'Ligue 1:3:GREED1:DEVIL': { day: [2026, 11, 3, 21, 0], stats: 'replay_verified', map: 'Clubhouse', rehostAfter: 6 } as Override,
  'Ligue 1:7:GREED1:RCK': { status: 'scheduled', day: [2026, 12, 1, 21, 0] },
  'Ligue 1:7:CIVITAS:WMATES': { status: 'proposed', proposal: { by: 'a', at: paris(2026, 12, 2, 21, 0), madeAt: paris(2026, 11, 26, 18, 5) } },
  'Ligue 1:7:RPV:DEVIL': { status: 'proposed', proposal: { by: 'b', at: paris(2026, 12, 3, 20, 30), madeAt: paris(2026, 11, 25, 22, 41) } },
  // Ligue 2
  'Ligue 2:1:ORIGINS:ASKIUM': { stats: 'replay_verified', map: 'Bank' },
  'Ligue 2:4:PANARIA:IGURU': { extension: true, day: [2026, 11, 16, 21, 0], stats: 'replay_unverified' },
  'Ligue 2:5:IGURU:CLICK': {
    status: 'disputed', extension: true, day: [2026, 11, 24, 21, 30],
    reported: { by: 'a', at: paris(2026, 11, 24, 22, 31), score: [7, 5] },
    disputed: { by: 'b', at: paris(2026, 11, 24, 23, 2) },
  },
  'Ligue 2:5:ASKIUM:SPECTRUM': { status: 'scheduled', extension: true, autoScheduled: true, day: [2026, 11, 29, 21, 0] },
  'Ligue 2:6:NOVA1:SHADE': { day: [2026, 11, 25, 20, 0] },
  'Ligue 2:6:NOVA2:IGURU': { status: 'proposed', proposal: { by: 'a', at: paris(2026, 11, 27, 21, 30), madeAt: paris(2026, 11, 26, 12, 14) } },
  'Ligue 2:6:SPECTRUM:MIXNCHILL': {
    status: 'reported', day: [2026, 11, 26, 19, 0],
    reported: { by: 'b', at: paris(2026, 11, 26, 20, 12), score: [5, 7] },
  },
  'Ligue 2:6:CLICK:LUNARIA': { day: [2026, 11, 23, 21, 0], stats: 'replay_unverified', map: 'Chalet' },
  'Ligue 2:6:PANARIA:ORIGINS': { day: [2026, 11, 25, 21, 30], stats: 'manual', map: 'Border' },
  'Ligue 2:7:LUNARIA:NOVA2': { status: 'scheduled', day: [2026, 11, 30, 21, 30] },
  'Ligue 2:7:ORIGINS:CLICK': { status: 'proposed', proposal: { by: 'b', at: paris(2026, 12, 1, 20, 0), madeAt: paris(2026, 11, 26, 9, 30) } },
};

let nextId = 4100;

function eveningIn(r: () => number, week: number): number {
  const { start } = weekRange(week);
  const d = new Date(start);
  const dayOffset = Math.floor(r() * 4); // Monday to Thursday
  const slot = pick(r, [[20, 0], [20, 30], [21, 0], [21, 0], [21, 30]] as const);
  return paris(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate() + 1 + dayOffset, slot[0], slot[1]);
}

/** A BO1 veto: A ban, B ban, … eight bans, the map left is played; then the sides. */
export function bo1Veto(key: string, map: MapName, sideChooser: 'a' | 'b', firstBan: 'a' | 'b', upTo = 99): VetoStep[] {
  const r = rng(hash(key + 'veto'));
  const others = shuffle(r, MAP_POOL.filter((m) => m !== map));
  const steps: VetoStep[] = [];
  const other = (t: 'a' | 'b'): 'a' | 'b' => (t === 'a' ? 'b' : 'a');
  for (let i = 0; i < 8; i++) {
    const team = i % 2 === 0 ? firstBan : other(firstBan);
    steps.push({ seq: i + 1, team, action: 'ban', map: others[i] as MapName, took: 20 + Math.floor(r() * 150), ...(key.includes('Ligue 2:3') && i === 5 ? { timedOut: true, took: 240 } : {}) });
  }
  steps.push({ seq: 9, team: null, action: 'decider', map });
  steps.push({ seq: 10, team: sideChooser, action: 'side', map, side: r() > 0.45 ? 'def' : 'atk', took: 15 + Math.floor(r() * 40) });
  steps.push({ seq: 11, team: other(sideChooser), action: 'ot_side', map, side: r() > 0.5 ? 'def' : 'atk', took: 10 + Math.floor(r() * 30) });
  return steps.slice(0, upTo);
}

export const matches: Match[] = [];

for (const line of CSV.split('\n')) {
  const [division, weekS, ca, cb, result, sa, sb, fby] = line.split(',') as string[];
  const week = Number(weekS);
  const a = teamByCode.get(`lfr:${ca}`) as Team;
  const b = teamByCode.get(`lfr:${cb}`) as Team;
  const key = `${division}:${week}:${ca}:${cb}`;
  const r = rng(hash(key));
  const ov = OVERRIDES[key] ?? {};
  const { start } = weekRange(week);
  let status: MatchStatus = 'to_schedule';
  let score: [number, number] | null = null;
  let forfeit: Match['forfeit'] = null;
  if (result === 'played') {
    status = 'validated';
    score = [Number(sa), Number(sb)];
  } else if (result === 'forfeit' && start < NOW) {
    status = 'forfeit';
    forfeit = { by: fby === ca ? 'a' : 'b', reason: 'no_show' };
  }
  if (ov.status) status = ov.status;
  const day = (ov as { day?: number[] }).day;
  const scheduledAt = day
    ? paris(day[0] as number, day[1] as number, day[2] as number, day[3] as number, day[4] as number)
    : status === 'validated' || status === 'forfeit'
      ? eveningIn(r, week)
      : null;
  const map: MapName | null = ov.map ?? (status === 'validated' ? pick(r, MAP_POOL) : null);
  const firstWeek = week === 1;
  const coinToss: Match['coinToss'] = firstWeek ? { winner: r() > 0.5 ? 'a' : 'b', chose: r() > 0.5 ? 'side' : 'first_ban' } : null;
  const sideChooser: 'a' | 'b' = coinToss ? (coinToss.chose === 'side' ? coinToss.winner : coinToss.winner === 'a' ? 'b' : 'a') : r() > 0.5 ? 'a' : 'b';
  const m: Match = {
    id: nextId++,
    competition: 'lfr',
    season: 's3',
    division: division === 'Ligue 1' ? 'ligue-1' : 'ligue-2',
    stage: 'league',
    week,
    bestOf: 1,
    a,
    b,
    status,
    extension: ov.extension ?? false,
    autoScheduled: ov.autoScheduled ?? false,
    scheduledAt,
    proposal: ov.proposal ?? null,
    score,
    forfeit,
    convertedFrom: null,
    reported: ov.reported ?? null,
    disputed: ov.disputed ?? null,
    ...(ov.voidReason ? { voidReason: ov.voidReason } : {}),
    host: firstWeek ? null : sideChooser === 'a' ? 'b' : 'a',
    sideChooser,
    otSideChooser: sideChooser === 'a' ? 'b' : 'a',
    coinToss,
    map,
    veto: [],
    vetoState: map ? 'done' : (ov.vetoState ?? 'not_started'),
    stats: ov.stats ?? (score ? (pick(r, ['replay_verified', 'replay_verified', 'replay_verified', 'replay_verified', 'manual', 'none']) as StatsSource) : 'none'),
    game: null,
    stream: ov.stream ?? (score && r() > 0.6 ? pick(r, STREAMS) : null),
    validatedAt: null,
  };
  const firstBan: 'a' | 'b' = coinToss && coinToss.chose === 'first_ban' ? coinToss.winner : sideChooser;
  if (m.map && score) {
    m.veto = bo1Veto(key, m.map, sideChooser, firstBan);
    const side = m.veto.find((s) => s.action === 'side');
    const ot = m.veto.find((s) => s.action === 'ot_side');
    const startAttacker: 'a' | 'b' = side?.side === 'atk' ? sideChooser : sideChooser === 'a' ? 'b' : 'a';
    const otAttacker: 'a' | 'b' = ot?.side === 'atk' ? (ot.team as 'a' | 'b') : ot?.team === 'a' ? 'b' : 'a';
    const rehostAfter = (ov as { rehostAfter?: number }).rehostAfter;
    m.game = simulate({
      key,
      map: m.map,
      scoreA: score[0],
      scoreB: score[1],
      lineupA: starters(a),
      lineupB: starters(b),
      startAttacker,
      otAttacker,
      ...(rehostAfter !== undefined ? { rehostAfter } : {}),
      biasA: hash(a.slug) % 4,
      biasB: hash(b.slug) % 4,
    });
    m.validatedAt = (m.scheduledAt ?? start) + 75 * 60_000;
  }
  if (m.status === 'forfeit') m.validatedAt = (m.scheduledAt ?? start) + 30 * 60_000;
  if (ov.vetoState === 'in_progress') {
    // Tonight's veto: Greed Academy (lower rank) bans first; step 5 of 9 is theirs.
    m.map = null;
    m.veto = bo1Veto(key, 'Consulate', sideChooser, sideChooser, 4).map((s, i) => (i === 2 ? { ...s, took: 211 } : s));
  }
  if (m.status === 'reported' || m.status === 'disputed') m.score = null;
  matches.push(m);
}

// The 50% rule (design doc section 5), applied the way standings apply it: shown on the
// calendar too, so a visitor sees why a played match now reads as a forfeit.
for (const [slug] of Object.entries(EXCLUDED)) {
  const own = matches.filter((m) => (m.a.slug === slug || m.b.slug === slug) && m.status !== 'void');
  const side = (m: Match): 'a' | 'b' => (m.a.slug === slug ? 'a' : 'b');
  const played = own.filter((m) => m.status === 'validated' && m.score).length;
  const half = played * 2 >= own.length;
  for (const m of own) {
    const t = side(m);
    const opp = t === 'a' ? m.b : m.a;
    if (m.status === 'forfeit' || m.status === 'no_result') continue;
    if (EXCLUDED[opp.slug]) {
      m.status = 'no_result';
      continue;
    }
    if (m.status === 'validated' && m.score) {
      if (half) continue;
      m.convertedFrom = m.score;
    }
    m.status = 'forfeit';
    m.score = null;
    m.forfeit = { by: t, reason: 'exclusion' };
    m.proposal = null;
    m.vetoState = 'not_started';
  }
}

/** The finished veto of tonight's match, for the "finished" state of the veto page. */
export function finishedVetoOf(m: Match): VetoStep[] {
  return bo1Veto(`${m.division}:${m.week}:fin`, 'Consulate', m.sideChooser ?? 'a', m.sideChooser ?? 'a').map((s, i) =>
    i === 2 ? { ...s, took: 211 } : i === 6 ? { ...s, timedOut: true, took: 240 } : s,
  );
}

export const matchById = (id: number) => matches.find((m) => m.id === id);
export const findMatch = (division: string, week: number, aSlug: string, bSlug: string) =>
  matches.find((m) => m.division === division && m.week === week && m.a.slug === aSlug && m.b.slug === bSlug) as Match;
