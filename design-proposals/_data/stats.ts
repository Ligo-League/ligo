// Stats built from the simulated rounds: sum first, divide last; replay-only metrics over replay
// maps only, with their coverage; players without consent never appear in stat outputs.

import { matches, type Match } from './matches.ts';
import { player, players, rosters, starters, teamOf } from './players.ts';
import { addRounds, derived, emptyTotals, simulate, MAP_POOL, SITES, type MapName, type Round, type Totals } from './sim.ts';
import { team, teams, type Team } from './teams.ts';
import { hash, pick, rng } from './rng.ts';

export const counted = (m: Match) => m.status === 'validated' && m.game !== null;
export const hasStats = (m: Match) => counted(m) && m.stats !== 'none';
export const isReplay = (m: Match) => m.stats === 'replay_verified' || m.stats === 'replay_unverified';

const sideOf = (m: Match, teamSlug: string): 'a' | 'b' => (m.a.slug === teamSlug ? 'a' : 'b');

export function totalsFor(playerSlug: string, filter: (m: Match) => boolean = () => true): Totals {
  const t = emptyTotals();
  for (const m of matches) {
    if (!hasStats(m) || !filter(m) || !m.game) continue;
    addRounds(t, m.game.rounds, playerSlug, isReplay(m));
  }
  return t;
}

export type Derived = ReturnType<typeof derived>;

export interface MetricDef {
  key: 'kd' | 'kpr' | 'hs' | 'kost' | 'srv' | 'entry' | 'clutch' | 'plants';
  label: string;
  short: string;
  format: 'ratio' | 'percent' | 'signed' | 'int';
  replayOnly: boolean;
}

export const METRICS: MetricDef[] = [
  { key: 'kd', label: 'Ratio K/D', short: 'K/D', format: 'ratio', replayOnly: false },
  { key: 'kpr', label: 'Kills par round', short: 'KPR', format: 'ratio', replayOnly: false },
  { key: 'hs', label: 'Headshots', short: 'HS %', format: 'percent', replayOnly: false },
  { key: 'kost', label: 'KOST', short: 'KOST', format: 'percent', replayOnly: true },
  { key: 'srv', label: 'Survie', short: 'SRV', format: 'percent', replayOnly: true },
  { key: 'entry', label: 'Entry (ouvertures gagnées − perdues)', short: 'Entry', format: 'signed', replayOnly: true },
  { key: 'clutch', label: 'Clutchs gagnés', short: 'Clutch %', format: 'percent', replayOnly: true },
  { key: 'plants', label: 'Désamorceurs posés', short: 'Plants', format: 'int', replayOnly: true },
];

export const metricValue = (t: Totals, key: MetricDef['key']): number | null => {
  const d = derived(t);
  if (key === 'plants') return t.replayRounds ? t.plants : null;
  return d[key] as number | null;
};

/** Rounds a team played in counted matches (for the minimum sample, 30 %). */
export function teamRounds(teamSlug: string): number {
  let n = 0;
  for (const m of matches) if (hasStats(m) && m.game && (m.a.slug === teamSlug || m.b.slug === teamSlug)) n += m.game.rounds.filter((r) => r.kind === 'replay').length;
  return n;
}

export interface LeaderRow {
  player: string;
  team: Team;
  value: number;
  totals: Totals;
  coverage: { replay: number; maps: number };
}

export const MIN_SAMPLE = 0.3;
export const MIN_COVERAGE = 0.6;

/** A leaderboard: consenting players only, minimum sample and coverage (design doc section 9). */
export function leaders(division: string, key: MetricDef['key'], limit = 10): { rows: LeaderRow[]; hidden: number } {
  const def = METRICS.find((x) => x.key === key) as MetricDef;
  const rows: LeaderRow[] = [];
  let hidden = 0;
  for (const t of teams.filter((x) => x.competition === 'lfr' && x.division === division)) {
    const tr = teamRounds(t.slug);
    for (const e of rosters.get(t.slug) ?? []) {
      const p = player(e.player);
      const totals = totalsFor(e.player, (m) => m.division === division);
      if (totals.rounds === 0) continue;
      if (!p.consent) continue;
      const enough = totals.rounds >= MIN_SAMPLE * tr;
      const covered = !def.replayOnly || (totals.maps > 0 && totals.replayMaps / totals.maps >= MIN_COVERAGE);
      const value = metricValue(totals, key);
      if (!enough || !covered || value === null) {
        hidden++;
        continue;
      }
      rows.push({ player: e.player, team: t, value, totals, coverage: { replay: totals.replayMaps, maps: totals.maps } });
    }
  }
  rows.sort((x, y) => y.value - x.value);
  return { rows: rows.slice(0, limit), hidden };
}

