import { createHash } from 'node:crypto';
import { actsForSide } from '@ligo/core';
import {
  enqueueJob,
  listLeagueMatches,
  matchAccounts,
  schema,
  type Db,
  type LeagueMatch,
} from '@ligo/db';
import { DEFAULT_MAX_FILE_BYTES } from '@ligo/parsers';
import type { ObjectStore, SignedPut } from '@ligo/storage';
import { normalizeR6, r6ReplayRound, type R6Unit } from '@ligo/titles';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { matchRolesOf } from './permissions.ts';

// Replay uploads (design doc section 8, upload flow 4 and 5). The browser parses each round file
// and sends the parser's JSON; the server reads it with its own normaliser and stores one
// `replay_file` per round, unverified, then queues the match's stitch. The raw files follow: the
// server signs one upload each, and once the browser says a file is up, checks it is there and
// queues its verification. Nothing here trusts the browser: the worker re-parses every raw file.

const { competition, lineup, lineupMember, replayFile, rosterEntry, season } = schema;

type Side = 'a' | 'b';
type RawStatus = (typeof replayFile.$inferSelect)['rawStatus'];

/** Round files in one request: a map with overtime and a re-host is about 30. */
export const REPLAY_BATCH_MAX = 64;
/** What a raw file is stored as: its bytes, never served to anyone. */
export const RAW_REPLAY_TYPE = 'application/octet-stream';
/** An upload link lasts this long: the browser asks for one just before each file. */
export const RAW_UPLOAD_EXPIRY_S = 600;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const matchId = z
  .int()
  .min(1)
  .max(2 ** 31);

export const replaySubmitSchema = z.strictObject({
  matchId,
  /** The parser build that read the files in the browser. */
  parser: z.string().min(1).max(64),
  files: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(255),
        size: z.int().min(1).max(DEFAULT_MAX_FILE_BYTES),
        sha256,
        /** The parser's JSON for the file: the server's normaliser reads it. */
        round: z.unknown(),
      }),
    )
    .min(1)
    .max(REPLAY_BATCH_MAX),
});
export type ReplaySubmit = z.infer<typeof replaySubmitSchema>;

export const replayFileIdsSchema = z.strictObject({
  matchId,
  ids: z.array(z.int().min(1)).min(1).max(REPLAY_BATCH_MAX),
});
export type ReplayFileIds = z.infer<typeof replayFileIdsSchema>;

/** The match replays are sent for: refused once forfeited or annulled, which have no maps. */
export function replayMatch(
  db: Pick<Db, 'select'>,
  id: number,
): { ok: true; found: LeagueMatch } | { ok: false; error: 'not_found' | 'closed' } {
  const [found] = listLeagueMatches(db, { matchId: id });
  if (!found) return { ok: false, error: 'not_found' };
  if (found.status === 'forfeit' || found.status === 'void') return { ok: false, error: 'closed' };
  return { ok: true, found };
}

/**
 * The sides a player sends replays for (M-49: each team its own recording): the side's
 * officials and captain, and its players, those of the season roster and of the match's lineup.
 * League staff may send them too; the route asks Discord for that only when this is empty.
 */
export function replaySides(db: Pick<Db, 'select'>, playerId: number, found: LeagueMatch): Side[] {
  const held = matchRolesOf(db, playerId, found.seasonId);
  const rostered = db
    .select({ teamId: rosterEntry.teamId })
    .from(rosterEntry)
    .where(
      and(
        eq(rosterEntry.playerId, playerId),
        eq(rosterEntry.seasonId, found.seasonId),
        inArray(rosterEntry.role, ['player', 'sub']),
        isNull(rosterEntry.validTo),
      ),
    )
    .all()
    .map((row) => row.teamId);
  const listed = db
    .select({ side: lineup.side })
    .from(lineupMember)
    .innerJoin(lineup, eq(lineupMember.lineupId, lineup.id))
    .where(and(eq(lineup.matchId, found.id), eq(lineupMember.playerId, playerId)))
    .all()
    .map((row) => row.side);
  return (['a', 'b'] as const).filter(
    (side) =>
      actsForSide(held, found, side) ||
      rostered.includes(found[side].teamId) ||
      listed.includes(side),
  );
}

/** Why one file was not stored. */
export type ReplayRefusal =
  /** Not a round file (`.rec`). */
  | 'not_a_replay'
  /** The parser's JSON is not a round the normaliser can read. */
  | 'invalid'
  /** Not a Bomb round, or its start time cannot be read. */
  | 'not_bomb'
  /** Neither side has enough players of the match's teams (`replays.min_known_players`). */
  | 'not_this_match'
  /** The same file is already stored for another match. */
  | 'other_match';

export type ReplayOutcome =
  | { sha256: string; status: 'stored'; id: number }
  /** Already stored for this match, by this upload or an earlier one: its raw file may follow. */
  | { sha256: string; status: 'duplicate'; id: number; raw: RawStatus }
  | { sha256: string; status: 'refused'; error: ReplayRefusal };

