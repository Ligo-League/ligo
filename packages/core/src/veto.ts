import type { VetoFormat } from './settings.ts';

// The map veto as a state machine (design doc section 5). The stored steps are the whole state:
// every call replays them against the format, so a stale or forged click cannot skip a turn.

/**
 * A is the team that leads the veto: the lower-ranked team, which then has side selection and
 * bans first, or the winner of the coin toss between teams of equal rank, which then makes
 * BLAST's choice (O-11, O-12). B is the other.
 */
export type VetoTeam = 'A' | 'B';
export const START_SIDES = ['attack', 'defense'] as const;
export type StartSide = (typeof START_SIDES)[number];
/** What a BO1's coin toss winner takes; the other team makes the other decision (BLAST 5.1.3.2). */
export const TOSS_CHOICES = ['side_selection', 'first_ban'] as const;
export type TossChoice = (typeof TOSS_CHOICES)[number];
/** How team A was found: by rank, or by a coin toss that leaves the teams decisions to make. */
export const VETO_OPENINGS = ['ranked', 'coin'] as const;
export type VetoOpening = (typeof VETO_OPENINGS)[number];
export const VETO_ACTIONS = [
  'toss_choice',
  'first_ban',
  'ban',
  'pick',
  'decider',
  'toss',
  'side',
  'ot_side',
] as const;
export type VetoAction = (typeof VETO_ACTIONS)[number];

/** What a veto is played with, frozen when it starts. */
export interface VetoConfig {
  format: VetoFormat;
  pool: readonly string[];
  opening: VetoOpening;
}

/**
 * One stored step. Side steps carry the game they are for. The decider is nobody's choice, and a
 * toss is the coin's: its `team` is the winner.
 */
export interface VetoRecord {
  team: VetoTeam | null;
  action: VetoAction;
  map: string | null;
  side: StartSide | null;
  /** A `toss_choice`'s TossChoice, or the team a `first_ban` sends to ban first. */
  choice: string | null;
  game: number | null;
  timedOut: boolean;
}

export interface VetoGame {
  n: number;
  map: string;
  /** Null for the decider. */
  pickedBy: VetoTeam | null;
  /** Null for a decider whose sides follow the round difference of the earlier maps. */
  side: { team: VetoTeam; side: StartSide } | null;
  otSide: { team: VetoTeam; side: StartSide } | null;
}

/** Who bans first, and who has side selection on a BO1; null until the teams have decided. */
export interface VetoRoles {
  firstBan: VetoTeam | null;
  sideSelection: VetoTeam | null;
}

export type VetoState =
  | ({
      status: 'turn';
      /** How many steps are stored: buttons carry it, so a click on an older message fails. */
      step: number;
      team: VetoTeam;
      action: Exclude<VetoAction, 'decider' | 'toss'>;
      game: number | null;
      /** The game's map, for a side step. */
      map: string | null;
      choices: readonly string[];
    } & VetoRoles)
  | {
      status: 'done';
      bans: { team: VetoTeam; map: string }[];
      games: VetoGame[];
      firstBan: VetoTeam;
      sideSelection: VetoTeam | null;
    };

export type VetoError = 'pool_size' | 'invalid_record';
export type VetoView = { ok: true; state: VetoState } | { ok: false; error: VetoError };

interface Turn {
  team: VetoTeam | null;
  action: VetoAction;
  game: number | null;
}

const otherTeam = (team: VetoTeam): VetoTeam => (team === 'A' ? 'B' : 'A');
const isTeam = (value: string | null | undefined): value is VetoTeam =>
  value === 'A' || value === 'B';

/** Side selection is a prize of its own only where it decides the last map's sides (a BO1). */
const offersSideSelection = (format: VetoFormat) => format.decider_side === 'team_a';

function rolesOf(config: VetoConfig, records: readonly VetoRecord[]): VetoRoles {
  const selects = offersSideSelection(config.format);
  if (config.opening === 'ranked') return { firstBan: 'A', sideSelection: selects ? 'A' : null };
  const firstBan = records.find((record) => record.action === 'first_ban')?.choice;
  const tossChoice = records.find((record) => record.action === 'toss_choice')?.choice;
  let sideSelection: VetoTeam | null = null;
  if (selects && tossChoice === 'side_selection') sideSelection = 'A';
  if (selects && tossChoice === 'first_ban') sideSelection = 'B';
  return { firstBan: isTeam(firstBan) ? firstBan : null, sideSelection };
}

/**
 * The decisions after a coin toss. A BO1's winner takes side selection or the first-ban
 * decision, and the team without side selection decides who bans first; in a BO3 or BO5 the
 * winner decides it.
 */
function openingTurns(config: VetoConfig, roles: VetoRoles): Turn[] {
  if (config.opening === 'ranked') return [];
  if (!offersSideSelection(config.format)) return [{ team: 'A', action: 'first_ban', game: null }];
  const turns: Turn[] = [{ team: 'A', action: 'toss_choice', game: null }];
  if (roles.sideSelection !== null) {
    turns.push({ team: otherTeam(roles.sideSelection), action: 'first_ban', game: null });
  }
  return turns;
}