/** Percentile (0–100) of a value among the division's consenting players with enough rounds. */
export function percentile(division: string, key: MetricDef['key'], value: number | null): number | null {
  if (value === null) return null;
  const all = leaders(division, key, 999).rows.map((r) => r.value);
  if (all.length < 3) return null;
  const below = all.filter((v) => v < value).length;
  return Math.round((below / (all.length - 1)) * 100);
}

export interface GameLogRow {
  match: Match;
  opponent: Team;
  map: MapName;
  won: boolean;
  score: [number, number];
  totals: Totals;
  source: Match['stats'];
}

export function gameLog(playerSlug: string): GameLogRow[] {
  const t = teamOf(playerSlug);
  if (!t) return [];
  const rows: GameLogRow[] = [];
  for (const m of matches) {
    if (!counted(m) || !m.game || (m.a.slug !== t.slug && m.b.slug !== t.slug)) continue;
    const s = sideOf(m, t.slug);
    const score = m.score as [number, number];
    const mine: [number, number] = s === 'a' ? score : [score[1], score[0]];
    const totals = m.stats === 'none' ? emptyTotals() : addRounds(emptyTotals(), m.game.rounds, playerSlug, isReplay(m));
    if (m.stats !== 'none' && totals.rounds === 0) continue;
    rows.push({ match: m, opponent: s === 'a' ? m.b : m.a, map: m.game.map, won: mine[0] > mine[1], score: mine, totals, source: m.stats });
  }
  return rows.sort((x, y) => (y.match.scheduledAt ?? 0) - (x.match.scheduledAt ?? 0));
}

/** Splits by map (all maps with stats), by side and by operator (replay maps only). */
export function splits(playerSlug: string) {
  const byMap = new Map<string, Totals>();
  const bySide = { atk: emptyTotals(), def: emptyTotals() };
  const byOp = new Map<string, { rounds: number; kills: number; deaths: number; won: number; side: 'atk' | 'def' }>();
  for (const m of matches) {
    if (!hasStats(m) || !m.game) continue;
    const present = m.game.rounds.some((r) => r.players.some((p) => p.player === playerSlug));
    if (!present) continue;
    const map = m.game.map;
    byMap.set(map, addRounds(byMap.get(map) ?? emptyTotals(), m.game.rounds, playerSlug, isReplay(m)));
    if (!isReplay(m)) continue;
    for (const side of ['atk', 'def'] as const) {
      const rs = m.game.rounds.filter((r) => r.kind === 'replay' && r.players.some((p) => p.player === playerSlug && p.side === side));
      if (rs.length) addRounds(bySide[side], rs, playerSlug, true);
    }
    for (const r of m.game.rounds) {
      if (r.kind !== 'replay') continue;
      const p = r.players.find((x) => x.player === playerSlug);
      if (!p) continue;
      const o = byOp.get(p.operator) ?? { rounds: 0, kills: 0, deaths: 0, won: 0, side: p.side };
      o.rounds++;
      o.kills += p.kills;
      o.deaths += p.died ? 1 : 0;
      o.won += r.winner === p.team ? 1 : 0;
      byOp.set(p.operator, o);
    }
  }
  return {
    maps: [...byMap.entries()].map(([map, t]) => ({ map, totals: t })).sort((x, y) => y.totals.rounds - x.totals.rounds),
    sides: bySide,
    operators: [...byOp.entries()].map(([op, v]) => ({ operator: op, ...v })).sort((x, y) => y.rounds - x.rounds),
  };
}

export interface TeamSeason {
  record: { played: number; wins: number; losses: number };
  maps: { map: MapName; played: number; wins: number; roundsWon: number; roundsLost: number }[];
  attack: { won: number; rounds: number };
  defence: { won: number; rounds: number };
  replayCoverage: { replay: number; maps: number };
  topPlayers: { player: string; totals: Totals }[];
}

