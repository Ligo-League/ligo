import { randomBytes } from 'node:crypto';
import { actsForSide, mossGaps, mossSideOf, type MossGap, type MossSides } from '@ligo/core';
import { listLeagueMatches, schema, teamMapSchema, type Db, type LeagueMatch } from '@ligo/db';
import type { ObjectStore, SignedPut } from '@ligo/storage';
import { R6_PLAYERS_PER_SIDE } from '@ligo/titles';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import * as z from 'zod';
import { matchRolesOf, requireStaff, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';

// MOSS files (design doc sections 4 and 8; M-47, maintainer 20 and 24 November 2026). Who played
// comes from the match's replays: the players each side's recordings show, by game account.
// Each sends one file, uploaded by them or by an official of their team, and nobody else may:
// no stand-in file for someone who did not play. Files go straight to storage through a signed
// link, are staff-only, and are kept only in case of suspected cheating.

const {
  auditLog,
  competition,
  evidence,
  gameAccount,
  match,
  player,
  replayFile,
  replaySegment,
  season,
} = schema;

/** Whether staff hold the match's MOSS files for an investigation: none is deleted meanwhile. */
export function isHeld(db: Pick<Db, 'select'>, matchId: number): boolean {
  const row = db.select({ at: match.mossHeldAt }).from(match).where(eq(match.id, matchId)).get();
  return row?.at !== null && row?.at !== undefined;
}

type Side = 'a' | 'b';

/** A MOSS capture is a few screens an hour: a long series stays far below this. */
export const MOSS_MAX_BYTES = 500 * 1024 * 1024;
export const MOSS_UPLOAD_EXPIRY_S = 1800;
const MOSS_TYPE = 'application/octet-stream';
/** `evidence/<match>/moss/<player>-<random>.<extension>`: one key per upload, never guessed. */
const MOSS_KEY = /^evidence\/([1-9]\d{0,9})\/moss\/([1-9]\d{0,9})-[0-9a-f]{32}\.[a-z0-9]{1,8}$/;

const unitPlayers = z.object({
  players: z.array(
    z.object({
      account: z.string().nullable(),
      name: z.string(),
      side: z.union([z.literal(0), z.literal(1)]),
    }),
  ),
});

/**
 * The players each side's replays show: the lobbies stitching placed in a game with their teams
 * (an ignored or unplaced lobby says nothing), every recording of them.
 */
export function mossSides(db: Pick<Db, 'select'>, found: LeagueMatch): MossSides {
  const segments = db
    .select({ lobbyId: replaySegment.lobbyId, teamMap: replaySegment.teamMapJson })
    .from(replaySegment)
    .where(and(eq(replaySegment.matchId, found.id), eq(replaySegment.status, 'ok')))
    .all();
  const teamMaps = new Map(
    segments.flatMap((s) => {
      const map = teamMapSchema.safeParse(s.teamMap);
      return map.success ? [[s.lobbyId, map.data] as const] : [];
    }),
  );
  const seen: Record<Side, Map<string, string>> = { a: new Map(), b: new Map() };
  if (teamMaps.size > 0) {
    const files = db
      .select({ lobbyId: replayFile.lobbyId, parsed: replayFile.parsedJson })
      .from(replayFile)
      .where(
        and(eq(replayFile.matchId, found.id), inArray(replayFile.lobbyId, [...teamMaps.keys()])),
      )
      .all();
    for (const file of files) {
      const map = teamMaps.get(file.lobbyId);
      const unit = unitPlayers.safeParse(file.parsed);
      if (!map || !unit.success) continue;
      for (const { account, name, side } of unit.data.players) {
        // A build that hides profile IDs names nobody: its players cannot be told apart.
        if (account !== null) seen[map[side]].set(account.toLowerCase(), name);
      }
    }
  }
  const accounts = [...seen.a.keys(), ...seen.b.keys()];
  const known = new Map(
    accounts.length === 0
      ? []
      : db
          .select({
            account: gameAccount.externalId,
            playerId: player.id,
            name: player.displayName,
          })
          .from(gameAccount)
          .innerJoin(player, eq(gameAccount.playerId, player.id))
          .where(and(eq(gameAccount.title, 'r6'), inArray(gameAccount.externalId, accounts)))
          .all()
          .flatMap((row) => (row.account === null ? [] : [[row.account, row] as const])),
  );
  const withFile = new Set(mossFiles(db, found.id).map((row) => row.playerId));
  const sideOf = (side: Side) =>
    [...seen[side].entries()]
      .map(([account, replayName]) => {
        const ligo = known.get(account);
        return {
          account,
          name: ligo?.name ?? replayName,
          playerId: ligo?.playerId ?? null,
          hasFile: ligo !== undefined && withFile.has(ligo.playerId),
        };
      })
      .sort((x, y) => x.name.localeCompare(y.name));
  return { a: sideOf('a'), b: sideOf('b') };
}

/** The match's MOSS files still kept: the latest of each player. */
export function mossFiles(db: Pick<Db, 'select'>, matchId: number) {
  const rows = db
    .select()
    .from(evidence)
    .where(
      and(eq(evidence.matchId, matchId), eq(evidence.kind, 'moss'), isNull(evidence.deletedAt)),
    )
    .orderBy(desc(evidence.at), desc(evidence.id))
    .all();
  const latest = new Map<number, (typeof rows)[number]>();
  for (const row of rows)
    if (row.playerId !== null && !latest.has(row.playerId)) latest.set(row.playerId, row);
  return [...latest.values()];
}

export interface MossCheck {
  /** `moss.required`: off, the files are welcome but block nothing. */
  required: boolean;
  sides: MossSides;
  gaps: MossGap[];
}

export function mossCheck(db: Pick<Db, 'select'>, found: LeagueMatch): MossCheck {
  const rules = db
    .select({ ruleset: competition.rulesetJson })
    .from(season)
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .where(eq(season.id, found.seasonId))
    .get();
  const sides = mossSides(db, found);
  return {
    required: rules?.ruleset.moss.required ?? false,
    sides,
    gaps: mossGaps({ sides, teamSize: R6_PLAYERS_PER_SIDE }),
  };
}

/**
 * The players whose file this person may send: their own, when the replays show them, and as an
 * official or captain of a side, its players. Staff may send anyone's.
 */
export function mossTargets(
  db: Pick<Db, 'select'>,
  uploaderId: number,
  found: LeagueMatch,
  staff: boolean,
): { playerId: number; name: string; side: Side; hasFile: boolean }[] {
  const sides = mossSides(db, found);
  const held = matchRolesOf(db, uploaderId, found.seasonId);
  return (['a', 'b'] as const).flatMap((side) =>
    sides[side].flatMap((p) =>
      p.playerId !== null && (staff || p.playerId === uploaderId || actsForSide(held, found, side))
        ? [{ playerId: p.playerId, name: p.name, side, hasFile: p.hasFile }]
        : [],
    ),
  );
}

export type MossUploadError = 'not_played' | 'not_allowed' | 'too_large' | 'empty' | 'bad_key';

const extensionOf = (name: string) => {
  const found = /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase();
  return found ?? 'bin';
};

/** Who may send this player's file, and the side the replays show them on. */
function checkTarget(
  db: Pick<Db, 'select'>,
  found: LeagueMatch,
  input: { uploaderId: number; staff: boolean; playerId: number },
): { ok: true; side: Side } | { ok: false; error: MossUploadError } {
  const side = mossSideOf(mossSides(db, found), input.playerId);
  if (side === null) return { ok: false, error: 'not_played' };
  const mayAct =
    input.staff ||
    input.playerId === input.uploaderId ||
    actsForSide(matchRolesOf(db, input.uploaderId, found.seasonId), found, side);
  return mayAct ? { ok: true, side } : { ok: false, error: 'not_allowed' };
}

/** A link for one MOSS file of a player who played, to a key made for this upload only. */
export async function signMossUpload(
  db: Pick<Db, 'select'>,
  objects: ObjectStore,
  found: LeagueMatch,
  input: { uploaderId: number; staff: boolean; playerId: number; name: string; size: number },
): Promise<({ ok: true; key: string } & SignedPut) | { ok: false; error: MossUploadError }> {
  if (input.size <= 0) return { ok: false, error: 'empty' };
  if (input.size > MOSS_MAX_BYTES) return { ok: false, error: 'too_large' };
  const target = checkTarget(db, found, input);
  if (!target.ok) return target;
  const key = `evidence/${String(found.id)}/moss/${String(input.playerId)}-${randomBytes(16).toString('hex')}.${extensionOf(input.name)}`;
  const signed = await objects.signPut(key, {
    size: input.size,
    contentType: MOSS_TYPE,
    expiresInS: MOSS_UPLOAD_EXPIRY_S,
  });
  return { ok: true, key, ...signed };
}

/**
 * The browser says the file is up: kept as the player's MOSS file, staff-only. A file sent again
 * replaces the earlier one, which is deleted, unless staff hold the match's files.
 */
export async function storeMoss(
  db: Db,
  objects: ObjectStore,
  found: LeagueMatch,
  input: { uploaderId: number; staff: boolean; playerId: number; key: string },
  now: number,
): Promise<{ ok: true; evidenceId: number } | { ok: false; error: MossUploadError | 'missing' }> {
  const parts = MOSS_KEY.exec(input.key);
  if (Number(parts?.[1]) !== found.id || Number(parts?.[2]) !== input.playerId) {
    return { ok: false, error: 'bad_key' };
  }
  const target = checkTarget(db, found, input);
  if (!target.ok) return target;
  const size = await objects.size(input.key);
  if (size === null || size === 0 || size > MOSS_MAX_BYTES) return { ok: false, error: 'missing' };
  const held = isHeld(db, found.id);
  const replaced = mossFiles(db, found.id).filter((row) => row.playerId === input.playerId);
  const evidenceId = db.transaction((tx) => {
    const existing = tx
      .select({ id: evidence.id })
      .from(evidence)
      .where(eq(evidence.objectKey, input.key))
      .get();
    if (existing) return existing.id;
    if (!held) {
      for (const row of replaced) {
        tx.update(evidence).set({ deletedAt: now }).where(eq(evidence.id, row.id)).run();
      }
    }
    return tx
      .insert(evidence)
      .values({
        matchId: found.id,
        kind: 'moss',
        objectKey: input.key,
        uploadedBy: input.uploaderId,
        playerId: input.playerId,
        visibility: 'staff',
        at: now,
      })
      .returning({ id: evidence.id })
      .get().id;
  });
  if (!held) {
    for (const row of replaced) {
      if (row.objectKey && row.objectKey !== input.key) {
        // The row says it is gone; a file left over costs space, never privacy.
        await objects.delete(row.objectKey).catch(() => undefined);
      }
    }
  }
  return { ok: true, evidenceId };
}

// ---------------------------------------------------------------------------------------------
// Staff: open a file, hold the match's files during an investigation, release them

export type MossStaffError =
  'not_linked' | 'not_staff' | 'not_found' | 'reason_required' | 'already_held' | 'not_held';

/** A MOSS file for staff of its match's league only, never public: where it is, and its name. */
export function openMoss(
  db: Pick<Db, 'select'>,
  actor: Actor,
  evidenceId: number,
): { ok: true; key: string; fileName: string } | { ok: false; error: MossStaffError } {
  const row = db.select().from(evidence).where(eq(evidence.id, evidenceId)).get();
  if (row?.kind !== 'moss') return { ok: false, error: 'not_found' };
  const staff = requireStaff(db, actor, { matchId: row.matchId });
  if (!staff.ok) return staff;
  const [found] = listLeagueMatches(db, { matchId: row.matchId });
  if (found?.competitionId !== staff.league.competition.id || !row.objectKey || row.deletedAt) {
    return { ok: false, error: 'not_found' };
  }
  const name = db
    .select({ slug: player.slug })
    .from(player)
    .where(eq(player.id, row.playerId ?? 0))
    .get()?.slug;
  const extension = /\.([a-z0-9]{1,8})$/.exec(row.objectKey)?.[1] ?? 'bin';
  return {
    ok: true,
    key: row.objectKey,
    fileName: `moss-match-${String(row.matchId)}-${name ?? 'player'}.${extension}`,
  };
}

/**
 * Staff hold, or release, the match's MOSS files (M-47): held files are deleted neither at the
 * season's close nor after the retention, until staff release them. With a reason to hold;
 * audited both ways.
 */
export function setMossHold(
  db: Db,
  actor: Actor,
  request: { matchId: number; hold: boolean; reason: string },
  now: number,
): { ok: true } | { ok: false; error: MossStaffError } {
  const staff = requireStaff(db, actor, { matchId: request.matchId });
  if (!staff.ok) return staff;
  const { league } = staff;
  const reason = request.reason.trim().slice(0, 500);
  if (request.hold && reason === '') return { ok: false, error: 'reason_required' };
  return db.transaction((tx) => {
    const [found] = listLeagueMatches(tx, { matchId: request.matchId });
    if (found?.competitionId !== league.competition.id) return { ok: false, error: 'not_found' };
    const held = isHeld(tx, found.id);
    if (request.hold && held) return { ok: false, error: 'already_held' };
    if (!request.hold && !held) return { ok: false, error: 'not_held' };
    const staffPlayer = ensurePlayer(
      tx,
      { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
      now,
    );
    tx.update(match)
      .set(
        request.hold
          ? { mossHeldAt: now, mossHeldBy: staffPlayer.id, mossHoldReason: reason }
          : { mossHeldAt: null, mossHeldBy: null, mossHoldReason: null },
      )
      .where(eq(match.id, found.id))
      .run();
    tx.insert(auditLog)
      .values({
        actorPlayerId: staffPlayer.id,
        actorKind: 'user',
        action: request.hold ? 'match.moss_hold' : 'match.moss_release',
        entity: 'match',
        entityId: String(found.id),
        beforeJson: { held },
        afterJson: { held: request.hold, ...(reason ? { reason } : {}) },
        at: now,
      })
      .run();
    return { ok: true };
  });
}

/** What staff see of a match's MOSS files: who owes one, the files, and the hold. */
export function mossOverview(db: Pick<Db, 'select'>, found: LeagueMatch) {
  const check = mossCheck(db, found);
  const files = new Map(mossFiles(db, found.id).map((row) => [row.playerId, row.id]));
  const hold = db
    .select({ at: match.mossHeldAt, reason: match.mossHoldReason })
    .from(match)
    .where(eq(match.id, found.id))
    .get();
  const rows = (side: Side) =>
    check.sides[side].map((p) => ({
      name: p.name,
      known: p.playerId !== null,
      evidenceId: p.playerId === null ? null : (files.get(p.playerId) ?? null),
    }));
  return {
    required: check.required,
    gaps: check.gaps,
    sides: { a: rows('a'), b: rows('b') },
    held: hold?.at ? { at: hold.at, reason: hold.reason ?? '' } : null,
  };
}
export type MossOverview = ReturnType<typeof mossOverview>;
