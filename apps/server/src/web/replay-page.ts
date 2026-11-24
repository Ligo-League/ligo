import type { LeagueMatch } from '@ligo/db';
import { UPLOADER_MESSAGES, type UploaderConfig } from '@ligo/uploader';
import type { Context, Hono } from 'hono';
import { catalogs } from '../i18n/index.ts';
import { requireStaff } from '../services/permissions.ts';
import { MOSS_MAX_BYTES, mossCheck, mossTargets } from '../services/moss.ts';
import { replayMatch, replaySides, uploaderSetup } from '../services/replay-uploads.ts';
import type { Env, Viewer } from './app.ts';
import { contentSecurityPolicy } from './csp.ts';
import type { Html } from './layout.ts';
import { replaysLink, replaysPage } from './pages/replays.ts';
import { webActor } from './roles.ts';
import type { RouteKit } from './route-kit.ts';

// The replay uploader's page (design doc section 8, phase 5-9), for the same people as the
// replay API: a side's players, officials and captain, and league staff. It also serves the
// island's browser files, made when the server started (`uploader-bundle.ts`).

const ROW_ID = /^[1-9]\d{0,9}$/;
const SCRIPT = 'text/javascript; charset=utf-8';
// The bundles change with a release; the parser's file carries its version in its name.
const STATIC_CACHE = 'public, max-age=3600';
const IMMUTABLE = 'public, max-age=31536000, immutable';

export function replayPageRoutes(
  app: Hono<Env>,
  kit: RouteKit,
): { link: (c: Context<Env>, matchId: number) => Promise<Html | string> } {
  const { deps, render, notFound, forbidden } = kit;
  const { db, locale } = deps;

  /**
   * Whether the viewer sends this match's replays, as one of its teams or as league staff:
   * re-read from the database, and Discord for staff. Null when neither.
   */
  const access = async (viewer: Viewer, found: LeagueMatch) => {
    if (replaySides(db, viewer.playerId, found).length > 0) return { staff: false };
    const actor = await webActor(db, deps.roles, viewer, found.competitionId, deps.now());
    return actor !== null && requireStaff(db, actor, { matchId: found.id }).ok
      ? { staff: true }
      : null;
  };

  const link = async (c: Context<Env>, matchId: number): Promise<Html | string> => {
    const viewer = c.get('viewer');
    const match = replayMatch(db, matchId);
    if (!viewer || !match.ok || !deps.uploader || !deps.replays) return '';
    return (await access(viewer, match.found)) ? replaysLink(locale, matchId) : '';
  };

  app.get('/matches/:id/replays', async (c) => {
    if (!deps.login) return notFound(c);
    const viewer = c.get('viewer');
    if (!viewer) return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);
    const id = c.req.param('id');
    const match = ROW_ID.test(id) ? replayMatch(db, Number(id)) : null;
    if (!match?.ok) return notFound(c);
    const { found } = match;
    const allowed = await access(viewer, found);
    if (!allowed) return forbidden(c);

    const { uploader, replays } = deps;
    const config: UploaderConfig | null =
      uploader && replays
        ? {
            matchId: found.id,
            csrf: viewer.csrf,
            matchUrl: `/matches/${String(found.id)}`,
            parser: {
              version: uploader.version,
              wasm: `/parsers/${uploader.wasm.name}`,
              worker: '/static/parser-worker.js',
            },
            ...uploaderSetup(db, found),
            moss: mossCheck(db, found).required
              ? {
                  maxBytes: MOSS_MAX_BYTES,
                  players: mossTargets(db, viewer.playerId, found, allowed.staff),
                }
              : null,
            messages: Object.fromEntries(
              // The island fills each message's `{name}` parts itself.
              UPLOADER_MESSAGES.map((key) => [key, catalogs[locale][`web.replays.ui.${key}`]]),
            ) as UploaderConfig['messages'],
          }
        : null;
    // The page holds the session's token: no cache keeps it.
    c.header('Cache-Control', 'private, no-store');
    c.header(
      'Content-Security-Policy',
      contentSecurityPolicy({
        wasm: true,
        connect: replays?.uploadOrigin ? [replays.uploadOrigin] : [],
      }),
    );
    return render(
      c,
      replaysPage(locale, { id: found.id, a: found.a.name, b: found.b.name }, config),
    );
  });

  app.get('/static/uploader.js', (c) =>
    deps.uploader
      ? c.body(deps.uploader.island, 200, { 'Content-Type': SCRIPT, 'Cache-Control': STATIC_CACHE })
      : notFound(c),
  );
  app.get('/static/parser-worker.js', (c) => {
    if (!deps.uploader) return notFound(c);
    // A worker runs under its own script's policy: the parser is WebAssembly.
    c.header('Content-Security-Policy', contentSecurityPolicy({ wasm: true }));
    return c.body(deps.uploader.worker, 200, {
      'Content-Type': SCRIPT,
      'Cache-Control': STATIC_CACHE,
    });
  });
  app.get('/parsers/:file', (c) => {
    const wasm = deps.uploader?.wasm;
    if (!wasm || c.req.param('file') !== wasm.name) return notFound(c);
    return c.body(new Uint8Array(wasm.bytes), 200, {
      'Content-Type': 'application/wasm',
      'Cache-Control': IMMUTABLE,
    });
  });

  return { link };
}