export function teamSeason(teamSlug: string): TeamSeason {
  const out: TeamSeason = {
    record: { played: 0, wins: 0, losses: 0 },
    maps: [],
    attack: { won: 0, rounds: 0 },
    defence: { won: 0, rounds: 0 },
    replayCoverage: { replay: 0, maps: 0 },
    topPlayers: [],
  };
  const maps = new Map<MapName, TeamSeason['maps'][number]>();
  for (const m of matches) {
    if (!counted(m) || !m.game || (m.a.slug !== teamSlug && m.b.slug !== teamSlug)) continue;
    const s = sideOf(m, teamSlug);
    const score = m.score as [number, number];
    const won = (s === 'a' ? score[0] > score[1] : score[1] > score[0]);
    out.record.played++;
    out.record[won ? 'wins' : 'losses']++;
    const row = maps.get(m.game.map) ?? { map: m.game.map, played: 0, wins: 0, roundsWon: 0, roundsLost: 0 };
    row.played++;
    row.wins += won ? 1 : 0;
    row.roundsWon += s === 'a' ? score[0] : score[1];
    row.roundsLost += s === 'a' ? score[1] : score[0];
    maps.set(m.game.map, row);
    out.replayCoverage.maps++;
    if (!isReplay(m)) continue;
    out.replayCoverage.replay++;
    for (const r of m.game.rounds) {
      if (r.kind !== 'replay') continue;
      const bucket = r.attacker === s ? out.attack : out.defence;
      bucket.rounds++;
      bucket.won += r.winner === s ? 1 : 0;
    }
  }
  out.maps = [...maps.values()].sort((x, y) => y.played - x.played);
  out.topPlayers = (rosters.get(teamSlug) ?? [])
    .filter((e) => player(e.player).consent)
    .map((e) => ({ player: e.player, totals: totalsFor(e.player) }))
    .filter((x) => x.totals.rounds > 0)
    .sort((x, y) => derived(y.totals).kd - derived(x.totals).kd);
  return out;
}

/** Scouting, from official validated matches only (design doc section 17). */
export function tendencies(teamSlug: string) {
  const vetoes: { match: Match; opponent: Team; bans: MapName[]; played: MapName; won: boolean | null }[] = [];
  const perMap = new Map<MapName, { played: number; wins: number; atkW: number; atkR: number; defW: number; defR: number }>();
  const sites = new Map<string, { picked: number; won: number; map: MapName }>();
  const ops = new Map<string, { map: MapName; side: 'atk' | 'def'; picks: number }>();
  let replayMaps = 0;
  let maps = 0;
  for (const m of matches) {
    if (!counted(m) || !m.game || (m.a.slug !== teamSlug && m.b.slug !== teamSlug)) continue;
    const s = sideOf(m, teamSlug);
    const score = m.score as [number, number];
    const won = s === 'a' ? score[0] > score[1] : score[1] > score[0];
    vetoes.push({
      match: m,
      opponent: s === 'a' ? m.b : m.a,
      bans: m.veto.filter((v) => v.action === 'ban' && v.team === s).map((v) => v.map as MapName),
      played: m.game.map,
      won,
    });
    maps++;
    const pm = perMap.get(m.game.map) ?? { played: 0, wins: 0, atkW: 0, atkR: 0, defW: 0, defR: 0 };
    pm.played++;
    pm.wins += won ? 1 : 0;
    if (isReplay(m)) {
      replayMaps++;
      for (const r of m.game.rounds) {
        if (r.kind !== 'replay') continue;
        if (r.attacker === s) {
          pm.atkR++;
          pm.atkW += r.winner === s ? 1 : 0;
        } else {
          pm.defR++;
          pm.defW += r.winner === s ? 1 : 0;
          const key = `${m.game.map}|${r.site}`;
          const st = sites.get(key) ?? { picked: 0, won: 0, map: m.game.map };
          st.picked++;
          st.won += r.winner === s ? 1 : 0;
          sites.set(key, st);
        }
        for (const p of r.players.filter((x) => x.team === s)) {
          const k = `${m.game.map}|${p.side}|${p.operator}`;
          const o = ops.get(k) ?? { map: m.game.map, side: p.side, picks: 0 };
          o.picks++;
          ops.set(k, o);
        }
      }
    }
    perMap.set(m.game.map, pm);
  }
  const banCounts = new Map<MapName, number>();
  for (const v of vetoes) for (const b of v.bans) banCounts.set(b, (banCounts.get(b) ?? 0) + 1);
  const firstBans = new Map<MapName, number>();
  for (const v of vetoes) if (v.bans[0]) firstBans.set(v.bans[0], (firstBans.get(v.bans[0]) ?? 0) + 1);
  return {
    vetoes,
    banCounts: [...banCounts.entries()].sort((x, y) => y[1] - x[1]),
    firstBans: [...firstBans.entries()].sort((x, y) => y[1] - x[1]),
    neverBanned: MAP_POOL.filter((m) => !banCounts.has(m)),
    perMap: [...perMap.entries()].map(([map, v]) => ({ map, ...v })).sort((x, y) => y.played - x.played),
    sites: [...sites.entries()].map(([k, v]) => ({ site: k.split('|')[1] as string, ...v })).sort((x, y) => y.picked - x.picked),
    operators: [...ops.entries()].map(([k, v]) => ({ operator: k.split('|')[2] as string, ...v })).sort((x, y) => y.picks - x.picks),
    coverage: { replay: replayMaps, maps },
  };
}