export type SubmitReplaysReply =
  /** The browser's parser is not the server's build: it reloads the module and parses again. */
  { ok: false; error: 'parser_version'; current: string } | { ok: true; files: ReplayOutcome[] };

/** Whether one side of the round has enough known players of one of the match's teams. */
function playsInMatch(unit: R6Unit, teamOf: ReadonlyMap<string, 'A' | 'B'>, minKnown: number) {
  return ([0, 1] as const).some((side) => {
    const count = { A: 0, B: 0 };
    for (const player of unit.players) {
      const team = player.side === side && player.account ? teamOf.get(player.account) : undefined;
      if (team) count[team] += 1;
    }
    return count.A >= minKnown || count.B >= minKnown;
  });
}

/**
 * Stores each round the server can read for this match, and queues the match's stitch once.
 * The files are unverified until the worker has re-parsed their raw file.
 */
export function submitReplays(
  db: Db,
  found: LeagueMatch,
  input: Omit<ReplaySubmit, 'matchId'>,
  context: { playerId: number; parserVersion: string; now: number },
): SubmitReplaysReply {
  if (input.parser !== context.parserVersion) {
    return { ok: false, error: 'parser_version', current: context.parserVersion };
  }
  const rules = db
    .select({ ruleset: competition.rulesetJson, settings: season.settingsJson })
    .from(season)
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .where(eq(season.id, found.seasonId))
    .get();
  if (!rules) throw new Error(`Season ${String(found.seasonId)} has no competition`);
  const { teamOf } = matchAccounts(db, found);
  const { min_known_players: minKnown, trade_window_s: tradeWindowS } = rules.ruleset.replays;

  return db.transaction((tx) => {
    const files: ReplayOutcome[] = [];
    for (const file of input.files) {
      const refuse = (error: ReplayRefusal) => {
        files.push({ sha256: file.sha256, status: 'refused', error });
      };
      const stored = tx
        .select({ id: replayFile.id, matchId: replayFile.matchId, raw: replayFile.rawStatus })
        .from(replayFile)
        .where(eq(replayFile.sha256, file.sha256))
        .get();
      if (stored) {
        if (stored.matchId !== found.id) refuse('other_match');
        else
          files.push({ sha256: file.sha256, status: 'duplicate', id: stored.id, raw: stored.raw });
        continue;
      }
      // The name only: the first bytes are checked when the worker reads the raw file.
      if (!/\.rec$/i.test(file.name)) {
        refuse('not_a_replay');
        continue;
      }
      const read = normalizeR6(file.round, {
        parser: input.parser,
        fileSha256: file.sha256,
        tradeWindowS,
      });
      if (!read.ok) {
        refuse('invalid');
        continue;
      }
      const unit = read.unit;
      if (!r6ReplayRound(unit, 0, rules.settings.map_pool).ok) {
        refuse('not_bomb');
        continue;
      }
      if (!playsInMatch(unit, teamOf, minKnown)) {
        refuse('not_this_match');
        continue;
      }
      const recorder = unit.recorded_by ? teamOf.get(unit.recorded_by) : undefined;
      const row = tx
        .insert(replayFile)
        .values({
          matchId: found.id,
          uploaderPlayerId: context.playerId,
          title: 'r6',
          fileName: file.name,
          size: file.size,
          sha256: file.sha256,
          lobbyId: unit.lobby_id,
          unitNumber: unit.unit.number,
          recordedSide: recorder === undefined ? null : recorder === 'A' ? 'a' : 'b',
          parserVersion: input.parser,
          parsedJson: unit as unknown as Record<string, unknown>,
          createdAt: context.now,
        })
        .returning({ id: replayFile.id })
        .get();
      files.push({ sha256: file.sha256, status: 'stored', id: row.id });
    }
    if (files.some((file) => file.status === 'stored')) {
      enqueueJob(tx, { kind: 'stitch_game', payload: { matchId: found.id } }, context.now);
    }
    return { ok: true, files };
  });
}

/** Where a round's raw file is kept: one key per file, never shown to anyone. */
export const rawReplayKey = (matchId: number, sha: string) =>
  `replays/${String(matchId)}/${sha}.rec`;

export type SignOutcome =
  | ({ id: number } & SignedPut)
  /** `not_found`: no such file in this match; `stored`: its raw file is already kept. */
  | { id: number; error: 'not_found' | 'stored' };

type FileRow = typeof replayFile.$inferSelect;

function filesOf(db: Pick<Db, 'select'>, found: LeagueMatch, ids: readonly number[]) {
  const rows = db
    .select()
    .from(replayFile)
    .where(and(eq(replayFile.matchId, found.id), inArray(replayFile.id, [...ids])))
    .all();
  return new Map<number, FileRow>(rows.map((row) => [row.id, row]));
}

