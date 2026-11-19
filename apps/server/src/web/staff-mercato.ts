import { zonedDateTime } from '@ligo/core';
import type { Context, Hono } from 'hono';
import { announceWindowClosed, announceWindowOpened } from '../discord/mercato-posts.ts';
import {
  closeMercatoWindow,
  mercatoOverview,
  openMercatoWindow,
} from '../services/mercato-windows.ts';
import type { Env } from './app.ts';
import {
  isMercatoError,
  MERCATO_DONE,
  staffMercatoPage,
  type LeagueMercato,
  type MercatoFlash,
} from './pages/staff-mercato.ts';
import type { RouteKit } from './route-kit.ts';
import { staffCompetitions, webActor } from './roles.ts';

// `/staff/mercato` (phase 3f-10; design doc section 7, O-35): league staff open a mercato window
// for the season under way, with its limit and block, and may close it early. The bot announces
// both in the league's `#mercato` channel. Staff is asked of the competition's Discord server on
// every request and checked again by the service.

const ROW_ID = /^[1-9]\d{0,9}$/;
const ACTIONS = ['open', 'close'] as const;
const field = (form: Record<string, unknown>, name: string) =>
  typeof form[name] === 'string' ? form[name].trim() : '';

function flashOf(c: Context<Env>): MercatoFlash {
  const done = MERCATO_DONE.find((entry) => entry === c.req.query('done'));
  if (done) return { done };
  const error = c.req.query('error');
  return isMercatoError(error) ? { error } : null;
}

export function staffMercatoRoutes(app: Hono<Env>, kit: RouteKit): void {
  const { deps, render, notFound, forbidden, guard } = kit;
  const { db, locale } = deps;
  const discord = { gateway: deps.gateway, locale };

  app.get('/staff/mercato', async (c) => {
    if (!deps.login) return notFound(c);
    const viewer = c.get('viewer');
    if (!viewer) return c.redirect('/auth/login?next=/staff/mercato', 303);
    const now = deps.now();
    const competitions = await staffCompetitions(db, deps.roles, viewer, now);
    if (competitions.length === 0) return forbidden(c);
    const leagues: LeagueMercato[] = [];
    for (const competition of competitions) {
      const actor = await webActor(db, deps.roles, viewer, competition.id, now);
      const overview = actor ? mercatoOverview(db, actor, now) : null;
      if (overview?.ok) {
        leagues.push({ competitionId: competition.id, name: competition.name, overview });
      }
    }
    // Staff only: no shared cache keeps it.
    c.header('Cache-Control', 'no-store');
    return render(c, staffMercatoPage(locale, { leagues, csrf: viewer.csrf, flash: flashOf(c) }));
  });

  app.post('/staff/mercato/:competition/:action', async (c) => {
    const what = ACTIONS.find((entry) => entry === c.req.param('action'));
    const competition = c.req.param('competition');
    if (!what || !ROW_ID.test(competition)) return notFound(c);
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const now = deps.now();
    const actor = await webActor(db, deps.roles, viewer, Number(competition), now);
    if (!actor) return forbidden(c);
    const back = (query: string) => c.redirect(`/staff/mercato?${query}#c${competition}`, 303);
    const refused = (error: string) =>
      error === 'not_staff' || error === 'not_linked'
        ? forbidden(c)
        : back(`error=${isMercatoError(error) ? error : 'window_not_found'}`);

    if (what === 'close') {
      const windowId = field(form, 'window');
      const reply = closeMercatoWindow(
        db,
        actor,
        ROW_ID.test(windowId) ? Number(windowId) : -1,
        now,
      );
      if (!reply.ok) return refused(reply.error);
      await announceWindowClosed(discord, reply);
      return back('done=closed');
    }

    const overview = mercatoOverview(db, actor, now);
    if (!overview.ok) return refused(overview.error);
    const zone = overview.timeZone;
    const opens = zonedDateTime(field(form, 'opens_date'), field(form, 'opens_time'), zone);
    if (!opens.ok) return refused(opens.error);
    const closes = zonedDateTime(field(form, 'closes_date'), field(form, 'closes_time'), zone);
    if (!closes.ok) return refused(closes.error);
    const limit = field(form, 'limit');
    const lock = field(form, 'lock_hours');
    if (limit !== '' && !/^\d{1,3}$/.test(limit)) return refused('invalid_limit');
    if (!/^\d{1,4}$/.test(lock)) return refused('invalid_lock');
    const reply = openMercatoWindow(
      db,
      actor,
      {
        opensAt: opens.at,
        closesAt: closes.at,
        maxMovesPerTeam: limit === '' ? null : Number(limit),
        lockHours: Number(lock),
      },
      now,
    );
    if (!reply.ok) return refused(reply.error);
    await announceWindowOpened(discord, reply);
    return back('done=opened');
  });
}
