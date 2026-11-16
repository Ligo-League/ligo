// A round-by-round simulator for R6 maps. It turns a known final score into rounds (winner, side,
// win condition, site, lobby) and per-player facts, so every page built on them agrees: the
// scoreboard sums to the score, leaders sum the scoreboards, the team report sums the rounds.

import { hash, pick, rng, shuffle } from './rng.ts';
import { player, type Role } from './players.ts';

export const MAP_POOL = [
  'Bank', 'Border', 'Chalet', 'Clubhouse', 'Consulate', 'Kafe Dostoyevsky', 'Lair', 'Nighthaven Labs', 'Skyscraper',
] as const;
export type MapName = (typeof MAP_POOL)[number];

/** Defence sites per map, as players name them (game vocabulary stays in English). */
export const SITES: Record<MapName, string[]> = {
  Bank: ['CEO / Executive', 'Open Area / Staff', 'Tellers / Archives', 'Lockers / CCTV'],
  Border: ['Armory / Archives', 'Ventilation / Workshop', 'Customs / Supply', 'Tellers / Bathroom'],
  Chalet: ['Master / Office', 'Bar / Gaming', 'Kitchen / Trophy', 'Wine / Snowmobile'],
  Clubhouse: ['Gym / Bedroom', 'CCTV / Cash', 'Bar / Stock', 'Church / Arsenal'],
  Consulate: ['Consul / Meeting', 'Lobby / Press', 'Archives / Tellers', 'Garage / Cafeteria'],
  'Kafe Dostoyevsky': ['Bar / Cocktail', 'Fireplace / Mining', 'Reading / Kitchen', 'Bakery / Service'],
  Lair: ['Lab / Armory', 'Bunks / Office', 'R6 Room / Workshop', 'Gym / Generator'],
  'Nighthaven Labs': ['Command / Server', 'Kitchen / Cafeteria', 'Storage / Tank', 'Control / Lab'],
  Skyscraper: ['Tea / Karaoke', 'Exhibition / Office', 'BBQ / Kitchen', 'Bedroom / Bathroom'],
};

const ATTACK_OPS: Record<Role, string[]> = {
  IGL: ['Thatcher', 'Dokkaebi', 'Iana'],
  Entry: ['Ash', 'Iana', 'Zofia'],
  Support: ['Thermite', 'Hibana', 'Thatcher'],
  Flex: ['Ace', 'Nøkk', 'Grim'],
  Ancre: ['Twitch', 'Brava', 'Flores'],
};
const DEFENCE_OPS: Record<Role, string[]> = {
  IGL: ['Valkyrie', 'Mira', 'Thunderbird'],
  Entry: ['Jäger', 'Azami', 'Smoke'],
  Support: ['Mute', 'Kaid', 'Bandit'],
  Flex: ['Solis', 'Fenrir', 'Thorn'],
  Ancre: ['Melusi', 'Echo', 'Maestro'],
};

export type Side = 'atk' | 'def';
export type WinCondition = 'elimination' | 'defuser' | 'time' | 'disable';

export interface PlayerRound {
  player: string;
  team: 'a' | 'b';
  side: Side;
  operator: string;
  kills: number;
  died: boolean;
  assists: number;
  headshots: number;
  openingKill: boolean;
  openingDeath: boolean;
  traded: boolean;
  tradeKill: boolean;
  plant: boolean;
  defuse: boolean;
  clutchVs: number;
  clutchWon: boolean;
  /** The operator picked before an operator swap during the round, if any. */
  swappedFrom?: string;
}

/** One kill-feed line, in feed order (never sorted by the game clock). */
export interface FeedEvent {
  seq: number;
  /** Seconds since the round started (derived, as the normaliser does). */
  elapsed: number;
  kind: 'kill' | 'death';
  killer: string | null;
  victim: string;
  headshot: boolean;
}

export interface Round {
  n: number | null;
  /** Lobby number (1-based); a re-hosted map has several. */
  lobby: number;
  /** Round number inside its lobby. */
  local: number;
  kind: 'replay' | 'void';
  voidReason?: 'interrupted' | 'after_end';
  winner: 'a' | 'b' | null;
  attacker: 'a' | 'b';
  condition: WinCondition | null;
  site: string;
  overtime: boolean;
  /** Alive at the end, per side. */
  aliveA: number;
  aliveB: number;
  players: PlayerRound[];
  /** Feed-order seconds of the first kill, for the timeline. */
  firstKillAt: number;
  events: FeedEvent[];
  /** Seconds since round start when the defuser was planted. */
  plantAt: number | null;
  /** Round MVP: the weighted stand-in of M-37 (kills, opening kill, clutch, objective, trades). */
  mvp: string | null;
}

