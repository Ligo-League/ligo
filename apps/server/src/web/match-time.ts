import { findGuildLeague, listLeagueMatches, type LeagueMatch } from '@ligo/db';
import type { Context, Hono } from 'hono';
import { announceAnswer, postProposal } from '../discord/schedule-posts.ts';
import { actsFor, matchRolesOf } from '../services/permissions.ts';
import {
  answerProposal,
  pendingProposals,
  proposalDays,
  proposeTime,
  readMatchTime,
} from '../services/scheduling.ts';
import type { Env, Viewer } from './app.ts';
import type { Html } from './layout.ts';
import {
  isTimeError,
  TIME_DONE,
  timePanel,
  type TimeDone,
  type TimeFlash,
} from './pages/match-time.ts';
import type { RouteKit } from './route-kit.ts';
import { webActor } from './roles.ts';

// Match times on the website (phase 3e): each side's officials and captain propose a time on the
// match page and answer the other side's, through the same services as `/match propose-time`
// and its buttons. A proposal made here is posted in the league's schedule channel with the
// bot's buttons (M-32); an answer given here edits that post.

const MATCH_ID = /^[1-9]\d{0,9}$/;
const field = (form: Record<string, unknown>, name: string) =>
  typeof form[name] === 'string' ? form[name] : '';
const noRoles = () => Promise.resolve([] as string[]);

function flashOf(c: Context<Env>): TimeFlash {
  const done = TIME_DONE.find((entry) => entry === c.req.query('time'));
  if (done) return { done };
  const error = c.req.query('time_error');
  return isTimeError(error) ? { error } : null;
}

const sidesOf = (db: RouteKit['deps']['db'], viewer: Viewer, found: LeagueMatch) => {
  const held = matchRolesOf(db, viewer.playerId, found.seasonId);
  return (['a', 'b'] as const).filter((side) => actsFor(held, found, side));
};

export function matchTimeRoutes(
  app: Hono<Env>,
  kit: RouteKit,
): { panel: (c: Context<Env>, matchId: number) => Promise<Html | string> } {
  const { deps, notFound, forbidden, guard } = kit;
  const { db, locale } = deps;
  const discord = {
    db,
    gateway: deps.gateway,
    assets: deps.assets,
    locale,
    publicUrl: deps.login?.publicUrl,
  };

  /**
   * The time panel for the viewer, when they act for a side of a match still to play; nothing
   * otherwise. It reads the database only: Discord is asked when they act.
   */
  const panel = async (c: Context<Env>, matchId: number): Promise<Html | string> => {
    const viewer = c.get('viewer');
    const [found] = listLeagueMatches(db, { matchId });
    if (!viewer || !found || found.status !== 'scheduled') return '';
    const sides = sidesOf(db, viewer, found);
    if (sides.length === 0) return '';
    // Team actions need no Discord role; the actor only names the league's server.
    const actor = await webActor(db, noRoles, viewer, found.competitionId, deps.now());
    const league = actor?.guildId ? findGuildLeague(db, actor.guildId) : undefined;
    if (!actor || !league) return '';
    return timePanel(locale, {
      matchId: found.id,
      sides,
      names: { a: found.a.name, b: found.b.name },
      proposals: pendingProposals(db, found.id),
      days: proposalDays(db, actor, found.id, deps.now()),
      timeZone: league.competition.schedulingJson.time_zone,
      posted: league.guild.scheduleChannelId !== null,
      csrf: viewer.csrf,
      flash: flashOf(c),
    });
  };

  const back = (c: Context<Env>, matchId: number, query: string) =>
    c.redirect(`/matches/${String(matchId)}?${query}#time`, 303);
  const done = (c: Context<Env>, matchId: number, what: TimeDone) =>
    back(c, matchId, `time=${what}`);
  const failed = (c: Context<Env>, matchId: number, error: string) =>
    back(c, matchId, `time_error=${isTimeError(error) ? error : 'not_your_match'}`);

  /** The match and the viewer as the services know them, with their Discord roles now. */
  const acting = async (c: Context<Env>, viewer: Viewer) => {
    const id = c.req.param('id') ?? '';
    const [found] = MATCH_ID.test(id) ? listLeagueMatches(db, { matchId: Number(id) }) : [];
    if (!found) return notFound(c);
    const actor = await webActor(db, deps.roles, viewer, found.competitionId, deps.now());
    if (!actor) return forbidden(c);
    return { found, actor };
  };

  app.post('/matches/:id/time/propose', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const found = await acting(c, guarded.viewer);
    if (found instanceof Response) return found;
    const { found: match, actor } = found;
    const time = readMatchTime(db, actor, field(guarded.form, 'date'), field(guarded.form, 'time'));
    if (!time.ok) return failed(c, match.id, time.error);
    const reply = proposeTime(db, actor, { matchId: match.id, at: time.at }, deps.now());
    if (!reply.ok) return failed(c, match.id, reply.error);
    const posted =
      reply.scheduleChannelId !== null &&
      (await postProposal(discord, reply.scheduleChannelId, reply, actor.user.id));
    return done(c, match.id, posted ? 'proposed' : 'proposed_unposted');
  });

  app.post('/matches/:id/time/:proposal/:action', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const action = c.req.param('action');
    const proposalId = c.req.param('proposal');
    if ((action !== 'accept' && action !== 'decline') || !MATCH_ID.test(proposalId)) {
      return notFound(c);
    }
    const found = await acting(c, guarded.viewer);
    if (found instanceof Response) return found;
    const { found: match, actor } = found;
    const reply = answerProposal(
      db,
      actor,
      { matchId: match.id, proposalId: Number(proposalId), action },
      deps.now(),
    );
    if (!reply.ok) return failed(c, match.id, reply.error);
    await announceAnswer(discord, reply, actor.user.id);
    return done(c, match.id, reply.status);
  });

  return { panel };
}