// ---------------------------------------------------------------------------------------------
// Team report (private workspace): official and practice rounds, next to the division average.

export interface PracticeGame {
  id: number;
  date: number;
  kind: 'scrim' | 'friendly' | 'cross_league';
  opponent: string;
  opponentTeam: string | null;
  map: MapName;
  score: [number, number];
  rounds: Round[];
  source: 'replay' | 'manual';
}

const DAY = 86_400_000;

/** Greed Esport's practice book: scrims against platform teams and unnamed sides. */
export function practiceGames(teamSlug: string): PracticeGame[] {
  const r = rng(hash(teamSlug + 'practice'));
  const opponents: [string, string | null][] = [
    ['RPV Esport', 'rpv-esport'], ['Civitas Esport', 'civitas-esport'], ['Lunaria Esport', 'lunaria-esport'],
    ['Panaria Lair', 'panaria-lair'], ['Team Brume (BE)', null], ['Kōri R6', null], ['Mixt N’ chill', 'mixt-n-chill'],
  ];
  const games: PracticeGame[] = [];
  const base = Date.UTC(2026, 9, 12, 19);
  for (let i = 0; i < 18; i++) {
    const [name, slug] = pick(r, opponents);
    const oppLineup = slug ? starters(slug) : starters(pick(r, ['askium-esport', 'shade', 'click-gaming']));
    const map = pick(r, ['Clubhouse', 'Clubhouse', 'Bank', 'Kafe Dostoyevsky', 'Lair', 'Border', 'Chalet'] as MapName[]);
    const win = r() < 0.6;
    const loser = Math.floor(r() * 6);
    const score: [number, number] = win ? [7, loser] : [loser, 7];
    const sim = simulate({
      key: `${teamSlug}-practice-${i}`, map, scoreA: score[0], scoreB: score[1],
      lineupA: starters(teamSlug), lineupB: oppLineup,
      startAttacker: r() > 0.5 ? 'a' : 'b', otAttacker: 'a', biasA: hash(teamSlug) % 4, biasB: i % 4,
    });
    games.push({
      id: 9000 + i, date: base + Math.floor(i * 2.4) * DAY, kind: i % 7 === 3 ? 'friendly' : i % 9 === 5 ? 'cross_league' : 'scrim',
      opponent: name, opponentTeam: slug, map, score, rounds: sim.rounds, source: i % 6 === 5 ? 'manual' : 'replay',
    });
  }
  return games;
}

interface RoundView {
  r: Round;
  side: 'a' | 'b';
  map: MapName;
  official: boolean;
}

function teamRoundsView(teamSlug: string, scope: 'official' | 'practice' | 'both'): RoundView[] {
  const out: RoundView[] = [];
  if (scope !== 'practice') {
    for (const m of matches) {
      if (!counted(m) || !m.game || !isReplay(m) || (m.a.slug !== teamSlug && m.b.slug !== teamSlug)) continue;
      const s = sideOf(m, teamSlug);
      for (const r of m.game.rounds) if (r.kind === 'replay') out.push({ r, side: s, map: m.game.map, official: true });
    }
  }
  if (scope !== 'official') {
    for (const g of practiceGames(teamSlug)) {
      if (g.source !== 'replay') continue;
      for (const r of g.rounds) if (r.kind === 'replay') out.push({ r, side: 'a', map: g.map, official: false });
    }
  }
  return out;
}

const frac = (won: number, n: number) => ({ won, n });

