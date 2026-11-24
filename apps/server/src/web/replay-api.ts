import type { LeagueMatch } from '@ligo/db';
import type { ObjectStore } from '@ligo/storage';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import * as z from 'zod';
import { signMossUpload, storeMoss, type MossUploadError } from '../services/moss.ts';
import { requireStaff } from '../services/permissions.ts';
import {
  markReplaysStored,
  replayFileIdsSchema,
  replayMatch,
  replaySides,
  replaySubmitSchema,
  signReplayUploads,
  submitReplays,
} from '../services/replay-uploads.ts';
import type { Env, Viewer } from './app.ts';
import { createRateLimiter, type RateCharge, type RateLimit } from './rate-limit.ts';
import { webActor } from './roles.ts';
import { checkCsrfToken } from './session.ts';
import type { RouteKit } from './route-kit.ts';

// The replay API (design doc section 8, upload flow 4 and 5), for the uploader page (5-9):
// - `POST /api/replays`: the parser's JSON of each round file; the server reads and stores them;
// - `POST /api/replays/sign`: one upload link per raw file;
// - `POST /api/replays/stored`: the raw files the browser has sent, checked and queued for
//   verification;
// - `POST /api/moss/sign` and `/api/moss/stored`: a player's MOSS file (M-47, 5-10).
// JSON in and out, from this site's pages only: the session's CSRF token comes in a header.
// Only a side's players, officials and captain, and league staff, send a match's replays. The
// links signed are never logged.

export interface ReplayApiDeps {
  /** Where raw files go: R2, or the disk behind the server's own upload route. */
  objects: ObjectStore;
  /** The parser build browsers must use; null when the server has none, which stops uploads. */
  parserVersion: string | null;
  /** Where the browser sends raw files when it is not this site (R2's address), for the CSP. */
  uploadOrigin: string | null;
}

/** Requests to the API per user, whatever they ask. */
const REQUESTS: RateLimit = { limit: 60, windowMs: 60_000 };
/**
 * Upload links signed per user and per match: a best-of-five with re-hosts is about 80 round
 * files per team, so a team sending its files twice stays under both.
 */
const SIGNED_PER_USER: RateLimit = { limit: 200, windowMs: 10 * 60_000 };
const SIGNED_PER_MATCH: RateLimit = { limit: 400, windowMs: 10 * 60_000 };
/** MOSS links per user: one file per player, a few sent again. */
const MOSS_PER_USER: RateLimit = { limit: 30, windowMs: 10 * 60_000 };
const mossSignSchema = z.strictObject({
  matchId: z
    .int()
    .min(1)
    .max(2 ** 31),
  playerId: z.int().min(1),
  name: z.string().min(1).max(255),
  size: z.int().min(0),
});
const mossStoredSchema = z.strictObject({
  matchId: z
    .int()
    .min(1)
    .max(2 ** 31),
  playerId: z.int().min(1),
  key: z.string().max(512),
});

/** Round JSON is 5 to 15 KB: a full batch stays well under this. */
const SUBMIT_MAX_BYTES = 2 * 1024 * 1024;
const IDS_MAX_BYTES = 16 * 1024;

type ApiError =
  | 'not_found'
  | 'forbidden'
  | 'login'
  | 'invalid'
  | 'too_large'
  | 'closed'
  | 'rate_limited'
  | 'unavailable'
  | 'storage'
  | MossUploadError
  | 'missing';

