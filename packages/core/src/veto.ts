import type { VetoFormat } from './settings.ts';

// The map veto as a state machine (design doc section 5). The stored steps are the whole state:
// every call replays them against the format, so a stale or forged click cannot skip a turn.

/** A is the team that picks the starting side and starts the veto; B is the other. */
export type VetoTeam = 'A' | 'B';
export const START_SIDES = ['attack', 'defense'] as const;
export type StartSide = (typeof START_SIDES)[number];
export type VetoAction = 'ban' | 'pick' | 'decider' | 'side' | 'ot_side';

/** One stored step. Side steps carry the game they are for; the decider is nobody's choice. */
export interface VetoRecord {
  team: VetoTeam | null;
  action: VetoAction;
  map: string | null;
  side: StartSide | null;
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

export type VetoState =
  | {
      status: 'turn';
      /** How many steps are stored: buttons carry it, so a click on an older message fails. */
      step: number;
      team: VetoTeam;
      action: Exclude<VetoAction, 'decider'>;
      game: number | null;
      /** The game's map, for a side step. */
      map: string | null;
      choices: readonly string[];
    }
  | { status: 'done'; bans: { team: VetoTeam; map: string }[]; games: VetoGame[] };

export type VetoError = 'pool_size' | 'invalid_record';
export type VetoView = { ok: true; state: VetoState } | { ok: false; error: VetoError };

interface Turn {
  team: VetoTeam | null;
  action: VetoAction;
  game: number | null;
}

const otherTeam = (team: VetoTeam): VetoTeam => (team === 'A' ? 'B' : 'A');

/** Every turn of a format in order, side steps included. */
function turnsOf(format: VetoFormat): Turn[] {
  const turns: Turn[] = [];
  let game = 0;
  for (const step of format.sequence) {
    const team: VetoTeam = step.startsWith('A') ? 'A' : 'B';
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
  if (format.decider_side === 'team_a') {
    turns.push({ team: 'A', action: 'side', game }, { team: 'B', action: 'ot_side', game });
  }
  return turns;
}

const mapsUsed = (format: VetoFormat) => format.sequence.length;

interface Replay {
  turns: Turn[];
  /** Maps not banned or picked yet, in pool order. */
  remaining: string[];
  /** The stored steps plus the automatic decider when it is due. */
  records: VetoRecord[];
}

function replay(
  format: VetoFormat,
  pool: readonly string[],
  stored: readonly VetoRecord[],
): { ok: true; replay: Replay } | { ok: false; error: VetoError } {
  if (pool.length !== mapsUsed(format) + 1) return { ok: false, error: 'pool_size' };
  const turns = turnsOf(format);
  const remaining = [...pool];
  const records: VetoRecord[] = [];
  for (const [index, record] of stored.entries()) {
    const turn = turns[index];
    if (!turn || !matches(turn, record, remaining)) return { ok: false, error: 'invalid_record' };
    if (record.map !== null && record.action !== 'side' && record.action !== 'ot_side') {
      remaining.splice(remaining.indexOf(record.map), 1);
    }
    records.push(record);
  }
  addDecider(turns, remaining, records);
  return { ok: true, replay: { turns, remaining, records } };
}

function matches(turn: Turn, record: VetoRecord, remaining: readonly string[]): boolean {
  if (record.team !== turn.team || record.action !== turn.action || record.game !== turn.game) {
    return false;
  }
  if (turn.action === 'side' || turn.action === 'ot_side') {
    return record.map === null && record.side !== null && START_SIDES.includes(record.side);
  }
  if (record.side !== null || record.map === null || !remaining.includes(record.map)) return false;
  // The decider is the one map left, never a choice.
  return turn.action !== 'decider' || remaining.length === 1;
}

/** The decider is nobody's turn: once it is due, it is the one map left. */
function addDecider(turns: readonly Turn[], remaining: string[], records: VetoRecord[]): void {
  const turn = turns[records.length];
  const [last] = remaining;
  if (turn?.action !== 'decider' || remaining.length !== 1 || last === undefined) return;
  records.push({
    team: null,
    action: 'decider',
    map: last,
    side: null,
    game: turn.game,
    timedOut: false,
  });
  remaining.length = 0;
}

function stateOf({ turns, remaining, records }: Replay): VetoState {
  const turn = turns[records.length];
  if (!turn) return outcome(records);
  // A decider turn is filled by `addDecider`, so the next turn always has a team.
  if (turn.team === null || turn.action === 'decider') {
    throw new Error('A veto turn without a team was left unplayed');
  }
  const isSide = turn.action === 'side' || turn.action === 'ot_side';
  const map = isSide ? (gameMap(records, turn.game) ?? null) : null;
  return {
    status: 'turn',
    step: records.length,
    team: turn.team,
    action: turn.action,
    game: turn.game,
    map,
    choices: isSide ? START_SIDES : [...remaining],
  };
}

const gameMap = (records: readonly VetoRecord[], game: number | null) =>
  records.find(
    (record) => record.game === game && (record.action === 'pick' || record.action === 'decider'),
  )?.map;

function outcome(records: readonly VetoRecord[]): VetoState {
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
  return { status: 'done', bans, games };
}

/** Where a veto stands, from its stored steps. */
export function vetoState(
  format: VetoFormat,
  pool: readonly string[],
  stored: readonly VetoRecord[],
): VetoView {
  const replayed = replay(format, pool, stored);
  return replayed.ok ? { ok: true, state: stateOf(replayed.replay) } : replayed;
}

export type VetoStepResult =
  | {
      ok: true;
      /** The steps to store, in order: the choice, then the decider if it falls due. */
      added: VetoRecord[];
      state: VetoState;
    }
  | { ok: false; error: VetoError | 'finished' | 'not_your_turn' | 'invalid_choice' };

/** One team's choice: a map for a ban or a pick, `attack` or `defense` for a side step. */
export function applyVetoStep(
  format: VetoFormat,
  pool: readonly string[],
  stored: readonly VetoRecord[],
  move: { team: VetoTeam; choice: string; timedOut?: boolean },
): VetoStepResult {
  const replayed = replay(format, pool, stored);
  if (!replayed.ok) return replayed;
  // A decider due before any choice (an empty sequence) is stored with this step.
  const pending = replayed.replay.records.slice(stored.length);
  const state = stateOf(replayed.replay);
  if (state.status === 'done') return { ok: false, error: 'finished' };
  if (move.team !== state.team) return { ok: false, error: 'not_your_turn' };
  if (!state.choices.includes(move.choice)) return { ok: false, error: 'invalid_choice' };

  const isSide = state.action === 'side' || state.action === 'ot_side';
  const record: VetoRecord = {
    team: move.team,
    action: state.action,
    map: isSide ? null : move.choice,
    // `choices` of a side step are exactly START_SIDES.
    side: isSide ? (move.choice as StartSide) : null,
    game: state.game,
    timedOut: move.timedOut ?? false,
  };
  const after = replay(format, pool, [...replayed.replay.records, record]);
  if (!after.ok) throw new Error(`A valid veto step was refused on replay: ${after.error}`);
  return {
    ok: true,
    added: [...pending, ...after.replay.records.slice(replayed.replay.records.length)],
    state: stateOf(after.replay),
  };
}

/** The choice made for a team that let its time run out: a random one of those offered. */
export function timeoutChoice(
  turn: Extract<VetoState, { status: 'turn' }>,
  randomIndex: number,
): string {
  const choice = turn.choices[randomIndex % turn.choices.length];
  // A turn always offers at least one choice: a map is left until the decider, and two sides.
  if (choice === undefined) throw new Error('A veto turn offered no choice');
  return choice;
}
