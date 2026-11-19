import { listLeagueMatches, type LeagueMatch } from '@ligo/db';
import type { Context, Hono } from 'hono';
import {
  checkSheet,
  confirmSheet,
  saveSheet,
  statGrid,
  type SheetRowInput,
} from '../services/stat-sheets.ts';
import type { Env, Viewer } from './app.ts';
import type { Html } from './layout.ts';
import {
  checkList,
  isStatsError,
  STATS_DONE,
  statsLink,
  statsPageView,
  type StatsFlash,
  type StatsPageData,
} from './pages/match-stats.ts';
import type { RouteKit } from './route-kit.ts';
import { webActor } from './roles.ts';

// The manual stat grid on the website (design doc section 7; M-39): `/matches/:id/stats` for the
// match's teams and league staff, through the stat sheet service, which decides who may enter,
// confirm or correct each side. Every route asks who the viewer is again.

const ROW_ID = /^[1-9]\d{0,9}$/;
const GAME_N = /^[1-9]\d{0,1}$/;
/** A cell of the grid: `v.<player ID>.<metric>`. */
const CELL = /^v\.([1-9]\d{0,9})\.([a-z_]{1,32})$/;
/** More cells than any grid holds is not a grid. */
const MAX_CELLS = 400;

function flashOf(c: Context<Env>): StatsFlash {
  const done = STATS_DONE.find((entry) => entry === c.req.query('done'));
  if (done) return { done };
  const error = c.req.query('error');
  return isStatsError(error) ? { error } : null;
}

/** The grid's cells as typed, player by player; null when the form is not a grid. */
function rowsOf(form: Record<string, unknown>): SheetRowInput[] | null {
  const rows = new Map<number, Record<string, string>>();
  let cells = 0;
  for (const [name, value] of Object.entries(form)) {
    const cell = CELL.exec(name);
    if (!cell) continue;
    cells += 1;
    if (cells > MAX_CELLS || typeof value !== 'string' || value.length > 12) return null;
    const playerId = Number(cell[1]);
    const values = rows.get(playerId) ?? {};
    values[cell[2] ?? ''] = value;
    rows.set(playerId, values);
  }
  return [...rows].map(([playerId, values]) => ({ playerId, values }));
}

export function matchStatsRoutes(
  app: Hono<Env>,
  kit: RouteKit,
): { link: (c: Context<Env>, matchId: number) => Promise<Html | string> } {
  const { deps, render, notFound, forbidden, guard } = kit;
  const { db, locale } = deps;

  const matchOf = (c: Context<Env>): LeagueMatch | undefined => {
    const id = c.req.param('id') ?? '';
    return ROW_ID.test(id) ? listLeagueMatches(db, { matchId: Number(id) })[0] : undefined;
  };
  const actorOf = (viewer: Viewer, found: LeagueMatch) =>
    webActor(db, deps.roles, viewer, found.competitionId, deps.now());

  /** The link on the match page: for those the grid is open to, once there is a result. */
  const link = async (c: Context<Env>, matchId: number): Promise<Html | string> => {
    const viewer = c.get('viewer');
    const [found] = listLeagueMatches(db, { matchId });
    if (!viewer || !found || found.status === 'scheduled') return '';
    const actor = await actorOf(viewer, found);
    if (!actor) return '';
    const first = statGrid(db, actor, matchId, null, deps.now());
    if (!first.ok) return '';
    const warnings = first.games.flatMap(({ n }) => {
      const view = n === first.game.n ? first : statGrid(db, actor, matchId, n, deps.now());
      return view.ok ? view.warnings.map((warning) => ({ n, warning })) : [];
    });
    return statsLink(locale, matchId, first.match, warnings);
  };

  const page = async (
    c: Context<Env>,
    viewer: Viewer,
    found: LeagueMatch,
    n: number | null,
    extra: Pick<StatsPageData, 'flash' | 'typed'>,
  ) => {
    const actor = await actorOf(viewer, found);
    if (!actor) return notFound(c);
    const view = statGrid(db, actor, found.id, n, deps.now());
    if (!view.ok) return notFound(c);
    // Each side sees its own rights: kept by no shared cache.
    c.header('Cache-Control', 'private, no-store');
    return render(
      c,
      statsPageView(locale, { view, csrf: viewer.csrf, ...extra }),
      extra.typed ? 400 : 200,
    );
  };

  app.get('/matches/:id/stats', async (c) => {
    const viewer = c.get('viewer');
    if (!deps.login) return notFound(c);
    if (!viewer) return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);
    const found = matchOf(c);
    if (!found) return notFound(c);
    const game = c.req.query('game');
    const n = game !== undefined && GAME_N.test(game) ? Number(game) : null;
    return page(c, viewer, found, n, { flash: flashOf(c), typed: null });
  });

  /** The match, the game, the side and the actor of a POST, or the response refusing it. */
  const target = async (c: Context<Env>) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const found = matchOf(c);
    const n = c.req.param('n') ?? '';
    const side = c.req.param('side');
    if (!found || !GAME_N.test(n) || (side !== 'a' && side !== 'b')) return notFound(c);
    const actor = await actorOf(guarded.viewer, found);
    if (!actor) return forbidden(c);
    return { ...guarded, found, n: Number(n), side, actor } as const;
  };
  const back = (c: Context<Env>, matchId: number, n: number, query: string) =>
    c.redirect(`/matches/${String(matchId)}/stats?game=${String(n)}&${query}`, 303);

  // Asked by the grid as the user types: what is wrong with the side, nothing stored.
  app.post('/matches/:id/stats/:n/:side/check', async (c) => {
    const found = await target(c);
    if (found instanceof Response) return found;
    const rows = rowsOf(found.form);
    if (!rows) return notFound(c);
    const input = { matchId: found.found.id, n: found.n, side: found.side, rows };
    const reply = checkSheet(db, found.actor, input, deps.now());
    const view = statGrid(db, found.actor, found.found.id, found.n, deps.now());
    if (!reply.ok || !view.ok) return forbidden(c);
    c.header('Cache-Control', 'private, no-store');
    return c.html(checkList(locale, view, found.side, reply.check));
  });

  app.post('/matches/:id/stats/:n/:side', async (c) => {
    const found = await target(c);
    if (found instanceof Response) return found;
    const rows = rowsOf(found.form);
    if (!rows) return notFound(c);
    const reply = saveSheet(
      db,
      found.actor,
      { matchId: found.found.id, n: found.n, side: found.side, rows },
      deps.now(),
    );
    if (reply.ok) return back(c, found.found.id, found.n, `done=saved_${reply.enteredAs}`);
    if (reply.error === 'invalid' && reply.check) {
      return page(c, found.viewer, found.found, found.n, {
        flash: { error: 'invalid' },
        typed: {
          side: found.side,
          values: new Map(rows.map((row) => [row.playerId, { ...row.values }])),
          check: reply.check,
        },
      });
    }
    return back(c, found.found.id, found.n, `error=${reply.error}`);
  });

  app.post('/matches/:id/stats/:n/:side/confirm', async (c) => {
    const found = await target(c);
    if (found instanceof Response) return found;
    const reply = confirmSheet(
      db,
      found.actor,
      { matchId: found.found.id, n: found.n, side: found.side },
      deps.now(),
    );
    return back(c, found.found.id, found.n, reply.ok ? 'done=confirmed' : `error=${reply.error}`);
  });

  return { link };
}