export interface GameSim {
  map: MapName;
  scoreA: number;
  scoreB: number;
  overtime: boolean;
  lobbies: number;
  startAttacker: 'a' | 'b';
  otAttacker: 'a' | 'b';
  rounds: Round[];
}

export interface SimInput {
  key: string;
  map: MapName;
  scoreA: number;
  scoreB: number;
  lineupA: string[];
  lineupB: string[];
  /** Which team attacks first. */
  startAttacker: 'a' | 'b';
  otAttacker: 'a' | 'b';
  /** Round count of the first lobby when the map was re-hosted. */
  rehostAfter?: number;
  /** Defence site preferences per team, so tendencies show. */
  biasA?: number;
  biasB?: number;
}

function winnerSequence(r: () => number, sa: number, sb: number): ('a' | 'b')[] {
  const w: 'a' | 'b' = sa > sb ? 'a' : 'b';
  const l: 'a' | 'b' = w === 'a' ? 'b' : 'a';
  const ws = Math.max(sa, sb);
  const ls = Math.min(sa, sb);
  if (ws <= 7) {
    const head = shuffle(r, [...Array(ws - 1).fill(w), ...Array(ls).fill(l)] as ('a' | 'b')[]);
    return [...head, w];
  }
  // Overtime: 6–6 after 12 rounds, then 8–6 (two straight) or 8–7.
  const reg = shuffle(r, [...Array(6).fill(w), ...Array(6).fill(l)] as ('a' | 'b')[]);
  if (ls === 6) return [...reg, w, w];
  return [...reg, ...(r() > 0.5 ? [w, l, w] : [l, w, w])] as ('a' | 'b')[];
}

function weighted<T>(r: () => number, items: T[], weight: (t: T) => number): T {
  const total = items.reduce((s, t) => s + weight(t), 0);
  let x = r() * total;
  for (const t of items) {
    x -= weight(t);
    if (x <= 0) return t;
  }
  return items[items.length - 1] as T;
}

