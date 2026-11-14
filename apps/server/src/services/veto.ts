import {
  applyVetoStep,
  assignSides,
  computeStandings,
  timeoutChoice,
  vetoState,
  type VetoConfig,
  type VetoRecord,
  type VetoState,
  type VetoTeam,
} from '@ligo/core';
import {
  findGuildLeague,
  listLeagueMatches,
  loadStandingsInput,
  schema,
  type Db,
  type GuildLeague,
  type LeagueMatch,
  type MatchVeto,
} from '@ligo/db';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { hasExcludedTeam } from './exclusions.ts';
import { teamsActedFor, type Actor, type TeamRoleHeld } from './permissions.ts';
import { ensurePlayer } from './players.ts';
import { leagueMatch } from './reports.ts';
import { listTeamStaff } from './team-staff.ts';

// The map veto (design doc section 5): who leads it is frozen when it starts, from live
// standings or a coin toss between equal ranks (O-12); each step is a `veto_step` row, replayed
// through packages/core on every click.

const { auditLog, game, match, vetoStep } = schema;

type Side = 'a' | 'b';
const other = (side: Side): Side => (side === 'a' ? 'b' : 'a');
const actsFor = (teams: readonly TeamRoleHeld[], found: LeagueMatch, side: Side) =>
  teams.some((held) => held.teamId === found[side].teamId);

/** Everything a veto message shows. */
export interface VetoView {
  match: LeagueMatch;
  /** The match side of the veto's team A: the lower-ranked team, or the coin toss winner. */
  teamA: Side;
  /** Null after a coin toss: the teams agree on the host (O-12). */
  host: Side | null;
  /** True when equal ranks were settled by a coin toss. */
  byCoin: boolean;
  /** The match sides that ban first and have side selection, once known. */
  roles: { firstBan: Side | null; sideSelection: Side | null };
  state: VetoState;
  /** The steps taken, in order, with the match side that took each. */
  steps: (VetoRecord & { matchSide: Side | null })[];
  /** When the current step runs out; null once the veto is over. */
  deadline: number | null;
  channelId: string | null;
  messageId: string | null;
}

interface StoredVeto {
  found: LeagueMatch;
  row: typeof match.$inferSelect;
  veto: MatchVeto;
  config: VetoConfig;
  teamA: Side;
  records: VetoRecord[];
  lastAt: number;
}

const teamOf = (side: Side, teamA: Side): VetoTeam => (side === teamA ? 'A' : 'B');
const sideOfTeam = (team: VetoTeam, teamA: Side): Side => (team === 'A' ? teamA : other(teamA));
const isSide = (value: string | null): value is Side => value === 'a' || value === 'b';
const isVetoTeam = (value: string | null): value is VetoTeam => value === 'A' || value === 'B';

/** The match's veto as stored, or null when it has not started. */
function loadVeto(db: Pick<Db, 'select'>, found: LeagueMatch): StoredVeto | null {
  const row = db.select().from(match).where(eq(match.id, found.id)).get();
  if (!row?.vetoJson || row.vetoStartedAt === null) return null;
  const veto = row.vetoJson;
  // Before the coin toss, team A was always the side chooser.
  const teamA = veto.team_a ?? row.sideChooser;
  if (!teamA) return null;
  const rows = db
    .select()
    .from(vetoStep)
    .where(eq(vetoStep.matchId, found.id))
    .orderBy(asc(vetoStep.seq))
    .all();
  const records = rows.map((step): VetoRecord => ({
    team: step.side === null ? null : teamOf(step.side, teamA),
    action: step.action,
    map: step.map,
    side: step.startSide,
    // The team sent to ban first is stored as its match side, like every other team.
    choice:
      step.action === 'first_ban' && isSide(step.choice) ? teamOf(step.choice, teamA) : step.choice,
    game: step.gameN,
    timedOut: step.timedOut,
  }));
  const lastAt = rows.at(-1)?.at ?? row.vetoStartedAt;
  const config = { format: veto.format, pool: veto.pool, opening: veto.opening };
  return { found, row, veto, config, teamA, records, lastAt };
}

function viewOf(stored: StoredVeto, state: VetoState): VetoView {
  const { found, row, veto, teamA, records, lastAt } = stored;
  const sideOf = (team: VetoTeam | null) => (team === null ? null : sideOfTeam(team, teamA));
  return {
    match: found,
    teamA,
    host: row.hostSide,
    byCoin: veto.opening === 'coin',
    roles: { firstBan: sideOf(state.firstBan), sideSelection: sideOf(state.sideSelection) },
    state,
    steps: records.map((record) => ({
      ...record,
      matchSide: record.team === null ? null : sideOfTeam(record.team, teamA),
    })),
    deadline: state.status === 'turn' ? lastAt + veto.step_seconds * 1000 : null,
    channelId: row.vetoChannelId,
    messageId: row.vetoMessageId,
  };
}

