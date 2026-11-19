import { listLeagueMatches, type LeagueMatch } from '@ligo/db';
import type { Context, Hono } from 'hono';
import { matchCaptains, matchLineup, nameMatchCaptain } from '../services/match-captain.ts';
import { actsFor, matchRolesOf } from '../services/permissions.ts';
import type { Env, Viewer } from './app.ts';
import type { Html } from './layout.ts';
import {
  CAPTAIN_DONE,
  captainPanel,
  isCaptainError,
  type CaptainFlash,
} from './pages/match-captain.ts';
import type { RouteKit } from './route-kit.ts';
import { webActor } from './roles.ts';

// The captain for one match on the match page (O-30, O-30b): the side's officials or its usual
// captain name a starter or substitute of the season's lineup, until the result is reported,
// through the same service the checks live in.

const ROW_ID = /^[1-9]\d{0,9}$/;

function flashOf(c: Context<Env>): CaptainFlash {
  const done = CAPTAIN_DONE.find((entry) => entry === c.req.query('captain'));
  if (done) return { done };
  const error = c.req.query('captain_error');
  return isCaptainError(error) ? { error } : null;
}

/** The sides the viewer may name a captain for: by a lasting role, not a captaincy for one match. */
function namingSides(db: RouteKit['deps']['db'], viewer: Viewer, found: LeagueMatch) {
  const lasting = matchRolesOf(db, viewer.playerId, found.seasonId).filter(
    (held) => held.matchId === undefined,
  );
  return (['a', 'b'] as const).filter((side) => actsFor(lasting, found, side));
}

export function matchCaptainRoutes(
  app: Hono<Env>,
  kit: RouteKit,
): { panel: (c: Context<Env>, matchId: number) => Html | string } {
  const { deps, notFound, forbidden, guard } = kit;
  const { db, locale } = deps;

  /** The captain panel, for those who may name one, while the match is to be reported. */
  const panel = (c: Context<Env>, matchId: number): Html | string => {
    const viewer = c.get('viewer');
    const [found] = listLeagueMatches(db, { matchId });
    if (!viewer || found?.status !== 'scheduled') return '';
    const sides = namingSides(db, viewer, found);
    if (sides.length === 0) return '';
    const captains = matchCaptains(db, found);
    return captainPanel(locale, {
      matchId: found.id,
      sides: sides.map((side) => ({
        side,
        team: found[side].name,
        ...captains[side],
        lineup: matchLineup(db, found, side, deps.now()),
      })),
      csrf: viewer.csrf,
      flash: flashOf(c),
    });
  };

  app.post('/matches/:id/captain', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const id = c.req.param('id');
    const [found] = ROW_ID.test(id) ? listLeagueMatches(db, { matchId: Number(id) }) : [];
    if (!found) return notFound(c);
    const side = guarded.form.side;
    if (side !== 'a' && side !== 'b') return notFound(c);
    // Team actions need no Discord role; the actor names the league's server for the service.
    const actor = await webActor(db, deps.roles, guarded.viewer, found.competitionId, deps.now());
    if (!actor) return forbidden(c);
    const player = typeof guarded.form.player === 'string' ? guarded.form.player : '';
    const reply = nameMatchCaptain(
      db,
      actor,
      {
        matchId: found.id,
        side,
        playerId: player === '' ? null : ROW_ID.test(player) ? Number(player) : -1,
      },
      deps.now(),
    );
    const query = reply.ok
      ? `captain=${reply.standIn ? 'named' : 'cleared'}`
      : `captain_error=${reply.error}`;
    return c.redirect(`/matches/${String(found.id)}?${query}#captain`, 303);
  });

  return { panel };
}
