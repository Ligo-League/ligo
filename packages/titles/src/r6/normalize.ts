import * as z from 'zod';
import {
  PARSED_UNIT_SCHEMA,
  type ParsedUnitBase,
  type ParsedUnitPlayer,
  type UnitWarning,
} from '../parsed-unit.ts';
import { dissectRoundSchema, type DissectRound } from './dissect.ts';

// The R6 normaliser (design doc sections 9 and 10): one round of the r6-dissect fork's JSON
// becomes a ParsedUnit with each player's metrics and the round's events.
//
// - Order is the feed's order. Time is the fork's `elapsedSeconds` (seconds since the action
//   phase began, increasing across the plant), never the countdown clock, which restarts.
// - Kills and headshots come from the feed, assists from the scoreboard; the fork reconciles both
//   (all 411 test rounds agree), and a difference is a warning.
// - A team kill is the victim's death and no kill for its author, as on the in-game scoreboard;
//   it opens no round for the author, and trades nothing.
// - Plants and defuses stay out until the parser finds them all (M-50): a round is planted only
//   by its win condition, and KOST counts kills, survivals and trades for now.

/** The metrics a round gives each player: the R6 schema's, but plants and defuses (M-50). */
export const R6_UNIT_METRICS = [
  'rounds_played',
  'kills',
  'deaths',
  'assists',
  'headshots',
  'rounds_kost',
  'rounds_survived',
  'opening_kills',
  'opening_deaths',
  'trade_kills',
  'traded_deaths',
  'clutch_attempts',
  'clutch_wins',
] as const;
export type R6UnitMetric = (typeof R6_UNIT_METRICS)[number];

export interface R6UnitSide {
  idx: 0 | 1;
  role: 'Attack' | 'Defense';
  won: boolean;
  /** `KilledOpponents`, `Time`, `DisabledDefuser`, `DefusedBomb`…; null when unstated. */
  win_condition: string | null;
  /** The side's map score before this round, as the lobby counted it. */
  score_before: number;
}

export interface R6UnitPlayer extends ParsedUnitPlayer<R6UnitMetric> {
  /** The operator the player ended the preparation phase on. */
  operator: string | null;
  detail: {
    /** Left the round (a disconnect) rather than died; only builds before Y9S1 record it. */
    left: boolean;
    /** The opponents alive when this player became the side's last; 0 without a clutch. */
    clutch_vs: number;
  };
}

/**
 * The round's events in feed order. Players are their index in `players`, or null for a name
 * the round does not list. `elapsed_s` is null when the round's clock never started.
 */
export type R6Event =
  | {
      seq: number;
      type: 'kill';
      elapsed_s: number | null;
      actor: number | null;
      target: number | null;
      headshot: boolean;
      team_kill: boolean;
      /** The kill avenged a teammate of its author (section 9, "Traded"). */
      trade: boolean;
    }
  | { seq: number; type: 'death' | 'leave'; elapsed_s: number | null; target: number | null }
  | { seq: number; type: 'swap'; elapsed_s: number | null; actor: number | null; operator: string };

export interface R6Unit extends ParsedUnitBase<'r6', R6UnitMetric> {
  game_version: string;
  /** `CustomGameOnline` for a league match; anything else is accepted with a warning later. */
  match_type: string;
  /** The defended site. */
  site: string | null;
  /** The defuser was planted, as far as the win condition shows (M-50). */
  planted: boolean;
  /** The profileID of the player whose game recorded the file. */
  recorded_by: string | null;
  sides: [R6UnitSide, R6UnitSide];
  players: R6UnitPlayer[];
  events: R6Event[];
  params: { trade_window_s: number };
}

export interface R6NormalizeContext {
  /** The parser build that produced the JSON. */
  parser: string;
  fileSha256: string;
  /** W of section 9: seconds within which a teammate's kill trades a death (10 by default). */
  tradeWindowS: number;
}

export type R6NormalizeResult =
  | { ok: true; unit: R6Unit }
  | { ok: false; error: 'invalid' | 'duplicate_player'; message: string };

