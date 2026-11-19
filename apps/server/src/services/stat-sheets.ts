import type { StatsSettings } from '@ligo/core';
import { listLeagueMatches, schema, type Db, type LeagueMatch } from '@ligo/db';
import {
  checkSide,
  crossCheck,
  manualMetrics,
  played,
  statsOf,
  type CellError,
  type CrossWarning,
  type SideError,
  type TitleStats,
} from '@ligo/titles';
import { and, asc, eq, inArray, isNull, or, gt, lte } from 'drizzle-orm';
import { actsFor, matchActorOf, requireStaff, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';

// The manual stat grid (design doc section 7; M-39, maintainer, 19 November 2026). For each game
// of a match, each side's stats: a team's officials and captains enter their own side, which
// stands at once; a side the opponent entered waits for its own team's confirmation; league
// staff enter or correct any side. Impossible values are refused; the check across sides only
// warns. Replays always win: a game with replay stats has no grid.

const { auditLog, competition, game, lineup, lineupMember, match, player, rosterEntry, stat } =
  schema;
const { statSheet } = schema;

type Side = 'a' | 'b';
type Reader = Pick<Db, 'select'>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const SIDES: readonly Side[] = ['a', 'b'];
const DAY_MS = 86_400_000;
const other = (side: Side): Side => (side === 'a' ? 'b' : 'a');

/** Why a game's grid is closed, or null when it is open. */
export type StatsLock = 'no_result' | 'forfeit' | 'void' | 'replay' | 'deadline';

interface Context {
  found: LeagueMatch;
  matchRow: typeof match.$inferSelect;
  stats: TitleStats;
  settings: StatsSettings;
  staff: boolean;
  /** The sides the actor acts for: officials, captains, the match's stand-in captain. */
  sides: Side[];
  playerId: number | null;
}

/** The match, its title's stats and who the actor is for it; null when they have no part in it. */
function contextOf(
  db: Reader,
  actor: Actor,
  matchId: number,
): Context | { error: 'not_found' | 'not_allowed' | 'no_stats' } {
  const [found] = listLeagueMatches(db, { matchId });
  if (!found) return { error: 'not_found' };
  const comp = db
    .select({ title: competition.title, ruleset: competition.rulesetJson })
    .from(competition)
    .where(eq(competition.id, found.competitionId))
    .get();
  const matchRow = db.select().from(match).where(eq(match.id, matchId)).get();
  if (!comp || !matchRow) return { error: 'not_found' };
  const stats = statsOf(comp.title);
  if (!stats) return { error: 'no_stats' };
  const staffCheck = requireStaff(db, actor);
  const staff = staffCheck.ok && staffCheck.league.competition.id === found.competitionId;
  const acting = matchActorOf(db, actor, found.seasonId);
  const sides = SIDES.filter((side) => actsFor(acting.teams, found, side));
  if (!staff && sides.length === 0) return { error: 'not_allowed' };
  return {
    found,
    matchRow,
    stats,
    settings: comp.ruleset.stats,
    staff,
    sides,
    playerId: acting.playerId,
  };
}

/** Why the game's grid is closed for this actor now; staff are bound by no deadline. */
function lockOf(
  context: Context,
  gameRow: typeof game.$inferSelect,
  now: number,
): StatsLock | null {
  const { matchRow, settings } = context;
  if (matchRow.status === 'void' || gameRow.status === 'void') return 'void';
  if (matchRow.status === 'forfeit' || gameRow.forfeitSide !== null) return 'forfeit';
  if (matchRow.status === 'scheduled') return 'no_result';
  if (gameRow.statsSource === 'replay' || gameRow.statsSource === 'api') return 'replay';
  if (
    !context.staff &&
    settings.entry_days !== null &&
    matchRow.status === 'validated' &&
    matchRow.validatedAt !== null &&
    now > matchRow.validatedAt + settings.entry_days * DAY_MS
  ) {
    return 'deadline';
  }
  return null;
}

/** When the match was played, for its lineups: its time, else the end of its week. */
const playedAt = (found: LeagueMatch) => found.scheduledAt ?? found.window.end - 1;

export interface SheetPlayer {
  playerId: number;
  name: string;
  role: 'player' | 'sub';
}

/**
 * Who can be in a side's sheet: the side's lineup when the match was played (blocked incoming
 * players left out), and anyone already entered for it.
 */
function candidatesOf(db: Reader, found: LeagueMatch, side: Side): SheetPlayer[] {
  const at = playedAt(found);
  const rows = db
    .select({ playerId: rosterEntry.playerId, name: player.displayName, role: rosterEntry.role })
    .from(rosterEntry)
    .innerJoin(player, eq(rosterEntry.playerId, player.id))
    .where(
      and(
        eq(rosterEntry.seasonId, found.seasonId),
        eq(rosterEntry.teamId, found[side].teamId),
        lte(rosterEntry.validFrom, at),
        or(isNull(rosterEntry.validTo), gt(rosterEntry.validTo, at)),
      ),
    )
    .orderBy(asc(rosterEntry.role), asc(player.displayName))
    .all();
  const members = db
    .select({ playerId: lineupMember.playerId, name: player.displayName, role: lineupMember.role })
    .from(lineupMember)
    .innerJoin(lineup, eq(lineupMember.lineupId, lineup.id))
    .innerJoin(player, eq(lineupMember.playerId, player.id))
    .where(and(eq(lineup.matchId, found.id), eq(lineup.side, side)))
    .all();
  const seen = new Set<number>();
  const result: SheetPlayer[] = [];
  for (const row of rows) {
    if (row.role === 'coach' || seen.has(row.playerId)) continue;
    seen.add(row.playerId);
    result.push({ playerId: row.playerId, name: row.name, role: row.role });
  }
  for (const row of members) {
    if (seen.has(row.playerId)) continue;
    seen.add(row.playerId);
    result.push({
      playerId: row.playerId,
      name: row.name,
      role: row.role === 'starter' ? 'player' : 'sub',
    });
  }
  return result;
}

/** The stored manual values of these players for the game. */
function valuesOf(
  db: Reader,
  stats: TitleStats,
  gameId: number,
  playerIds: readonly number[],
): Map<number, Record<string, number | null>> {
  const keys = manualMetrics(stats).map((metric) => metric.key);
  const empty = (): Record<string, number | null> =>
    Object.fromEntries(keys.map((key): [string, number | null] => [key, null]));
  const values = new Map(playerIds.map((id) => [id, empty()]));
  if (playerIds.length === 0) return values;
  for (const row of db
    .select()
    .from(stat)
    .where(and(eq(stat.gameId, gameId), inArray(stat.playerId, [...playerIds])))
    .all()) {
    const entry = values.get(row.playerId);
    if (entry && row.metric in entry) entry[row.metric] = row.value;
  }
  return values;
}

const sheetOf = (db: Reader, gameId: number, side: Side) =>
  db
    .select()
    .from(statSheet)
    .where(and(eq(statSheet.gameId, gameId), eq(statSheet.side, side)))
    .get() ?? null;

/** Whether the actor may enter this side: own side, staff, or the opponent's untouched or own entry. */
function mayEdit(
  context: Context,
  side: Side,
  sheet: typeof statSheet.$inferSelect | null,
): boolean {
  if (context.staff || context.sides.includes(side)) return true;
  if (!context.sides.includes(other(side))) return false;
  return sheet === null || (sheet.enteredAs === 'opponent' && sheet.confirmedBy === null);
}

const gamesOf = (db: Reader, matchId: number) =>
  db.select().from(game).where(eq(game.matchId, matchId)).orderBy(asc(game.n)).all();

export interface SideSheetView {
  side: Side;
  team: string;
  rows: (SheetPlayer & { values: Record<string, number | null> })[];
  entry: {
    enteredAs: 'own' | 'opponent' | 'staff';
    enteredBy: string;
    enteredAt: number;
    confirmed: boolean;
  } | null;
  canEdit: boolean;
  canConfirm: boolean;
}

export type StatGridView =
  | {
      ok: true;
      match: { id: number; a: string; b: string };
      games: { n: number; map: string | null; scoreA: number; scoreB: number }[];
      game: {
        n: number;
        map: string | null;
        scoreA: number;
        scoreB: number;
        lock: StatsLock | null;
      };
      metrics: { key: string; label: { fr: string; en: string }; optional: boolean }[];
      sides: SideSheetView[];
      warnings: CrossWarning[];
      staff: boolean;
    }
  | { ok: false; error: 'not_found' | 'not_allowed' | 'no_stats' | 'no_game' };

/** The grid of one game of a match (the first by default), for its teams and league staff. */
export function statGrid(
  db: Reader,
  actor: Actor,
  matchId: number,
  n: number | null,
  now: number,
): StatGridView {
  const context = contextOf(db, actor, matchId);
  if ('error' in context) return { ok: false, error: context.error };
  const games = gamesOf(db, matchId);
  const gameRow = n === null ? games[0] : games.find((entry) => entry.n === n);
  if (!gameRow) return { ok: false, error: 'no_game' };
  const lock = lockOf(context, gameRow, now);
  const sides = SIDES.map((side): SideSheetView => {
    const candidates = candidatesOf(db, context.found, side);
    const values = valuesOf(
      db,
      context.stats,
      gameRow.id,
      candidates.map((entry) => entry.playerId),
    );
    const sheet = sheetOf(db, gameRow.id, side);
    const enteredBy = sheet
      ? (db
          .select({ name: player.displayName })
          .from(player)
          .where(eq(player.id, sheet.enteredBy))
          .get()?.name ?? '?')
      : '';
    return {
      side,
      team: context.found[side].name,
      rows: candidates.map((entry) => ({ ...entry, values: values.get(entry.playerId) ?? {} })),
      entry: sheet && {
        enteredAs: sheet.enteredAs,
        enteredBy,
        enteredAt: sheet.enteredAt,
        confirmed: sheet.confirmedBy !== null,
      },
      canEdit: lock === null && mayEdit(context, side, sheet),
      canConfirm:
        lock === null &&
        sheet?.enteredAs === 'opponent' &&
        sheet.confirmedBy === null &&
        context.sides.includes(side),
    };
  });
  const rowsOf = (view: SideSheetView) => view.rows.map((row) => row.values);
  const [sideA, sideB] = sides;
  return {
    ok: true,
    match: { id: matchId, a: context.found.a.name, b: context.found.b.name },
    games: games.map((entry) => ({
      n: entry.n,
      map: entry.map,
      scoreA: entry.scoreA,
      scoreB: entry.scoreB,
    })),
    game: {
      n: gameRow.n,
      map: gameRow.map,
      scoreA: gameRow.scoreA,
      scoreB: gameRow.scoreB,
      lock,
    },
    metrics: manualMetrics(context.stats).map((metric) => ({
      key: metric.key,
      label: metric.label,
      optional: metric.optional ?? false,
    })),
    sides,
    warnings:
      sideA && sideB
        ? crossCheck(
            context.stats,
            rowsOf(sideA),
            rowsOf(sideB),
            context.settings.kills_deaths_tolerance,
          )
        : [],
    staff: context.staff,
  };
}

/** What a form sends for one player: each metric as typed. */
export interface SheetRowInput {
  playerId: number;
  values: Readonly<Record<string, string>>;
}

export interface SheetInput {
  matchId: number;
  n: number;
  side: Side;
  rows: readonly SheetRowInput[];
}

/** A value as typed: empty is nothing; anything but a whole number fails the checks. */
function parseValue(text: string | undefined): number | null {
  const trimmed = (text ?? '').trim();
  if (trimmed === '') return null;
  return /^-?\d{1,6}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

export type SheetCheck = {
  /** Each player's problems, by player ID; only players with one are listed. */
  rows: Map<number, CellError[]>;
  side: SideError[];
  /** Players named who cannot be in this side's sheet. */
  unknown: number[];
};

export type SheetError =
  'not_found' | 'not_allowed' | 'no_stats' | 'no_game' | 'invalid' | StatsLock;

/** Reads and checks a sheet as typed, without storing anything. */
function readSheet(
  db: Reader,
  context: Context,
  gameRow: typeof game.$inferSelect,
  input: SheetInput,
) {
  const candidates = new Set(
    candidatesOf(db, context.found, input.side).map((row) => row.playerId),
  );
  const keys = manualMetrics(context.stats).map((metric) => metric.key);
  const parsed = input.rows.map((row) => ({
    playerId: row.playerId,
    values: Object.fromEntries(keys.map((key) => [key, parseValue(row.values[key])])),
  }));
  const ctx = { rounds: gameRow.scoreA + gameRow.scoreB };
  const checked = checkSide(
    context.stats,
    ctx,
    parsed.map((row) => row.values),
  );
  const rows = new Map<number, CellError[]>();
  parsed.forEach((row, index) => {
    const errors = checked.rows[index] ?? [];
    if (errors.length > 0) rows.set(row.playerId, errors);
  });
  const check: SheetCheck = {
    rows,
    side: checked.side,
    unknown: parsed.filter((row) => !candidates.has(row.playerId)).map((row) => row.playerId),
  };
  return { parsed, check };
}

const clean = (check: SheetCheck) =>
  check.rows.size === 0 && check.side.length === 0 && check.unknown.length === 0;

/** The game and the actor's right to enter this side, or why not. */
function editable(
  db: Reader,
  actor: Actor,
  input: Pick<SheetInput, 'matchId' | 'n' | 'side'>,
  now: number,
) {
  const context = contextOf(db, actor, input.matchId);
  if ('error' in context) return { ok: false as const, error: context.error };
  const gameRow = gamesOf(db, input.matchId).find((entry) => entry.n === input.n);
  if (!gameRow) return { ok: false as const, error: 'no_game' as const };
  const lock = lockOf(context, gameRow, now);
  if (lock !== null) return { ok: false as const, error: lock };
  if (!mayEdit(context, input.side, sheetOf(db, gameRow.id, input.side))) {
    return { ok: false as const, error: 'not_allowed' as const };
  }
  return { ok: true as const, context, gameRow };
}

/** Checks a sheet as typed, for the grid's live checks: nothing is stored. */
export function checkSheet(
  db: Reader,
  actor: Actor,
  input: SheetInput,
  now: number,
): { ok: true; check: SheetCheck } | { ok: false; error: SheetError } {
  const allowed = editable(db, actor, input, now);
  if (!allowed.ok) return allowed;
  return { ok: true, check: readSheet(db, allowed.context, allowed.gameRow, input).check };
}

export type SaveSheetReply =
  | { ok: true; enteredAs: 'own' | 'opponent' | 'staff' }
  | { ok: false; error: SheetError; check?: SheetCheck };

/**
 * Stores one side's sheet for one game, replacing the side's manual stats there. Entered by its
 * own team or staff, it counts at once; by the opponent, it waits for its own team. The match's
 * lineup for the side becomes the players with stats in any of its games, and the game's stats
 * are manual.
 */
export function saveSheet(db: Db, actor: Actor, input: SheetInput, now: number): SaveSheetReply {
  const allowed = editable(db, actor, input, now);
  if (!allowed.ok) return allowed;
  const { context, gameRow } = allowed;
  const { parsed, check } = readSheet(db, context, gameRow, input);
  if (!clean(check)) return { ok: false, error: 'invalid', check };
  const enteredAs: 'own' | 'opponent' | 'staff' = context.staff
    ? 'staff'
    : context.sides.includes(input.side)
      ? 'own'
      : 'opponent';
  const verified = enteredAs !== 'opponent';
  const side = input.side;

  db.transaction((tx) => {
    const by =
      context.playerId ??
      ensurePlayer(
        tx,
        {
          orgId: orgOf(tx, context.found),
          discordUserId: actor.user.id,
          displayName: actor.user.displayName,
        },
        now,
      ).id;
    const sidePlayers = candidatesOf(tx, context.found, side).map((row) => row.playerId);
    if (sidePlayers.length > 0) {
      tx.delete(stat)
        .where(
          and(
            eq(stat.gameId, gameRow.id),
            eq(stat.source, 'manual'),
            inArray(stat.playerId, sidePlayers),
          ),
        )
        .run();
    }
    for (const row of parsed) {
      if (!played(context.stats, row.values)) continue;
      for (const [metric, value] of Object.entries(row.values)) {
        if (value === null) continue;
        tx.insert(stat)
          .values({
            gameId: gameRow.id,
            playerId: row.playerId,
            metric,
            value,
            source: 'manual',
            enteredBy: by,
            verified,
          })
          .run();
      }
    }
    const before = sheetOf(tx, gameRow.id, side);
    const values = {
      enteredBy: by,
      enteredAt: now,
      enteredAs,
      confirmedBy: null,
      confirmedAt: null,
    };
    if (before) {
      tx.update(statSheet)
        .set(values)
        .where(and(eq(statSheet.gameId, gameRow.id), eq(statSheet.side, side)))
        .run();
    } else {
      tx.insert(statSheet)
        .values({ gameId: gameRow.id, side, ...values })
        .run();
    }
    if (gameRow.statsSource === 'none') {
      tx.update(game).set({ statsSource: 'manual' }).where(eq(game.id, gameRow.id)).run();
    }
    refreshLineup(tx, context, side, sidePlayers);
    tx.insert(auditLog)
      .values({
        actorPlayerId: by,
        actorKind: 'user',
        action: 'stats.sheet',
        entity: 'game',
        entityId: String(gameRow.id),
        beforeJson: before ? { side, enteredAs: before.enteredAs } : null,
        afterJson: {
          side,
          enteredAs,
          players: parsed.filter((row) => played(context.stats, row.values)).length,
        },
        at: now,
      })
      .run();
  });
  return { ok: true, enteredAs };
}

const orgOf = (db: Reader, found: LeagueMatch) =>
  db
    .select({ orgId: competition.orgId })
    .from(competition)
    .where(eq(competition.id, found.competitionId))
    .get()?.orgId ?? 0;

/** The side's match lineup: its players with manual stats in any game of the match. */
function refreshLineup(tx: Tx, context: Context, side: Side, sidePlayers: readonly number[]) {
  const { found } = context;
  const gameIds = gamesOf(tx, found.id).map((row) => row.id);
  const withStats =
    sidePlayers.length === 0 || gameIds.length === 0
      ? []
      : tx
          .selectDistinct({ playerId: stat.playerId })
          .from(stat)
          .where(and(inArray(stat.gameId, gameIds), inArray(stat.playerId, [...sidePlayers])))
          .all()
          .map((row) => row.playerId);
  let lineupRow = tx
    .select()
    .from(lineup)
    .where(and(eq(lineup.matchId, found.id), eq(lineup.side, side)))
    .get();
  lineupRow ??= tx
    .insert(lineup)
    .values({ matchId: found.id, side, teamId: found[side].teamId })
    .returning()
    .get();
  tx.delete(lineupMember).where(eq(lineupMember.lineupId, lineupRow.id)).run();
  const roles = new Map(candidatesOf(tx, found, side).map((row) => [row.playerId, row.role]));
  for (const playerId of withStats) {
    tx.insert(lineupMember)
      .values({
        lineupId: lineupRow.id,
        playerId,
        role: roles.get(playerId) === 'sub' ? 'sub' : 'starter',
      })
      .run();
  }
}

export type ConfirmSheetReply =
  { ok: true } | { ok: false; error: SheetError | 'nothing_to_confirm' };

/** A side's own team confirms the sheet the opponent entered: its stats count from now. */
export function confirmSheet(
  db: Db,
  actor: Actor,
  input: Pick<SheetInput, 'matchId' | 'n' | 'side'>,
  now: number,
): ConfirmSheetReply {
  const context = contextOf(db, actor, input.matchId);
  if ('error' in context) return { ok: false, error: context.error };
  if (!context.sides.includes(input.side) || context.playerId === null) {
    return { ok: false, error: 'not_allowed' };
  }
  const by = context.playerId;
  const gameRow = gamesOf(db, input.matchId).find((entry) => entry.n === input.n);
  if (!gameRow) return { ok: false, error: 'no_game' };
  const lock = lockOf(context, gameRow, now);
  if (lock !== null) return { ok: false, error: lock };
  const sheet = sheetOf(db, gameRow.id, input.side);
  if (sheet?.enteredAs !== 'opponent' || sheet.confirmedBy !== null) {
    return { ok: false, error: 'nothing_to_confirm' };
  }
  const sidePlayers = candidatesOf(db, context.found, input.side).map((row) => row.playerId);
  db.transaction((tx) => {
    tx.update(statSheet)
      .set({ confirmedBy: by, confirmedAt: now })
      .where(and(eq(statSheet.gameId, gameRow.id), eq(statSheet.side, input.side)))
      .run();
    if (sidePlayers.length > 0) {
      tx.update(stat)
        .set({ verified: true })
        .where(
          and(
            eq(stat.gameId, gameRow.id),
            eq(stat.source, 'manual'),
            inArray(stat.playerId, sidePlayers),
          ),
        )
        .run();
    }
    tx.insert(auditLog)
      .values({
        actorPlayerId: by,
        actorKind: 'user',
        action: 'stats.confirm',
        entity: 'game',
        entityId: String(gameRow.id),
        beforeJson: { side: input.side, confirmed: false },
        afterJson: { side: input.side, confirmed: true },
        at: now,
      })
      .run();
  });
  return { ok: true };
}