/** Where a stored veto stands; a veto its own frozen settings refuse is corrupt data. */
function stateOf(stored: StoredVeto): VetoState {
  const view = vetoState(stored.config, stored.records);
  if (!view.ok) throw new Error(`Veto of match ${stored.found.id} is ${view.error}`);
  return view.state;
}

/** Stores new steps and, when the veto ends, the games with their maps and bans. */
function storeSteps(
  tx: Pick<Db, 'insert' | 'update' | 'select'>,
  stored: StoredVeto,
  added: readonly VetoRecord[],
  state: VetoState,
  by: number | null,
  now: number,
): void {
  for (const [index, record] of added.entries()) {
    tx.insert(vetoStep)
      .values({
        matchId: stored.found.id,
        seq: stored.records.length + index,
        side: record.team === null ? null : sideOfTeam(record.team, stored.teamA),
        action: record.action,
        map: record.map,
        startSide: record.side,
        choice:
          record.action === 'first_ban' && isVetoTeam(record.choice)
            ? sideOfTeam(record.choice, stored.teamA)
            : record.choice,
        gameN: record.game,
        at: now,
        // The decider, a toss and a timed-out step are nobody's choice.
        byPlayerId: record.team === null || record.action === 'toss' || record.timedOut ? null : by,
        timedOut: record.timedOut,
      })
      .run();
  }
  // After a coin toss, side selection is known once its winner has chosen.
  if (stored.row.sideChooser === null && state.sideSelection !== null) {
    const chooser = sideOfTeam(state.sideSelection, stored.teamA);
    tx.update(match)
      .set({ sideChooser: chooser, otSideChooser: other(chooser) })
      .where(eq(match.id, stored.found.id))
      .run();
  }
  if (state.status !== 'done') return;
  const bans = state.bans.map((ban) => ({
    side: sideOfTeam(ban.team, stored.teamA),
    map: ban.map,
  }));
  for (const played of state.games) {
    tx.insert(game)
      .values({ matchId: stored.found.id, n: played.n, map: played.map, bansJson: bans })
      .onConflictDoUpdate({
        target: [game.matchId, game.n],
        set: { map: played.map, bansJson: bans },
      })
      .run();
  }
  tx.insert(auditLog)
    .values({
      actorPlayerId: by,
      actorKind: by === null ? 'system' : 'user',
      action: 'match.veto_done',
      entity: 'match',
      entityId: String(stored.found.id),
      beforeJson: {},
      afterJson: { games: state.games, bans },
      at: now,
    })
    .run();
}

// ---------------------------------------------------------------------------------------------
// Starting the veto

export type StartVetoError =
  | 'not_linked'
  | 'no_team'
  | 'match_not_found'
  | 'not_your_match'
  | 'not_schedulable'
  | 'team_excluded'
  | 'already_started'
  | 'no_format'
  | 'pool_size'
  | 'no_ranks';

export type StartVetoReply =
  | {
      ok: true;
      view: VetoView;
      ranks: { a: number; b: number };
      /** Both teams' managers and staff, to ping. */
      mentionUserIds: string[];
    }
  | { ok: false; error: StartVetoError };

/** A team's rank in the match's stage, by live standings. */
function ranksOf(db: Pick<Db, 'select'>, found: LeagueMatch): { a: number; b: number } | null {
  const data = loadStandingsInput(db, found.stageId);
  if (!data) return null;
  const standings = computeStandings(data.input);
  if (!standings.ok) return null;
  const rankOf = (teamId: number) => {
    const entry = data.teams.find((team) => team.teamId === teamId)?.entry;
    return standings.rows.find((row) => row.entry === entry)?.rank;
  };
  const a = rankOf(found.a.teamId);
  const b = rankOf(found.b.teamId);
  return a === undefined || b === undefined ? null : { a, b };
}

/**
 * An official of either team, or league staff, starts the veto. Who leads it, picks sides and
 * hosts is frozen from live standings; between equal ranks a coin toss names team A, which then
 * makes BLAST's choice, and nobody is named host (O-11, O-12). The format, pool and timer are
 * frozen too.
 */