export function replayApiRoutes(app: Hono<Env>, kit: RouteKit): void {
  const { deps } = kit;
  const { db, login } = deps;
  const limiter = createRateLimiter();

  const fail = (
    c: Context<Env>,
    status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 503,
    error: ApiError,
  ) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ error }, status);
  };
  const limited = (c: Context<Env>, waitMs: number) => {
    c.header('Retry-After', String(Math.ceil(waitMs / 1000)));
    return fail(c, 429, 'rate_limited');
  };
  const limit = (bytes: number) =>
    bodyLimit({ maxSize: bytes, onError: (c) => fail(c as Context<Env>, 413, 'too_large') });

  /**
   * Every API request: from this site, logged in, with the session's token, within the user's
   * request allowance; then the body as the schema reads it, its match, and the right to send
   * that match's replays (re-read from the database, and staff roles from Discord).
   */
  async function open<Schema extends z.ZodType<{ matchId: number }>>(
    c: Context<Env>,
    schema: Schema,
  ): Promise<
    | {
        viewer: Viewer;
        body: z.infer<Schema>;
        found: LeagueMatch;
        replays: ReplayApiDeps;
        /** Let in as league staff, not as one of the match's teams. */
        staff: boolean;
      }
    | Response
  > {
    if (!login) return fail(c, 404, 'not_found');
    const origin = c.req.header('origin');
    const sameSite =
      origin === undefined
        ? c.req.header('sec-fetch-site') === 'same-origin'
        : origin === login.publicUrl.origin;
    if (!sameSite) return fail(c, 403, 'forbidden');
    const viewer = c.get('viewer');
    if (!viewer) return fail(c, 401, 'login');
    if (!checkCsrfToken(login, viewer.session, c.req.header('x-csrf-token'))) {
      return fail(c, 403, 'forbidden');
    }
    if (!/^application\/json(;|$)/i.test(c.req.header('content-type') ?? '')) {
      return fail(c, 415, 'invalid');
    }
    const wait = limiter.take(
      [{ key: `requests:${String(viewer.playerId)}`, count: 1, rule: REQUESTS }],
      deps.now(),
    );
    if (wait > 0) return limited(c, wait);
    if (!deps.replays) return fail(c, 503, 'unavailable');

    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return fail(c, 400, 'invalid');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return fail(c, 400, 'invalid');
    const match = replayMatch(db, parsed.data.matchId);
    if (!match.ok)
      return match.error === 'closed' ? fail(c, 409, 'closed') : fail(c, 404, 'not_found');
    const { found } = match;
    const staff = replaySides(db, viewer.playerId, found).length === 0;
    if (staff) {
      const actor = await webActor(db, deps.roles, viewer, found.competitionId, deps.now());
      if (!actor || !requireStaff(db, actor, { matchId: found.id }).ok) {
        return fail(c, 403, 'forbidden');
      }
    }
    return { viewer, body: parsed.data, found, replays: deps.replays, staff };
  }

  app.post('/api/replays', limit(SUBMIT_MAX_BYTES), async (c) => {
    const opened = await open(c, replaySubmitSchema);
    if (opened instanceof Response) return opened;
    const { viewer, body, found, replays } = opened;
    if (replays.parserVersion === null) return fail(c, 503, 'unavailable');
    const reply = submitReplays(db, found, body, {
      playerId: viewer.playerId,
      parserVersion: replays.parserVersion,
      now: deps.now(),
    });
    c.header('Cache-Control', 'no-store');
    return reply.ok ? c.json({ files: reply.files }) : c.json(reply, 409);
  });

  app.post('/api/replays/sign', limit(IDS_MAX_BYTES), async (c) => {
    const opened = await open(c, replayFileIdsSchema);
    if (opened instanceof Response) return opened;
    const { viewer, body, found, replays } = opened;
    const count = new Set(body.ids).size;
    const charges: RateCharge[] = [
      { key: `signed:user:${String(viewer.playerId)}`, count, rule: SIGNED_PER_USER },
      { key: `signed:match:${String(found.id)}`, count, rule: SIGNED_PER_MATCH },
    ];
    const wait = limiter.take(charges, deps.now());
    if (wait > 0) return limited(c, wait);
    try {
      const files = await signReplayUploads(db, replays.objects, found, body.ids);
      c.header('Cache-Control', 'no-store');
      return c.json({ files });
    } catch {
      // The links are secrets: the match alone is logged.
      deps.logger.error({ matchId: found.id }, 'Replay uploads could not be signed');
      return fail(c, 503, 'storage');
    }
  });

  app.post('/api/replays/stored', limit(IDS_MAX_BYTES), async (c) => {
    const opened = await open(c, replayFileIdsSchema);
    if (opened instanceof Response) return opened;
    const { body, found, replays } = opened;
    try {
      const files = await markReplaysStored(db, replays.objects, found, body.ids, deps.now());
      c.header('Cache-Control', 'no-store');
      return c.json({ files });
    } catch {
      deps.logger.error({ matchId: found.id }, 'Stored replays could not be checked');
      return fail(c, 503, 'storage');
    }
  });

  // MOSS files (M-47): one per player the replays show, sent by them or an official of their
  // side; the link is for a key made for this upload, the file staff-only once stored.
  const MOSS_STATUS = {
    not_played: 403,
    not_allowed: 403,
    too_large: 413,
    empty: 400,
    bad_key: 400,
    not_zip: 400,
    missing: 409,
  } as const satisfies Record<MossUploadError | 'missing', number>;

  app.post('/api/moss/sign', limit(IDS_MAX_BYTES), async (c) => {
    const opened = await open(c, mossSignSchema);
    if (opened instanceof Response) return opened;
    const { viewer, body, found, replays, staff } = opened;
    const wait = limiter.take(
      [{ key: `moss:user:${String(viewer.playerId)}`, count: 1, rule: MOSS_PER_USER }],
      deps.now(),
    );
    if (wait > 0) return limited(c, wait);
    try {
      const signed = await signMossUpload(db, replays.objects, found, {
        uploaderId: viewer.playerId,
        staff,
        playerId: body.playerId,
        name: body.name,
        size: body.size,
      });
      if (!signed.ok) return fail(c, MOSS_STATUS[signed.error], signed.error);
      c.header('Cache-Control', 'no-store');
      const { key, url, method, headers } = signed;
      return c.json({ key, url, method, headers });
    } catch {
      deps.logger.error({ matchId: found.id }, 'A MOSS upload could not be signed');
      return fail(c, 503, 'storage');
    }
  });

  app.post('/api/moss/stored', limit(IDS_MAX_BYTES), async (c) => {
    const opened = await open(c, mossStoredSchema);
    if (opened instanceof Response) return opened;
    const { viewer, body, found, replays, staff } = opened;
    try {
      const stored = await storeMoss(
        db,
        replays.objects,
        found,
        { uploaderId: viewer.playerId, staff, playerId: body.playerId, key: body.key },
        deps.now(),
      );
      if (!stored.ok) return fail(c, MOSS_STATUS[stored.error], stored.error);
      c.header('Cache-Control', 'no-store');
      return c.json({ stored: true });
    } catch {
      deps.logger.error({ matchId: found.id }, 'A MOSS file could not be checked');
      return fail(c, 503, 'storage');
    }
  });
}
