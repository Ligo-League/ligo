import type { Context, Hono } from 'hono';
import { openCompetition } from '../services/admin-competitions.ts';
import { syncLeague } from '../services/reconciler.ts';
import type { Env, Viewer } from './app.ts';
import { syncPageView } from './pages/admin-sync.ts';
import type { RouteKit } from './route-kit.ts';
import { staffCompetitions } from './roles.ts';

// The league server's sync (phase 4; design doc section 6), for the organisation's owner and the
// competition's staff: `/admin/:org/:comp/discord/sync` shows a dry run; its POST syncs now.

const COUNT = /^\d{1,6}$/;

export function adminSyncRoutes(app: Hono<Env>, kit: RouteKit): void {
  const { deps, render, notFound, forbidden, guard } = kit;
  const { db, locale } = deps;
  const access = async (c: Context<Env>, viewer: Viewer) =>
    openCompetition(
      db,
      { playerId: viewer.playerId, discordUserId: viewer.discordUserId },
      c.req.param('org') ?? '',
      c.req.param('comp') ?? '',
      (await staffCompetitions(db, deps.roles, viewer, deps.now())).map((entry) => entry.id),
    );

  app.get('/admin/:org/:comp/discord/sync', async (c) => {
    const viewer = c.get('viewer');
    if (!deps.login) return notFound(c);
    if (!viewer) return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);
    const found = await access(c, viewer);
    if (!found.ok) return found.error === 'not_found' ? notFound(c) : forbidden(c);
    const preview = await syncLeague(db, deps.gateway, found.row.id, {
      dryRun: true,
      now: deps.now(),
      actorPlayerId: viewer.playerId,
    });
    const applied = c.req.query('applied') ?? '';
    const failed = c.req.query('failed') ?? '';
    c.header('Cache-Control', 'private, no-store');
    return render(
      c,
      syncPageView(locale, {
        org: found.orgRow,
        competition: found.row,
        preview,
        done:
          COUNT.test(applied) && COUNT.test(failed)
            ? { applied: Number(applied), failed: Number(failed) }
            : null,
        csrf: viewer.csrf,
      }),
    );
  });

  app.post('/admin/:org/:comp/discord/sync', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer } = guarded;
    const found = await access(c, viewer);
    if (!found.ok) return found.error === 'not_found' ? notFound(c) : forbidden(c);
    const reply = await syncLeague(db, deps.gateway, found.row.id, {
      dryRun: false,
      now: deps.now(),
      actorPlayerId: viewer.playerId,
    });
    const page = `/admin/${found.orgRow.slug}/${found.row.slug}/discord/sync`;
    // A refusal (not managed, Discord down) shows on the page, which runs its dry run again.
    if (!reply.ok) return c.redirect(page, 303);
    return c.redirect(
      `${page}?applied=${String(reply.applied)}&failed=${String(reply.failures.length)}`,
      303,
    );
  });
}