function reportFrom(views: RoundView[]) {
  const maps = new Map<MapName, { rounds: number; won: number; atk: { won: number; n: number }; def: { won: number; n: number } }>();
  const defSites = new Map<string, { n: number; won: number; map: MapName }>();
  const atkSites = new Map<string, { n: number; won: number; map: MapName }>();
  const opening = { rounds: 0, ok: 0, okWon: 0, od: 0, odWon: 0 };
  const trades = { deaths: 0, traded: 0, tradeKills: 0 };
  const plants = { atkRounds: 0, planted: 0, wonAfterPlant: 0, defFacedPlant: 0, defWonAfterPlant: 0 };
  const endings = { won: { elimination: 0, defuser: 0, time: 0, disable: 0 }, lost: { elimination: 0, defuser: 0, time: 0, disable: 0 } };
  const operators = new Map<string, { side: 'atk' | 'def'; picks: number; won: number }>();
  const clutch = { attempts: 0, wins: 0 };
  for (const { r, side, map } of views) {
    const atk = r.attacker === side;
    const won = r.winner === side;
    const mm = maps.get(map) ?? { rounds: 0, won: 0, atk: frac(0, 0), def: frac(0, 0) };
    mm.rounds++;
    mm.won += won ? 1 : 0;
    const b = atk ? mm.atk : mm.def;
    b.n++;
    b.won += won ? 1 : 0;
    maps.set(map, mm);
    const sitesMap = atk ? atkSites : defSites;
    const sk = `${map}|${r.site}`;
    const st = sitesMap.get(sk) ?? { n: 0, won: 0, map };
    st.n++;
    st.won += won ? 1 : 0;
    sitesMap.set(sk, st);
    const mine = r.players.filter((p) => p.team === side);
    opening.rounds++;
    if (mine.some((p) => p.openingKill)) {
      opening.ok++;
      opening.okWon += won ? 1 : 0;
    } else if (mine.some((p) => p.openingDeath)) {
      opening.od++;
      opening.odWon += won ? 1 : 0;
    }
    for (const p of mine) {
      trades.deaths += p.died ? 1 : 0;
      trades.traded += p.traded ? 1 : 0;
      trades.tradeKills += p.tradeKill ? 1 : 0;
      if (p.clutchVs > 0) {
        clutch.attempts++;
        clutch.wins += p.clutchWon ? 1 : 0;
      }
      const o = operators.get(p.operator) ?? { side: p.side, picks: 0, won: 0 };
      o.picks++;
      o.won += won ? 1 : 0;
      operators.set(p.operator, o);
    }
    const planted = r.players.some((p) => p.plant);
    if (atk) {
      plants.atkRounds++;
      if (planted) {
        plants.planted++;
        plants.wonAfterPlant += won ? 1 : 0;
      }
    } else if (planted) {
      plants.defFacedPlant++;
      plants.defWonAfterPlant += won ? 1 : 0;
    }
    if (r.condition) endings[won ? 'won' : 'lost'][r.condition]++;
  }
  return {
    rounds: views.length,
    maps: [...maps.entries()].map(([map, v]) => ({ map, ...v })).sort((x, y) => y.rounds - x.rounds),
    defSites: [...defSites.entries()].map(([k, v]) => ({ site: k.split('|')[1] as string, ...v })),
    atkSites: [...atkSites.entries()].map(([k, v]) => ({ site: k.split('|')[1] as string, ...v })),
    opening,
    trades,
    plants,
    endings,
    clutch,
    operators: [...operators.entries()].map(([op, v]) => ({ operator: op, ...v })).sort((x, y) => y.picks - x.picks),
  };
}

export type Report = ReturnType<typeof reportFrom>;

/** The team report and the division's average (official matches only), for the workspace page. */
export function teamReport(teamSlug: string, scope: 'official' | 'practice' | 'both' = 'both') {
  const t = team(teamSlug);
  const own = reportFrom(teamRoundsView(teamSlug, scope));
  // Division average: every team's official replay rounds, pooled.
  const divViews = teams
    .filter((x) => x.competition === 'lfr' && x.division === t.division)
    .flatMap((x) => teamRoundsView(x.slug, 'official'));
  const division = reportFrom(divViews);
  const practice = practiceGames(teamSlug);
  const officialMaps = matches.filter((m) => counted(m) && isReplay(m) && (m.a.slug === teamSlug || m.b.slug === teamSlug)).length;
  const games: Round[][] = [];
  if (scope !== 'practice') {
    for (const m of matches) if (counted(m) && m.game && isReplay(m) && (m.a.slug === teamSlug || m.b.slug === teamSlug)) games.push(m.game.rounds);
  }
  if (scope !== 'official') for (const g of practice) if (g.source === 'replay') games.push(g.rounds);
  // Teammates see each other's figures inside the workspace, consent or not (section 17).
  const playersRows = (rosters.get(teamSlug) ?? []).map((e) => {
    const tt = emptyTotals();
    for (const rounds of games) addRounds(tt, rounds, e.player, true);
    return { player: e.player, totals: tt };
  });
  return { own, division, practice, officialMaps, players: playersRows, minRounds: 10 };
}

export { SITES, MAP_POOL };
export const allPlayers = players;