export function simulate(input: SimInput): GameSim {
  const r = rng(hash(input.key));
  const seq = winnerSequence(r, input.scoreA, input.scoreB);
  const overtime = Math.max(input.scoreA, input.scoreB) > 7;
  const sites = SITES[input.map];
  const opsFor = (p: string, side: Side) => {
    const role = player(p).role ?? 'Flex';
    const list = (side === 'atk' ? ATTACK_OPS : DEFENCE_OPS)[role];
    const rr = rng(hash(p + input.map + side));
    return { main: pick(rr, list), alt: pick(rr, list) };
  };
  const rounds: Round[] = [];
  let lobby = 1;
  let local = 0;
  const pushRound = (n: number | null, winner: 'a' | 'b' | null, kind: Round['kind'], voidReason?: Round['voidReason']) => {
    local++;
    const idx = (n ?? rounds.length + 1) - 1;
    let attacker: 'a' | 'b';
    if (idx < 6) attacker = input.startAttacker;
    else if (idx < 12) attacker = input.startAttacker === 'a' ? 'b' : 'a';
    else attacker = (idx - 12) % 2 === 0 ? input.otAttacker : input.otAttacker === 'a' ? 'b' : 'a';
    const defender: 'a' | 'b' = attacker === 'a' ? 'b' : 'a';
    const bias = defender === 'a' ? (input.biasA ?? 0) : (input.biasB ?? 0);
    const site = weighted(r, sites, (s) => (sites.indexOf(s) === bias % sites.length ? 3 : 1));
    const lineup = { a: input.lineupA, b: input.lineupB };
    // A second stream for what the A/B/C mockups did not use, so their numbers stay the same.
    const ev = rng(hash(`${input.key}-events-${rounds.length}`));
    const events: FeedEvent[] = [];
    let clock = 8 + Math.floor(ev() * 25);
    const prs: PlayerRound[] = (['a', 'b'] as const).flatMap((team) =>
      lineup[team].map((p) => {
        const side: Side = team === attacker ? 'atk' : 'def';
        const ops = opsFor(p, side);
        return {
          player: p, team, side, operator: r() < 0.78 ? ops.main : ops.alt,
          kills: 0, died: false, assists: 0, headshots: 0, openingKill: false, openingDeath: false,
          traded: false, tradeKill: false, plant: false, defuse: false, clutchVs: 0, clutchWon: false,
        };
      }),
    );
    let condition: WinCondition | null = null;
    let aliveA = 5;
    let aliveB = 5;
    if (winner) {
      const attackersWin = winner === attacker;
      const x = r();
      condition = attackersWin ? (x < 0.68 ? 'elimination' : 'defuser') : x < 0.55 ? 'elimination' : x < 0.85 ? 'time' : 'disable';
      const loser: 'a' | 'b' = winner === 'a' ? 'b' : 'a';
      const loserDeaths = condition === 'elimination' ? 5 : 2 + Math.floor(r() * 3);
      const winnerDeaths = Math.min(4, Math.floor(r() * 4.6));
      const deaths: ('a' | 'b')[] = shuffle(r, [...Array(loserDeaths).fill(loser), ...Array(winnerDeaths).fill(winner)]);
      // Keep the winner alive at the end: move winner deaths before the loser's last death.
      if (condition === 'elimination') {
        const last = deaths.lastIndexOf(loser);
        if (last !== deaths.length - 1) {
          deaths.splice(last, 1);
          deaths.push(loser);
        }
      }
      const alive = { a: new Set(lineup.a), b: new Set(lineup.b) };
      const killedBy = new Map<string, string>();
      deaths.forEach((victimTeam, i) => {
        const killerTeam: 'a' | 'b' = victimTeam === 'a' ? 'b' : 'a';
        const victims = [...alive[victimTeam]];
        const killers = [...alive[killerTeam]];
        if (victims.length === 0 || killers.length === 0) return;
        const victim = weighted(r, victims, (p) => 2 - player(p).skill * 0.8);
        alive[victimTeam].delete(victim);
        const vr = prs.find((x) => x.player === victim) as PlayerRound;
        vr.died = true;
        clock += 2 + Math.floor(ev() * (i === 0 ? 30 : 14));
        if (r() < 0.03) {
          if (i === 0) vr.openingDeath = true; // a fall or a suicide: a Death event with no killer
          events.push({ seq: events.length, elapsed: clock, kind: 'death', killer: null, victim, headshot: false });
          return;
        }
        const killer = weighted(r, killers, (p) => player(p).skill ** 2);
        const kr = prs.find((x) => x.player === killer) as PlayerRound;
        kr.kills++;
        const hs = r() < player(killer).hs;
        if (hs) kr.headshots++;
        events.push({ seq: events.length, elapsed: clock, kind: 'kill', killer, victim, headshot: hs });
        killedBy.set(victim, killer);
        if (i === 0) {
          kr.openingKill = true;
          vr.openingDeath = true;
        }
        if (r() < 0.42) {
          const mates = killers.filter((p) => p !== killer);
          if (mates.length) {
            const mate = pick(r, mates);
            (prs.find((x) => x.player === mate) as PlayerRound).assists++;
          }
        }
        // A trade: the victim's killer dies soon after to the victim's team.
        for (const [v, k] of killedBy) {
          if (k === victim && r() < 0.6) {
            (prs.find((x) => x.player === v) as PlayerRound).traded = true;
            kr.tradeKill = true;
          }
        }
        // Clutch: a side down to one player while the other still has some.
        if (alive[victimTeam].size === 1 && alive[killerTeam].size >= 1) {
          const last = prs.find((x) => x.player === [...alive[victimTeam]][0]) as PlayerRound;
          last.clutchVs = alive[killerTeam].size;
          last.clutchWon = victimTeam === winner;
        }
      });
      aliveA = alive.a.size;
      aliveB = alive.b.size;
      const atkAlive = [...alive[attacker]];
      const defAlive = [...alive[defender]];
      if (condition === 'defuser' || condition === 'disable' || (condition === 'elimination' && attackersWin && r() < 0.3)) {
        const planter = atkAlive.length ? pick(r, atkAlive) : pick(r, lineup[attacker]);
        (prs.find((x) => x.player === planter) as PlayerRound).plant = true;
      }
      if (condition === 'disable' && defAlive.length) {
        const defuser = pick(r, defAlive);
        (prs.find((x) => x.player === defuser) as PlayerRound).defuse = true;
      }
    }
    // Operator swaps during the preparation phase, as r6-dissect reports them.
    for (const p of prs) {
      if (ev() < 0.07) {
        const ops = opsFor(p.player, p.side);
        const before = p.operator === ops.main ? ops.alt : ops.main;
        if (before !== p.operator) p.swappedFrom = before;
      }
    }
    const planter = prs.find((p) => p.plant);
    const plantAt = planter ? Math.min(170, (events[Math.max(0, events.length - 2)]?.elapsed ?? 60) + 6) : null;
    const score = (p: PlayerRound) =>
      p.kills + (p.openingKill ? 0.5 : 0) + (p.clutchWon ? 1.5 : 0) + (p.plant || p.defuse ? 0.5 : 0) + (p.tradeKill ? 0.3 : 0) + (p.died ? 0 : 0.2);
    const winners = prs.filter((p) => p.team === winner && player(p.player).consent);
    const mvp = winners.length ? (winners.sort((x, y) => score(y) - score(x))[0] as PlayerRound).player : null;
    const firstKillAt = 18 + Math.floor(r() * 70);
    rounds.push({
      n, lobby, local, kind, ...(voidReason ? { voidReason } : {}), winner, attacker, condition, site,
      overtime: idx >= 12, aliveA, aliveB, players: prs, firstKillAt, events, plantAt, mvp,
    });
  };
  seq.forEach((winner, i) => {
    if (input.rehostAfter !== undefined && i === input.rehostAfter) {
      // The crash: an interrupted round in the first lobby, then a new lobby restarts at 1.
      pushRound(null, null, 'void', 'interrupted');
      lobby = 2;
      local = 0;
    }
    pushRound(i + 1, winner, 'replay');
  });
  return {
    map: input.map,
    scoreA: input.scoreA,
    scoreB: input.scoreB,
    overtime,
    lobbies: lobby,
    startAttacker: input.startAttacker,
    otAttacker: input.otAttacker,
    rounds,
  };
}

