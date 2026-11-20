import { findLeague } from '@ligo/db';
import type { Context, Hono } from 'hono';
import { announceExclusion, announceReinstatement } from '../discord/staff-actions.ts';
import { excludeTeam, reinstateTeam, setAutoExclusion } from '../services/exclusions.ts';
import { addSanction, sanctionsOverview, TEAM_SANCTION_KINDS } from '../services/sanctions.ts';
import type { Env } from './app.ts';
import {
  isSanctionsError,
  SANCTIONS_DONE,
  staffSanctionsPage,
  type LeagueSanctions,
  type SanctionsDone,
  type SanctionsFlash,
} from './pages/staff-sanctions.ts';
import type { RouteKit } from './route-kit.ts';
import { staffScopes, webActor } from './roles.ts';

// `/staff/sanctions` (phase 3f-4; design doc section 3): league staff give sanctions, exclude a
// team, reinstate it on appeal and switch its automatic exclusion, through the same services as
// the forfeit rule, with the same Discord messages. Staff is asked of the competition's Discord
// server on every request and checked again by the service.

const ROW_ID = /^[1-9]\d{0,9}$/;
const ACTIONS = ['add', 'exclude', 'reinstate', 'auto'] as const;
const field = (form: Record<string, unknown>, name: string) =>
  typeof form[name] === 'string' ? form[name] : '';

function flashOf(c: Context<Env>): SanctionsFlash {
  const done = SANCTIONS_DONE.find((entry) => entry === c.req.query('done'));
  if (done) return { done };
  const error = c.req.query('error');
  return isSanctionsError(error) ? { error } : null;
}

export function staffSanctionsRoutes(app: Hono<Env>, kit: RouteKit): void {
  const { deps, render, notFound, forbidden, guard } = kit;
  const { db, locale } = deps;
  const discord = { db, gateway: deps.gateway, assets: deps.assets, locale };

  app.get('/staff/sanctions', async (c) => {
    if (!deps.login) return notFound(c);
    const viewer = c.get('viewer');
    if (!viewer) return c.redirect('/auth/login?next=/staff/sanctions', 303);
    // League staff, and a division's staff for their divisions' teams (M-05).
    const competitions = await staffScopes(db, deps.roles, viewer, deps.now());
    if (competitions.length === 0) return forbidden(c);
    const leagues: LeagueSanctions[] = [];
    for (const competition of competitions) {
      const actor = await webActor(db, deps.roles, viewer, competition.id, deps.now());
      const overview = actor ? sanctionsOverview(db, actor) : null;
      const league = findLeague(db, competition.id);
      leagues.push({
        competitionId: competition.id,
        name: competition.name,
        timeZone: league?.competition.schedulingJson.time_zone ?? 'Europe/Paris',
        teams: overview?.ok ? overview.teams : [],
        sanctions: overview?.ok ? overview.sanctions : [],
      });
    }
    // Staff only: no shared cache keeps it.
    c.header('Cache-Control', 'no-store');
    return render(c, staffSanctionsPage(locale, { leagues, csrf: viewer.csrf, flash: flashOf(c) }));
  });

  app.post('/staff/sanctions/:competition/:action', async (c) => {
    const what = ACTIONS.find((entry) => entry === c.req.param('action'));
    const competition = c.req.param('competition');
    if (!what || !ROW_ID.test(competition)) return notFound(c);
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const actor = await webActor(db, deps.roles, viewer, Number(competition), deps.now());
    if (!actor) return forbidden(c);
    const back = (query: string) => c.redirect(`/staff/sanctions?${query}#c${competition}`, 303);
    const team = field(form, 'team');
    const teamId = ROW_ID.test(team) ? Number(team) : -1;
    const reason = field(form, 'reason');
    const now = deps.now();
    const refused = (error: string) =>
      error === 'not_staff' || error === 'not_linked'
        ? forbidden(c)
        : back(`error=${isSanctionsError(error) ? error : 'team_not_found'}`);
    const done = (what: SanctionsDone) => back(`done=${what}`);

    if (what === 'add') {
      const kind = TEAM_SANCTION_KINDS.find((entry) => entry === field(form, 'kind'));
      if (!kind) return refused('team_not_found');
      const points = field(form, 'points').trim();
      const reply = addSanction(
        db,
        actor,
        { teamId, kind, points: /^-?\d{1,3}$/.test(points) ? Number(points) : null, reason },
        now,
      );
      return reply.ok ? done('added') : refused(reply.error);
    }
    if (what === 'exclude') {
      const reply = excludeTeam(db, actor, { teamId, reason }, now);
      if (!reply.ok) return refused(reply.error);
      await announceExclusion(discord, {
        team: reply.team.name,
        reason: reply.reason,
        excluded: reply.excluded,
        resultsChannelId: reply.resultsChannelId,
        queueChannelId: reply.queueChannelId,
      });
      return done('excluded');
    }
    if (what === 'reinstate') {
      const reply = reinstateTeam(db, actor, { teamId, reason }, now);
      if (!reply.ok) return refused(reply.error);
      await announceReinstatement(discord, reply);
      return done('reinstated');
    }
    const enabled = field(form, 'enabled');
    if (enabled !== 'on' && enabled !== 'off') return refused('team_not_found');
    const reply = setAutoExclusion(db, actor, { teamId, enabled: enabled === 'on', reason }, now);
    return reply.ok ? done(enabled === 'on' ? 'auto_on' : 'auto_off') : refused(reply.error);
  });
}
