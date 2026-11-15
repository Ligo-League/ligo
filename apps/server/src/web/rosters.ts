import { findRoster } from '@ligo/db';
import type { Context, Hono } from 'hono';
import {
  joinRoster,
  removeFromRoster,
  rosterInviteFor,
  rosterJoinView,
  type RosterLink,
} from '../services/rosters.ts';
import type { Env } from './app.ts';
import { rosterJoinPage } from './pages/roster-join.ts';
import type { RouteKit } from './route-kit.ts';

// A roster's own players on the website (M-33): its invitation link, joining from it, leaving,
// and removal by its officials. Each POST is checked by `guard`, then by the services.

const ROW_ID = /^[1-9]\d{0,9}$/;
// A token is 43 base64url characters; anything else is no link.
const TOKEN = /^[\w-]{43}$/;

export function rosterRoutes(app: Hono<Env>, kit: RouteKit): void {
  const { deps, render, notFound, forbidden, guard } = kit;
  const { db, locale, login } = deps;

  const linkOf = (c: Context<Env>): RosterLink | null => {
    const id = c.req.param('id') ?? '';
    const token = c.req.param('token') ?? '';
    if (!login || !ROW_ID.test(id) || !TOKEN.test(token)) return null;
    return { inviteId: Number(id), token, secret: login.secret };
  };

  app.get('/invite/:id/:token', (c) => {
    if (!login) return notFound(c);
    // The address holds the link's secret: kept by no cache.
    c.header('Cache-Control', 'no-store');
    const viewer = c.get('viewer');
    if (!viewer) return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);
    const link = linkOf(c);
    const view = link ? rosterJoinView(db, viewer.playerId, link, deps.now()) : null;
    if (!view?.ok) return notFound(c);
    return render(c, rosterJoinPage(locale, view, { action: c.req.path, csrf: viewer.csrf }));
  });

  app.post('/invite/:id/:token', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const link = linkOf(c);
    if (!link) return notFound(c);
    const reply = joinRoster(db, guarded.viewer.playerId, link, deps.now());
    if (reply.ok) return c.redirect('/me?joined=1', 303);
    if (reply.error === 'invalid_link') return notFound(c);
    // The page says why, from the state as it is now.
    return c.redirect(c.req.path, 303);
  });

  app.post('/teams/:slug/manage/invite', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const roster = findRoster(db, { slug: c.req.param('slug') });
    if (!roster) return notFound(c);
    const renew = guarded.form.renew === '1';
    const reply = rosterInviteFor(db, guarded.viewer, roster.teamId, { renew }, deps.now());
    const base = `/teams/${roster.slug}/manage`;
    if (reply.ok) return c.redirect(`${base}?done=invite#players`, 303);
    if (reply.error === 'not_allowed') return forbidden(c);
    return c.redirect(`${base}?error=${reply.error}#players`, 303);
  });

  app.post('/teams/:slug/manage/players/:player/remove', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const roster = findRoster(db, { slug: c.req.param('slug') });
    const playerId = c.req.param('player');
    if (!roster || !ROW_ID.test(playerId)) return notFound(c);
    const reply = removeFromRoster(db, guarded.viewer, roster.teamId, Number(playerId), deps.now());
    const base = `/teams/${roster.slug}/manage`;
    if (reply.ok) return c.redirect(`${base}?done=player_removed#players`, 303);
    if (reply.error === 'not_allowed') return forbidden(c);
    return c.redirect(`${base}?error=${reply.error}#players`, 303);
  });

  // A player leaves a roster from their own page.
  app.post('/teams/:slug/roster/leave', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const roster = findRoster(db, { slug: c.req.param('slug') });
    if (!roster) return notFound(c);
    const { playerId } = guarded.viewer;
    const reply = removeFromRoster(db, { playerId }, roster.teamId, playerId, deps.now());
    if (reply.ok) return c.redirect('/me?left=1', 303);
    return c.redirect('/me?error=lineup_locked', 303);
  });
}
