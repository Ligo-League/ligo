import type { RoleChange } from '@ligo/core';
import { findRoster } from '@ligo/db';
import type { Context, Hono } from 'hono';
import { announceMoveFiled, announceMoveWithdrawn } from '../discord/move-posts.ts';
import type { MemberCheck } from '../services/registration-players.ts';
import {
  changeRole,
  fileMove,
  mercatoTeamView,
  moveCompetitionOf,
  withdrawMove,
} from '../services/roster-moves.ts';
import type { Env, Viewer } from './app.ts';
import {
  isMercatoTeamError,
  MERCATO_TEAM_DONE,
  rosterMercatoPage,
  type MercatoTeamFlash,
} from './pages/roster-mercato.ts';
import type { RouteKit } from './route-kit.ts';
import { webActor } from './roles.ts';

// `/teams/:slug/mercato` (phase 3f-11; design doc section 7, O-35): the roster's officials who
// manage its players, and league staff, file and withdraw moves and change roles and the
// captain. Each POST is checked by `guard` (origin, login, CSRF), then by the service, with the
// roles Discord gives the viewer in the league's server now.

const ROW_ID = /^[1-9]\d{0,9}$/;
const ROLES = ['player', 'sub'] as const;
const field = (form: Record<string, unknown>, name: string) =>
  typeof form[name] === 'string' ? form[name].trim() : '';
const idOf = (text: string) => (ROW_ID.test(text) ? Number(text) : null);

function flashOf(c: Context<Env>): MercatoTeamFlash {
  const done = MERCATO_TEAM_DONE.find((entry) => entry === c.req.query('done'));
  if (done) return { done };
  const error = c.req.query('error');
  return isMercatoTeamError(error) ? { error } : null;
}

export function rosterMercatoRoutes(app: Hono<Env>, kit: RouteKit, memberOf: MemberCheck): void {
  const { deps, render, notFound, forbidden, guard } = kit;
  const { db, locale } = deps;
  const discord = { db, gateway: deps.gateway, locale, now: deps.now };

  /** The roster and the viewer as the league's server knows them, or the refusal to send. */
  const acting = async (c: Context<Env>, viewer: Viewer) => {
    const roster = findRoster(db, { slug: c.req.param('slug') ?? '' });
    if (!roster) return notFound(c);
    const competitionId = moveCompetitionOf(db, roster.teamId);
    if (competitionId === null) return notFound(c);
    const actor = await webActor(db, deps.roles, viewer, competitionId, deps.now());
    if (!actor) return forbidden(c);
    return { roster, actor };
  };

  app.get('/teams/:slug/mercato', async (c) => {
    if (!deps.login) return notFound(c);
    const viewer = c.get('viewer');
    if (!viewer) return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);
    const found = await acting(c, viewer);
    if (found instanceof Response) return found;
    const view = mercatoTeamView(db, found.actor, found.roster.teamId, deps.now());
    if (!view.ok) return view.error === 'not_allowed' ? forbidden(c) : notFound(c);
    c.header('Cache-Control', 'no-store');
    return render(c, rosterMercatoPage(locale, view, { csrf: viewer.csrf, flash: flashOf(c) }));
  });

  /** Runs a POST for a roster: the guard, then the viewer's roles, then `then`. */
  const post =
    (
      then: (
        c: Context<Env>,
        found: Exclude<Awaited<ReturnType<typeof acting>>, Response>,
        form: Record<string, unknown>,
        back: (query: string) => Response,
      ) => Promise<Response> | Response,
    ) =>
    async (c: Context<Env>) => {
      const guarded = await guard(c);
      if (guarded instanceof Response) return guarded;
      const found = await acting(c, guarded.viewer);
      if (found instanceof Response) return found;
      const back = (query: string) =>
        c.redirect(`/teams/${found.roster.slug}/mercato?${query}`, 303);
      return then(c, found, guarded.form, back);
    };
  const refused = (c: Context<Env>, back: (query: string) => Response, error: string) =>
    error === 'not_allowed'
      ? forbidden(c)
      : back(`error=${isMercatoTeamError(error) ? error : 'not_found'}`);

  app.post(
    '/teams/:slug/mercato/move',
    post(async (c, { roster, actor }, form, back) => {
      const role = field(form, 'role') === 'sub' ? 'sub' : 'player';
      const incoming = idOf(field(form, 'in'));
      const reply = await fileMove(
        db,
        memberOf,
        actor,
        {
          teamId: roster.teamId,
          outId: idOf(field(form, 'out')),
          in: incoming === null ? null : { playerId: incoming, role },
          note: field(form, 'note') || null,
        },
        deps.now(),
      );
      if (!reply.ok) return refused(c, back, reply.error);
      if (deps.login) await announceMoveFiled(discord, reply, deps.login.publicUrl);
      return back('done=filed');
    }),
  );

  // A staff exception (O-35): applied at once, at any time, with a reason; not counted.
  app.post(
    '/teams/:slug/mercato/exception',
    post(async (c, { roster, actor }, form, back) => {
      const role = field(form, 'role') === 'sub' ? 'sub' : 'player';
      const incoming = idOf(field(form, 'in'));
      const reply = await fileMove(
        db,
        memberOf,
        actor,
        {
          teamId: roster.teamId,
          outId: idOf(field(form, 'out')),
          in: incoming === null ? null : { playerId: incoming, role },
          note: null,
          exceptionReason: field(form, 'reason'),
        },
        deps.now(),
      );
      if (!reply.ok) return refused(c, back, reply.error);
      if (deps.login) {
        await announceMoveFiled(discord, reply, deps.login.publicUrl, actor.user.id);
      }
      return back('done=exception');
    }),
  );

  app.post(
    '/teams/:slug/mercato/moves/:id/withdraw',
    post(async (c, { roster, actor }, _form, back) => {
      const id = idOf(c.req.param('id') ?? '');
      if (id === null) return notFound(c);
      const reply = withdrawMove(db, actor, roster.teamId, id, deps.now());
      if (!reply.ok) return refused(c, back, reply.error);
      if (deps.login) {
        await announceMoveWithdrawn(discord, reply, roster, deps.login.publicUrl);
      }
      return back('done=withdrawn');
    }),
  );

  app.post(
    '/teams/:slug/mercato/role',
    post((c, { roster, actor }, form, back) => {
      const captain = idOf(field(form, 'captain'));
      const playerId = idOf(field(form, 'player'));
      const role = ROLES.find((entry) => entry === field(form, 'role'));
      const change: RoleChange | null =
        captain !== null
          ? { captainId: captain }
          : playerId !== null && role
            ? { playerId, role }
            : null;
      if (change === null) return back('error=not_in_lineup');
      const reply = changeRole(db, actor, roster.teamId, change, deps.now());
      return reply.ok ? back('done=role') : refused(c, back, reply.error);
    }),
  );
}