/** Every turn known so far, side steps included; the stored steps decide the later ones. */
function turnsOf(config: VetoConfig, records: readonly VetoRecord[]): Turn[] {
  const roles = rolesOf(config, records);
  const turns = openingTurns(config, roles);
  const { firstBan } = roles;
  if (firstBan === null) return turns;
  const { format } = config;
  let game = 0;
  for (const step of format.sequence) {
    // The sequence's "A" is the team that bans first.
    const team = step.startsWith('A') ? firstBan : otherTeam(firstBan);
    if (step.endsWith('_ban')) {
      turns.push({ team, action: 'ban', game: null });
      continue;
    }
    game += 1;
    // The picker's opponent picks the starting side, the picker the overtime side.
    turns.push(
      { team, action: 'pick', game },
      { team: otherTeam(team), action: 'side', game },
      { team, action: 'ot_side', game },
    );
  }
  game += 1;
  turns.push({ team: null, action: 'decider', game });
  let chooser: VetoTeam | null = null;
  if (format.decider_side === 'team_a') {
    chooser = roles.sideSelection;
    // Ranked, side selection is A's; after a coin toss, it is taken before the first-ban decision.
    if (chooser === null) throw new Error('A veto reached its decider without side selection');
  } else if (format.decider_side === 'coin') {
    turns.push({ team: null, action: 'toss', game });
    chooser = records.find((record) => record.action === 'toss')?.team ?? null;
  }
  if (chooser !== null) {
    turns.push(
      { team: chooser, action: 'side', game },
      { team: otherTeam(chooser), action: 'ot_side', game },
    );
  }
  return turns;
}

const mapsUsed = (format: VetoFormat) => format.sequence.length;

interface Replay {
  /** Maps not banned or picked yet, in pool order. */
  remaining: string[];
  /** The stored steps plus the automatic ones that fell due: the decider, a toss. */
  records: VetoRecord[];
}

function choicesOf(turn: Turn, remaining: readonly string[]): readonly string[] {
  switch (turn.action) {
    case 'side':
    case 'ot_side':
      return START_SIDES;
    case 'toss_choice':
      return TOSS_CHOICES;
    case 'first_ban':
      // The deciding team first: "we ban first", then "they ban first".
      return turn.team === null ? [] : [turn.team, otherTeam(turn.team)];
    default:
      return [...remaining];
  }
}

function replay(
  config: VetoConfig,
  stored: readonly VetoRecord[],
  coin?: VetoTeam,
): { ok: true; replay: Replay } | { ok: false; error: VetoError } {
  if (config.pool.length !== mapsUsed(config.format) + 1) return { ok: false, error: 'pool_size' };
  const remaining = [...config.pool];
  const records: VetoRecord[] = [];
  for (const [index, record] of stored.entries()) {
    const turn = turnsOf(config, records)[index];
    if (!turn || !matches(turn, record, remaining)) return { ok: false, error: 'invalid_record' };
    if (record.action === 'ban' || record.action === 'pick' || record.action === 'decider') {
      remaining.splice(remaining.indexOf(record.map ?? ''), 1);
    }
    records.push(record);
  }
  addAutomatic(config, remaining, records, coin);
  return { ok: true, replay: { remaining, records } };
}

function matches(turn: Turn, record: VetoRecord, remaining: readonly string[]): boolean {
  if (record.action !== turn.action || record.game !== turn.game) return false;
  if (turn.action === 'toss') {
    return (
      record.team !== null && record.map === null && record.side === null && record.choice === null
    );
  }
  if (record.team !== turn.team) return false;
  switch (turn.action) {
    case 'side':
    case 'ot_side':
      return (
        record.map === null &&
        record.choice === null &&
        record.side !== null &&
        START_SIDES.includes(record.side)
      );
    case 'toss_choice':
    case 'first_ban':
      return (
        record.map === null &&
        record.side === null &&
        record.choice !== null &&
        choicesOf(turn, remaining).includes(record.choice)
      );
    default:
      if (record.side !== null || record.choice !== null) return false;
      if (record.map === null || !remaining.includes(record.map)) return false;
      // The decider is the one map left, never a choice.
      return turn.action !== 'decider' || remaining.length === 1;
  }
}

/**
 * Steps nobody chooses: once the decider is due it is the one map left, and a decider's coin toss
 * takes the coin the caller tossed. Without a coin, the toss waits.
 */
function addAutomatic(
  config: VetoConfig,
  remaining: string[],
  records: VetoRecord[],
  coin: VetoTeam | undefined,
): void {
  for (;;) {
    const turn = turnsOf(config, records)[records.length];
    if (!turn) return;
    const blank = { side: null, choice: null, game: turn.game, timedOut: false };
    const [last] = remaining;
    if (turn.action === 'decider' && remaining.length === 1 && last !== undefined) {
      records.push({ ...blank, team: null, action: 'decider', map: last });
      remaining.length = 0;
    } else if (turn.action === 'toss' && coin !== undefined) {
      records.push({ ...blank, team: coin, action: 'toss', map: null });
    } else {
      return;
    }
  }
}

