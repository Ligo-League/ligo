import { randomInt } from 'node:crypto';
import { findGuildLeague, listLeagueMatches, schema, type LeagueMatch } from '@ligo/db';
import { eq } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { postVeto, refreshVeto } from '../discord/veto-message.ts';
import { actsFor, matchRolesOf } from '../services/permissions.ts';
import { chooseVetoStep, readVeto, startVeto, vetoAudience } from '../services/veto.ts';
import type { Env, Viewer } from './app.ts';
import type { Html } from './layout.ts';
import {
  isVetoError,
  VETO_DONE,
  vetoLink,
  vetoMarker,
  vetoPageView,
  vetoSection,
  type VetoDone,
  type VetoFlash,
  type VetoSectionData,
} from './pages/veto.ts';
import type { RouteKit } from './route-kit.ts';
import { webActor } from './roles.ts';

// The map veto on the website (phase 3e, design doc section 5): `/matches/:id/veto` for the two
// sides and league staff, through the same service as `/match veto` and its buttons. A veto
// started here is posted in the league's schedule channel with the bot's buttons (M-32); a
// choice made here edits that message. Every route asks who the viewer is again.

const ROW_ID = /^[1-9]\d{0,9}$/;
const MARKER = /^(?:-1|\d{1,4})$/;
const field = (form: Record<string, unknown>, name: string) =>
  typeof form[name] === 'string' ? form[name] : '';
// A fair coin from the system's random source (O-11, O-12), as in Discord.
const coin = () => (randomInt(2) === 0 ? ('a' as const) : ('b' as const));

function flashOf(c: Context<Env>): VetoFlash {
  const done = VETO_DONE.find((entry) => entry === c.req.query('veto'));
  if (done) return { done };
  const error = c.req.query('veto_error');
  return isVetoError(error) ? { error } : null;
}

export function vetoRoutes(
  app: Hono<Env>,
  kit: RouteKit,
): { link: (c: Context<Env>, matchId: number) => Html | string } {
  const { deps, render, notFound, forbidden, guard } = kit;
  const { db, locale } = deps;
  const discord = { db, gateway: deps.gateway, locale };

  /** The match's link to its veto, for the sides of a match still to play; the database only. */
  const link = (c: Context<Env>, matchId: number): Html | string => {
    const viewer = c.get('viewer');
    const [found] = listLeagueMatches(db, { matchId });
    if (!viewer || found?.status !== 'scheduled') return '';
    const held = matchRolesOf(db, viewer.playerId, found.seasonId);
    const side = actsFor(held, found, 'a') || actsFor(held, found, 'b');
    return side ? vetoLink(locale, found.id) : '';
  };

  const matchOf = (c: Context<Env>): LeagueMatch | undefined => {
    const id = c.req.param('id') ?? '';
    return ROW_ID.test(id) ? listLeagueMatches(db, { matchId: Number(id) })[0] : undefined;
  };

  /** What the viewer sees of the veto, or null when they do not follow it. */
  const sectionFor = async (
    c: Context<Env>,
    viewer: Viewer,
    found: LeagueMatch,
  ): Promise<VetoSectionData | null> => {
    const actor = await webActor(db, deps.roles, viewer, found.competitionId, deps.now());
    if (!actor) return null;
    const audience = vetoAudience(db, actor, found);
    if (!audience.follows) return null;
    const view = readVeto(db, found);
    const league = actor.guildId ? findGuildLeague(db, actor.guildId) : undefined;
    const competition = db
      .select({ scheduling: schema.competition.schedulingJson })
      .from(schema.competition)
      .where(eq(schema.competition.id, found.competitionId))
      .get();
    return {
      matchId: found.id,
      names: { a: found.a.name, b: found.b.name },
      bestOf: found.bestOf,
      view,
      sides: audience.sides,
      canStart:
        view === null &&
        found.status === 'scheduled' &&
        league !== undefined &&
        (audience.staff || audience.sides.length > 0),
      timeZone: competition?.scheduling.time_zone ?? 'Europe/Paris',
      csrf: viewer.csrf,
      flash: flashOf(c),
    };
  };

  app.get('/matches/:id/veto', async (c) => {
    const viewer = c.get('viewer');
    if (!deps.login) return notFound(c);
    if (!viewer) return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);
    const found = matchOf(c);
    const data = found && (await sectionFor(c, viewer, found));
    if (!data) return notFound(c);
    // Each side sees its own choices: kept by no shared cache.
    c.header('Cache-Control', 'private, no-store');
    return render(c, vetoPageView(locale, data));
  });

  // Asked by the page every few seconds: nothing (204) while the veto has not moved since it
  // last showed, so the page stays as it is; the new section otherwise.
  app.get('/matches/:id/veto/live', async (c) => {
    const viewer = c.get('viewer');
    const found = matchOf(c);
    const shown = c.req.query('step') ?? '';
    if (!viewer || !found || !MARKER.test(shown)) return notFound(c);
    const data = await sectionFor(c, viewer, found);
    if (!data) return notFound(c);
    c.header('Cache-Control', 'private, no-store');
    if (vetoMarker(data.view) === Number(shown)) return c.body(null, 204);
    return c.html(vetoSection(locale, { ...data, flash: null }));
  });

  const back = (c: Context<Env>, matchId: number, query: string) =>
    c.redirect(`/matches/${String(matchId)}/veto?${query}`, 303);
  const done = (c: Context<Env>, matchId: number, what: VetoDone) =>
    back(c, matchId, `veto=${what}`);
  const failed = (c: Context<Env>, matchId: number, error: string) =>
    back(c, matchId, `veto_error=${isVetoError(error) ? error : 'not_your_match'}`);

  /** The match and the viewer as the services know them, with their Discord roles now. */
  const acting = async (c: Context<Env>, viewer: Viewer) => {
    const found = matchOf(c);
    if (!found) return notFound(c);
    const actor = await webActor(db, deps.roles, viewer, found.competitionId, deps.now());
    if (!actor) return forbidden(c);
    return { found, actor };
  };

  app.post('/matches/:id/veto/start', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const target = await acting(c, guarded.viewer);
    if (target instanceof Response) return target;
    const { found, actor } = target;
    const reply = startVeto(db, actor, { matchId: found.id }, deps.now(), coin);
    if (!reply.ok) return failed(c, found.id, reply.error);
    const channelId = actor.guildId
      ? (findGuildLeague(db, actor.guildId)?.guild.scheduleChannelId ?? null)
      : null;
    const posted = channelId !== null && (await postVeto(discord, channelId, reply));
    return done(c, found.id, posted ? 'started' : 'started_unposted');
  });

  app.post('/matches/:id/veto/choose', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const target = await acting(c, guarded.viewer);
    if (target instanceof Response) return target;
    const { found, actor } = target;
    const step = field(guarded.form, 'step');
    const reply = chooseVetoStep(
      db,
      actor,
      {
        matchId: found.id,
        step: /^\d{1,4}$/.test(step) ? Number(step) : -1,
        choice: field(guarded.form, 'choice'),
      },
      deps.now(),
      coin,
    );
    if (!reply.ok) return failed(c, found.id, reply.error);
    await refreshVeto(discord, reply.view);
    return done(c, found.id, 'chosen');
  });

  return { link };
}