/** Win conditions that need the defuser planted: attackers' defuser went off, or was disabled. */
const PLANTED_BY = new Set(['DefusedBomb', 'DisabledDefuser']);
/** LAN builds write every profileID as zeros. */
const ZERO_ID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/;
const account = (id: string | undefined) => (id === undefined || ZERO_ID.test(id) ? null : id);

export function normalizeR6(raw: unknown, ctx: R6NormalizeContext): R6NormalizeResult {
  const parsed = dissectRoundSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'invalid', message: z.prettifyError(parsed.error) };
  }
  const round = parsed.data;
  const index = new Map<string, number>();
  for (const [i, p] of round.players.entries()) {
    if (index.has(p.username)) {
      return { ok: false, error: 'duplicate_player', message: `Two players named ${p.username}` };
    }
    index.set(p.username, i);
  }

  const sides = round.teams.map((team, idx) => ({
    idx: idx === 0 ? 0 : 1,
    role: team.role,
    won: team.won,
    win_condition: team.won ? (team.winCondition ?? null) : null,
    score_before: team.startingScore,
  })) as [R6UnitSide, R6UnitSide];
  const winCondition = sides.find((side) => side.won)?.win_condition ?? null;
  const { players, events, warnings } = roundFacts(round, index, sides, ctx.tradeWindowS);

  return {
    ok: true,
    unit: {
      schema: PARSED_UNIT_SCHEMA,
      title: 'r6',
      parser: ctx.parser,
      file_sha256: ctx.fileSha256,
      lobby_id: round.matchID,
      unit: { kind: 'round', number: round.roundNumber },
      started_at: round.timestamp,
      game_version: round.gameVersion,
      match_type: round.matchType.name,
      map: round.map.name,
      site: round.site ?? null,
      mode: round.gamemode.name,
      complete: sides.some((side) => side.won),
      planted: winCondition !== null && PLANTED_BY.has(winCondition),
      recorded_by: account(round.recordingProfileID),
      sides,
      players,
      events,
      params: { trade_window_s: ctx.tradeWindowS },
      warnings,
    },
  };
}

const zeroStats = (): Record<R6UnitMetric, number> =>
  Object.fromEntries(R6_UNIT_METRICS.map((key) => [key, 0])) as Record<R6UnitMetric, number>;

/** How a player left the round: their killer (null for none, or a teammate) and when. */
interface Exit {
  killer: number | null;
  at: number | null;
}