export function startVeto(
  db: Db,
  actor: Actor,
  request: { matchId: number },
  now: number,
  flipCoin: () => Side,
): StartVetoReply {
  const league = actor.guildId === null ? undefined : findGuildLeague(db, actor.guildId);
  if (!league) return { ok: false, error: 'not_linked' };

  // League staff may start any veto, for teams that wait; only the teams choose.
  const isStaff = actor.memberRoleIds.includes(league.guild.staffRoleId);
  return db.transaction((tx): StartVetoReply => {
    const acting = teamsActedFor(tx, actor);
    if (!isStaff && acting.teams.length === 0) return { ok: false, error: 'no_team' };
    const found = leagueMatch(tx, league, request.matchId);
    if (!found) return { ok: false, error: 'match_not_found' };
    if (!isStaff && !actsFor(acting.teams, found, 'a') && !actsFor(acting.teams, found, 'b')) {
      return { ok: false, error: 'not_your_match' };
    }
    if (found.status !== 'scheduled') return { ok: false, error: 'not_schedulable' };
    if (hasExcludedTeam(tx, found)) return { ok: false, error: 'team_excluded' };
    if (loadVeto(tx, found)) return { ok: false, error: 'already_started' };

    const frozen = vetoSettings(tx, league, found);
    if (!frozen.ok) return frozen;
    const ranks = ranksOf(tx, found);
    if (!ranks) return { ok: false, error: 'no_ranks' };
    const sides = assignSides(ranks.a, ranks.b, ranks.a === ranks.b ? flipCoin() : 'a');
    const veto: MatchVeto = {
      ...frozen.veto,
      opening: sides.byCoin ? 'coin' : 'ranked',
      team_a: sides.lead,
    };

    tx.update(match)
      .set({
        sideChooser: sides.sideChooser,
        otSideChooser: sides.otSideChooser,
        hostSide: sides.host,
        vetoJson: veto,
        vetoStartedAt: now,
      })
      .where(eq(match.id, found.id))
      .run();
    const starter = ensurePlayer(
      tx,
      { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
      now,
    );
    tx.insert(auditLog)
      .values({
        actorPlayerId: starter.id,
        actorKind: 'user',
        action: 'match.veto_start',
        entity: 'match',
        entityId: String(found.id),
        beforeJson: {},
        afterJson: { ...sides, ranks, ...veto },
        at: now,
      })
      .run();

    const stored = loadVeto(tx, found);
    // Just written in this transaction.
    if (!stored) throw new Error(`Veto of match ${found.id} was not stored`);
    // An empty sequence has its decider due at once.
    const view = vetoState(stored.config, stored.records);
    if (!view.ok) return { ok: false, error: 'pool_size' };
    const mentionUserIds = [found.a.teamId, found.b.teamId]
      .flatMap((teamId) => listTeamStaff(tx, teamId))
      .flatMap((member) => member.discordUserId ?? []);
    return {
      ok: true,
      view: viewOf(stored, view.state),
      ranks,
      mentionUserIds,
    };
  });
}

/** The season's pool and the competition's sequence for this match's format. */
function vetoSettings(
  db: Pick<Db, 'select'>,
  league: GuildLeague,
  found: LeagueMatch,
): { ok: true; veto: MatchVeto } | { ok: false; error: 'no_format' | 'pool_size' } {
  const settings = league.competition.rulesetJson.veto;
  const format = settings.formats[`bo${found.bestOf}`];
  if (!format) return { ok: false, error: 'no_format' };
  const seasonRow = db
    .select({ settings: schema.season.settingsJson })
    .from(schema.season)
    .where(eq(schema.season.id, found.seasonId))
    .get();
  const pool = seasonRow?.settings.map_pool ?? [];
  if (!vetoState({ format, pool, opening: 'ranked' }, []).ok) {
    return { ok: false, error: 'pool_size' };
  }
  return {
    ok: true,
    veto: { format, pool, step_seconds: settings.step_seconds, opening: 'ranked' },
  };
}

/** Remembers the message that shows the veto, so later steps and the clock can edit it. */
export function setVetoMessage(
  db: Db,
  matchId: number,
  message: { channelId: string; messageId: string },
): void {
  db.update(match)
    .set({ vetoChannelId: message.channelId, vetoMessageId: message.messageId })
    .where(eq(match.id, matchId))
    .run();
}

// ---------------------------------------------------------------------------------------------
// A team's choice

export type VetoChoiceError =
  | 'not_linked'
  | 'match_not_found'
  | 'not_started'
  | 'stale'
  | 'finished'
  | 'not_your_match'
  | 'not_your_turn'
  | 'invalid_choice'
  | 'team_excluded'
  | 'not_schedulable';

export type VetoChoiceReply = { ok: true; view: VetoView } | { ok: false; error: VetoChoiceError };

/**
 * The team whose turn it is makes its choice: a ban, a pick, a side, or a decision after the
 * coin toss. `step` is the number of steps the clicked message showed: a click on an older
 * message is stale and changes nothing. `tossCoin` settles the decider's toss if this step
 * makes it due.
 */
export function chooseVetoStep(
  db: Db,
  actor: Actor,
  /** A choice by name (the website), or by its place among the choices offered (a button). */
  request: { matchId: number; step: number; choice: string | number },
  now: number,
  tossCoin: () => Side,
): VetoChoiceReply {
  const league = actor.guildId === null ? undefined : findGuildLeague(db, actor.guildId);
  if (!league) return { ok: false, error: 'not_linked' };

  return db.transaction((tx): VetoChoiceReply => {
    const found = leagueMatch(tx, league, request.matchId);
    if (!found) return { ok: false, error: 'match_not_found' };
    const stored = loadVeto(tx, found);
    if (!stored) return { ok: false, error: 'not_started' };
    const state = stateOf(stored);
    if (state.status === 'done') return { ok: false, error: 'finished' };
    if (state.step !== request.step) return { ok: false, error: 'stale' };
    if (found.status !== 'scheduled') return { ok: false, error: 'not_schedulable' };
    if (hasExcludedTeam(tx, found)) return { ok: false, error: 'team_excluded' };

    const acting = teamsActedFor(tx, actor);
    if (!actsFor(acting.teams, found, 'a') && !actsFor(acting.teams, found, 'b')) {
      return { ok: false, error: 'not_your_match' };
    }
    const turnSide = sideOfTeam(state.team, stored.teamA);
    // Someone acting for both teams (one person testing) plays whichever turn is due.
    if (!actsFor(acting.teams, found, turnSide)) return { ok: false, error: 'not_your_turn' };

    const choice =
      typeof request.choice === 'number' ? (state.choices[request.choice] ?? '') : request.choice;
    const result = applyVetoStep(stored.config, stored.records, {
      team: state.team,
      choice,
      coin: teamOf(tossCoin(), stored.teamA),
    });
    if (!result.ok) {
      return {
        ok: false,
        error: result.error === 'invalid_choice' ? 'invalid_choice' : 'stale',
      };
    }
    const player = ensurePlayer(
      tx,
      { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
      now,
    );
    storeSteps(tx, stored, result.added, result.state, player.id, now);
    const after = loadVeto(tx, found);
    if (!after) throw new Error(`Veto of match ${found.id} vanished`);
    return { ok: true, view: viewOf(after, result.state) };
  });
}

// ---------------------------------------------------------------------------------------------
// The clock

/**
 * Plays every veto step whose time ran out with a random choice, marked as timed out. One step
 * per veto per tick: the next step's time starts now. Returns the vetoes whose message to edit.
 */
export function runVetoTick(db: Db, now: number, random: (below: number) => number): VetoView[] {
  const candidates = db
    .select({ id: match.id })
    .from(match)
    .where(and(eq(match.status, 'scheduled'), isNotNull(match.vetoJson)))
    .orderBy(asc(match.id))
    .all();
  const views: VetoView[] = [];
  for (const { id } of candidates) {
    const view = db.transaction((tx): VetoView | null => {
      const [found] = listLeagueMatches(tx, { matchId: id });
      const stored = found && !hasExcludedTeam(tx, found) ? loadVeto(tx, found) : null;
      if (!stored) return null;
      const state = stateOf(stored);
      if (state.status === 'done') return null;
      if (now < stored.lastAt + stored.veto.step_seconds * 1000) return null;
      const result = applyVetoStep(stored.config, stored.records, {
        team: state.team,
        choice: timeoutChoice(state, random(state.choices.length)),
        timedOut: true,
        coin: random(2) === 0 ? 'A' : 'B',
      });
      // The choice comes from the state's own list, for the team whose turn it is.
      if (!result.ok) throw new Error(`Timed-out veto step refused: ${result.error}`);
      storeSteps(tx, stored, result.added, result.state, null, now);
      const after = loadVeto(tx, stored.found);
      return after && viewOf(after, result.state);
    });
    if (view) views.push(view);
  }
  return views;
}

/** The veto of a match, for showing it again; null when it has not started. */
export function readVeto(db: Pick<Db, 'select'>, found: LeagueMatch): VetoView | null {
  const stored = loadVeto(db, found);
  return stored && viewOf(stored, stateOf(stored));
}