/** One upload link per file still to send: its exact key, size and type, for a short time. */
export async function signReplayUploads(
  db: Db,
  objects: ObjectStore,
  found: LeagueMatch,
  ids: readonly number[],
): Promise<SignOutcome[]> {
  const rows = filesOf(db, found, ids);
  const outcomes: SignOutcome[] = [];
  for (const id of new Set(ids)) {
    const row = rows.get(id);
    if (!row) {
      outcomes.push({ id, error: 'not_found' });
      continue;
    }
    if (row.rawStatus === 'stored' || row.rawStatus === 'deleted') {
      outcomes.push({ id, error: 'stored' });
      continue;
    }
    const signed = await objects.signPut(rawReplayKey(found.id, row.sha256), {
      size: row.size,
      contentType: RAW_REPLAY_TYPE,
      expiresInS: RAW_UPLOAD_EXPIRY_S,
    });
    db.update(replayFile)
      .set({ rawStatus: 'uploading' })
      .where(and(eq(replayFile.id, id), eq(replayFile.rawStatus, 'none')))
      .run();
    outcomes.push({ id, ...signed });
  }
  return outcomes;
}

export type StoredOutcome =
  /** Kept, and its verification queued (once). */
  | { id: number; status: 'stored' }
  /** `missing`: nothing of the file's size under its key yet. */
  | { id: number; status: 'not_found' | 'missing' };

/**
 * The browser says these raw files are up: each one whose object has the size declared is
 * marked stored, and the worker re-parses it (`verify_replay`).
 */
export async function markReplaysStored(
  db: Db,
  objects: ObjectStore,
  found: LeagueMatch,
  ids: readonly number[],
  now: number,
): Promise<StoredOutcome[]> {
  const rows = filesOf(db, found, ids);
  const outcomes: StoredOutcome[] = [];
  for (const id of new Set(ids)) {
    const row = rows.get(id);
    if (!row || row.rawStatus === 'deleted') {
      outcomes.push({ id, status: 'not_found' });
      continue;
    }
    if (row.rawStatus === 'stored') {
      outcomes.push({ id, status: 'stored' });
      continue;
    }
    const key = rawReplayKey(found.id, row.sha256);
    if ((await objects.size(key)) !== row.size) {
      outcomes.push({ id, status: 'missing' });
      continue;
    }
    db.transaction((tx) => {
      tx.update(replayFile)
        .set({ rawStatus: 'stored', rawKey: key })
        .where(eq(replayFile.id, id))
        .run();
      enqueueJob(tx, { kind: 'verify_replay', payload: { fileId: id } }, now);
    });
    outcomes.push({ id, status: 'stored' });
  }
  return outcomes;
}

/** What the uploader page needs of the match, for the island (`@ligo/uploader` config). */
export interface UploaderSetup {
  tradeWindowS: number;
  minKnown: number;
  /** Folders recorded in this span are picked by default: around the match, or its week. */
  window: { start: number; end: number };
  teams: { a: { name: string; tag: string }; b: { name: string; tag: string } };
  /** Each known R6 account as its SHA-256 (never the profile ID itself, M-42). */
  known: { hash: string; side: Side; name: string }[];
}

const HOUR = 3_600_000;

export function uploaderSetup(db: Pick<Db, 'select'>, found: LeagueMatch): UploaderSetup {
  const rules = db
    .select({ ruleset: competition.rulesetJson })
    .from(season)
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .where(eq(season.id, found.seasonId))
    .get();
  if (!rules) throw new Error(`Season ${String(found.seasonId)} has no competition`);
  const { teamOf, playerOf } = matchAccounts(db, found);
  const ids = [...new Set(playerOf.values())];
  const names = new Map(
    ids.length === 0
      ? []
      : db
          .select({ id: schema.player.id, name: schema.player.displayName })
          .from(schema.player)
          .where(inArray(schema.player.id, ids))
          .all()
          .map((row) => [row.id, row.name]),
  );
  return {
    tradeWindowS: rules.ruleset.replays.trade_window_s,
    minKnown: rules.ruleset.replays.min_known_players,
    // A lobby starts a little before the time set, and a re-hosted best-of-five ends hours later.
    window:
      found.scheduledAt === null
        ? found.window
        : { start: found.scheduledAt - 2 * HOUR, end: found.scheduledAt + 8 * HOUR },
    teams: {
      a: { name: found.a.name, tag: found.a.tag },
      b: { name: found.b.name, tag: found.b.tag },
    },
    known: [...teamOf.entries()].map(([account, team]) => ({
      hash: createHash('sha256').update(account.toLowerCase()).digest('hex'),
      side: team === 'A' ? 'a' : 'b',
      name: names.get(playerOf.get(account) ?? 0) ?? '?',
    })),
  };
}