/** Walks the feed once, in order: deaths, the opening, trades and clutches as they happen. */
function roundFacts(
  round: DissectRound,
  index: Map<string, number>,
  sides: [R6UnitSide, R6UnitSide],
  tradeWindowS: number,
): { players: R6UnitPlayer[]; events: R6Event[]; warnings: UnitWarning[] } {
  const roster = round.players;
  const stats = roster.map(zeroStats);
  const exits: (Exit | null)[] = roster.map(() => null);
  const left = roster.map(() => false);
  const traded = roster.map(() => false);
  const clutchVs = roster.map(() => 0);
  const clutcher: [number | null, number | null] = [null, null];
  const events: R6Event[] = [];
  const warnings: UnitWarning[] = [];
  const unknown = new Set<string>();
  let opened = false;

  const lookup = (name: string | undefined): number | null => {
    if (name === undefined) return null;
    const found = index.get(name);
    if (found !== undefined) return found;
    if (!unknown.has(name)) {
      unknown.add(name);
      warnings.push({ code: 'unknown_player', name });
    }
    return null;
  };
  const sideOf = (i: number) => roster[i]?.teamIndex ?? 0;
  const inRound = (side: 0 | 1) =>
    roster.flatMap((p, i) => (p.teamIndex === side && exits[i] === null ? [i] : []));

  /** Takes a player out; a death opens the round if nothing did before. */
  const takeOut = (target: number | null, exit: Exit, death: boolean) => {
    if (target === null) return;
    const out = stats[target];
    if (!out || exits[target] !== null) {
      warnings.push({ code: 'out_twice', name: roster[target]?.username ?? '' });
      return;
    }
    exits[target] = exit;
    if (death) {
      out.deaths = 1;
      if (!opened) {
        opened = true;
        out.opening_deaths = 1;
        const killer = exit.killer === null ? undefined : stats[exit.killer];
        if (killer) killer.opening_kills = 1;
      }
    } else left[target] = true;
    // The moment a side drops to one player while the opponents still have some.
    const side = sideOf(target);
    const mine = inRound(side);
    const theirs = inRound(side === 0 ? 1 : 0).length;
    const last = mine[0];
    if (mine.length === 1 && last !== undefined && theirs > 0 && clutcher[side] === null) {
      clutcher[side] = last;
      clutchVs[last] = theirs;
    }
  };

  /** The deaths `target` caused that `killer`, their teammate, avenges in the window. */
  const settleTrades = (killer: number, target: number, at: number | null): boolean => {
    let trade = false;
    for (const [victim, exit] of exits.entries()) {
      if (
        exit?.killer === target &&
        sideOf(victim) === sideOf(killer) &&
        !traded[victim] &&
        exit.at !== null &&
        at !== null &&
        at - exit.at <= tradeWindowS
      ) {
        traded[victim] = true;
        trade = true;
      }
    }
    return trade;
  };

  for (const e of round.matchFeedback ?? []) {
    const seq = events.length;
    const elapsed = e.phase === undefined ? null : e.elapsedSeconds;
    switch (e.type.name) {
      case 'Kill': {
        const actor = lookup(e.username);
        const target = lookup(e.target);
        const teamKill =
          e.teamKill === true ||
          (actor !== null && target !== null && sideOf(actor) === sideOf(target));
        const credited = teamKill ? null : actor;
        const own = credited === null ? undefined : stats[credited];
        let trade = false;
        if (credited !== null && own) {
          own.kills += 1;
          if (e.headshot === true) own.headshots += 1;
          if (target !== null) trade = settleTrades(credited, target, elapsed);
          if (trade) own.trade_kills += 1;
        }
        events.push({
          seq,
          type: 'kill',
          elapsed_s: elapsed,
          actor,
          target,
          headshot: e.headshot === true,
          team_kill: teamKill,
          trade,
        });
        takeOut(target, { killer: credited, at: elapsed }, true);
        break;
      }
      case 'Death':
      case 'PlayerLeave': {
        const target = lookup(e.username);
        const death = e.type.name === 'Death';
        events.push({ seq, type: death ? 'death' : 'leave', elapsed_s: elapsed, target });
        takeOut(target, { killer: null, at: elapsed }, death);
        break;
      }
      case 'OperatorSwap': {
        const actor = lookup(e.username);
        if (e.operator) {
          events.push({ seq, type: 'swap', elapsed_s: elapsed, actor, operator: e.operator.name });
        }
        break;
      }
      // Downs, revives and the defuser's events stay out (M-50 for the defuser).
      default:
        break;
    }
  }

  const scoreboard = new Map((round.stats ?? []).map((row) => [row.username, row]));
  const players = roster.map((p, i): R6UnitPlayer => {
    const s = stats[i] ?? zeroStats();
    const survived = exits[i] === null;
    const side = p.teamIndex;
    s.rounds_played = 1;
    s.rounds_survived = Number(survived);
    s.traded_deaths = Number(traded[i]);
    s.rounds_kost = Number(s.kills > 0 || survived || traded[i]);
    if (clutcher[side] === i) {
      s.clutch_attempts = 1;
      s.clutch_wins = Number(sides[side].won);
    }
    const row = scoreboard.get(p.username);
    if (!row) warnings.push({ code: 'no_scoreboard', name: p.username });
    else {
      s.assists = row.assists;
      if (row.kills !== s.kills) warnings.push({ code: 'scoreboard_kills', name: p.username });
      if (row.died !== (s.deaths === 1)) {
        warnings.push({ code: 'scoreboard_deaths', name: p.username });
      }
    }
    return {
      account: account(p.profileID),
      name: p.username,
      side,
      operator: p.operator?.name ?? null,
      stats: s,
      detail: { left: left[i] ?? false, clutch_vs: clutchVs[i] ?? 0 },
    };
  });
  return { players, events, warnings };
}