/** Additive totals for one player over some rounds (sum first, divide last). */
export interface Totals {
  maps: number;
  rounds: number;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  /** Replay-only metrics, over replay maps only. */
  replayMaps: number;
  replayRounds: number;
  kost: number;
  survived: number;
  openingKills: number;
  openingDeaths: number;
  tradeKills: number;
  tradedDeaths: number;
  clutchAttempts: number;
  clutchWins: number;
  plants: number;
  defuses: number;
  operators: Record<string, number>;
}

export const emptyTotals = (): Totals => ({
  maps: 0, rounds: 0, kills: 0, deaths: 0, assists: 0, headshots: 0, replayMaps: 0, replayRounds: 0, kost: 0,
  survived: 0, openingKills: 0, openingDeaths: 0, tradeKills: 0, tradedDeaths: 0, clutchAttempts: 0, clutchWins: 0,
  plants: 0, defuses: 0, operators: {},
});

export function addRounds(t: Totals, rounds: Round[], playerSlug: string, replay: boolean, withHeadshots = true): Totals {
  const counted = rounds.filter((r) => r.kind === 'replay');
  const mine = counted.flatMap((r) => r.players.filter((p) => p.player === playerSlug));
  if (mine.length === 0) return t;
  t.maps++;
  t.rounds += mine.length;
  for (const p of mine) {
    t.kills += p.kills;
    t.deaths += p.died ? 1 : 0;
    t.assists += p.assists;
    if (withHeadshots) t.headshots += p.headshots;
  }
  if (replay) {
    t.replayMaps++;
    t.replayRounds += mine.length;
    for (const p of mine) {
      const survived = !p.died;
      t.survived += survived ? 1 : 0;
      t.kost += p.kills > 0 || p.plant || p.defuse || survived || p.traded ? 1 : 0;
      t.openingKills += p.openingKill ? 1 : 0;
      t.openingDeaths += p.openingDeath ? 1 : 0;
      t.tradeKills += p.tradeKill ? 1 : 0;
      t.tradedDeaths += p.traded ? 1 : 0;
      t.clutchAttempts += p.clutchVs > 0 ? 1 : 0;
      t.clutchWins += p.clutchWon ? 1 : 0;
      t.plants += p.plant ? 1 : 0;
      t.defuses += p.defuse ? 1 : 0;
      t.operators[p.operator] = (t.operators[p.operator] ?? 0) + 1;
    }
  }
  return t;
}

/** Derived metrics, computed from totals only (design doc section 9). */
export function derived(t: Totals) {
  return {
    kd: t.deaths === 0 ? t.kills : t.kills / t.deaths,
    kpr: t.rounds ? t.kills / t.rounds : null,
    hs: t.kills ? t.headshots / t.kills : null,
    kost: t.replayRounds ? t.kost / t.replayRounds : null,
    srv: t.replayRounds ? t.survived / t.replayRounds : null,
    entry: t.replayRounds ? t.openingKills - t.openingDeaths : null,
    trade: t.replayRounds ? t.tradeKills - t.tradedDeaths : null,
    clutch: t.clutchAttempts ? t.clutchWins / t.clutchAttempts : null,
    topOperator: Object.entries(t.operators).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
  };
}