function stateOf(config: VetoConfig, { remaining, records }: Replay): VetoState {
  const turn = turnsOf(config, records)[records.length];
  const roles = rolesOf(config, records);
  if (!turn) return outcome(records, roles);
  // Automatic turns are filled by `addAutomatic`; a toss only waits when no coin was given.
  if (turn.team === null || turn.action === 'decider' || turn.action === 'toss') {
    throw new Error(`A veto ${turn.action} fell due without a coin to toss`);
  }
  const isSide = turn.action === 'side' || turn.action === 'ot_side';
  return {
    status: 'turn',
    step: records.length,
    team: turn.team,
    action: turn.action,
    game: turn.game,
    map: isSide ? (gameMap(records, turn.game) ?? null) : null,
    choices: choicesOf(turn, remaining),
    ...roles,
  };
}

const gameMap = (records: readonly VetoRecord[], game: number | null) =>
  records.find(
    (record) => record.game === game && (record.action === 'pick' || record.action === 'decider'),
  )?.map;

function outcome(records: readonly VetoRecord[], roles: VetoRoles): VetoState {
  const bans: { team: VetoTeam; map: string }[] = [];
  const games: VetoGame[] = [];
  for (const record of records) {
    if (record.action === 'ban' && record.team && record.map) {
      bans.push({ team: record.team, map: record.map });
    } else if ((record.action === 'pick' || record.action === 'decider') && record.map) {
      games.push({
        n: record.game ?? games.length + 1,
        map: record.map,
        pickedBy: record.team,
        side: null,
        otSide: null,
      });
    }
  }
  for (const record of records) {
    const game = games.find((candidate) => candidate.n === record.game);
    if (!game || !record.team || !record.side) continue;
    if (record.action === 'side') game.side = { team: record.team, side: record.side };
    if (record.action === 'ot_side') game.otSide = { team: record.team, side: record.side };
  }
  // A finished veto went through its bans, which come after the first-ban decision.
  if (roles.firstBan === null) throw new Error('A finished veto has no first banner');
  return {
    status: 'done',
    bans,
    games,
    firstBan: roles.firstBan,
    sideSelection: roles.sideSelection,
  };
}

/** Where a veto stands, from its stored steps. */
export function vetoState(config: VetoConfig, stored: readonly VetoRecord[]): VetoView {
  const replayed = replay(config, stored);
  return replayed.ok ? { ok: true, state: stateOf(config, replayed.replay) } : replayed;
}

export type VetoStepResult =
  | {
      ok: true;
      /** The steps to store, in order: the choice, then the decider and a toss if they fall due. */
      added: VetoRecord[];
      state: VetoState;
    }
  | { ok: false; error: VetoError | 'finished' | 'not_your_turn' | 'invalid_choice' };

/**
 * One team's choice: a map for a ban or a pick, `attack` or `defense` for a side step, a
 * TossChoice, or the team that bans first. `coin`, tossed by the caller, settles a decider's toss
 * if this step makes one due, so a caller that may reach a decider always passes one.
 */
export function applyVetoStep(
  config: VetoConfig,
  stored: readonly VetoRecord[],
  move: { team: VetoTeam; choice: string; timedOut?: boolean; coin?: VetoTeam },
): VetoStepResult {
  const replayed = replay(config, stored, move.coin);
  if (!replayed.ok) return replayed;
  // A decider due before any choice (an empty sequence) is stored with this step.
  const pending = replayed.replay.records.slice(stored.length);
  const state = stateOf(config, replayed.replay);
  if (state.status === 'done') return { ok: false, error: 'finished' };
  if (move.team !== state.team) return { ok: false, error: 'not_your_turn' };
  if (!state.choices.includes(move.choice)) return { ok: false, error: 'invalid_choice' };

  const isSide = state.action === 'side' || state.action === 'ot_side';
  const isDecision = state.action === 'toss_choice' || state.action === 'first_ban';
  const record: VetoRecord = {
    team: move.team,
    action: state.action,
    map: isSide || isDecision ? null : move.choice,
    // `choices` of a side step are exactly START_SIDES.
    side: isSide ? (move.choice as StartSide) : null,
    choice: isDecision ? move.choice : null,
    game: state.game,
    timedOut: move.timedOut ?? false,
  };
  const after = replay(config, [...replayed.replay.records, record], move.coin);
  if (!after.ok) throw new Error(`A valid veto step was refused on replay: ${after.error}`);
  return {
    ok: true,
    added: [...pending, ...after.replay.records.slice(replayed.replay.records.length)],
    state: stateOf(config, after.replay),
  };
}

/** The choice made for a team that let its time run out: a random one of those offered. */
export function timeoutChoice(
  turn: Extract<VetoState, { status: 'turn' }>,
  randomIndex: number,
): string {
  const choice = turn.choices[randomIndex % turn.choices.length];
  // A turn always offers at least one choice: a map is left until the decider, two sides, two
  // decisions.
  if (choice === undefined) throw new Error('A veto turn offered no choice');
  return choice;
}
