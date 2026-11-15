import { ADDABLE_TEAM_ROLES } from '@ligo/core';
import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { announceDecision, announceFiled } from '../discord/request-text.ts';
import { highestRole, requireStaff, teamsOfPlayer } from '../services/permissions.ts';
import {
  listRequests,
  submitTeamChange,
  teamOfficials,
  withdrawRequest,
  type RequestInput,
} from '../services/requests.ts';
import { rosterPlayers } from '../services/site.ts';
import { rosterToManage, type ManagedRoster } from '../services/team-manage.ts';
import { listTeamStaff, type MemberRef } from '../services/team-staff.ts';
import type { Env, Viewer } from './app.ts';
import type { RouteKit } from './route-kit.ts';
import {
  isManageError,
  MANAGE_DONE,
  teamManagePage,
  type ManageDone,
  type ManageError,
  type ManageFlash,
} from './pages/team-manage.ts';
import { webActor } from './roles.ts';

// `/teams/:slug/manage`: the website's `/team` for one roster. Each POST is checked by `guard`
// (origin, login, CSRF), then by the same services as the bot, with the roles Discord gives the
// viewer now. What Discord shows of a request is done by the same helper as the command's.

const SNOWFLAKE = /^[1-9]\d{16,19}$/;
const ROW_ID = /^[1-9]\d{0,9}$/;
const field = (form: Record<string, unknown>, name: string) =>
  typeof form[name] === 'string' ? form[name] : '';

function flashOf(c: Context<Env>): ManageFlash {
  const done = c.req.query('done');
  const found = MANAGE_DONE.find((entry) => entry === done);
  if (found) return { done: found };
  const error = c.req.query('error');
  if (!isManageError(error)) return null;
  const max = Number(c.req.query('max'));
  return { error, max: Number.isInteger(max) && max >= 0 && max < 100 ? max : null };
}

export function teamManageRoutes(app: Hono<Env>, kit: RouteKit): void {
  const { deps, render, notFound, forbidden, guard } = kit;
  const { db, locale } = deps;
  const discord = { db, gateway: deps.gateway, locale };

  /** The roster and the viewer as the services know them, or the refusal to send. */
  const acting = async (c: Context<Env>, viewer: Viewer) => {
    const roster = rosterToManage(db, c.req.param('slug') ?? '');
    if (!roster) return notFound(c);
    const actor = await webActor(db, deps.roles, viewer, roster.competitionId, deps.now());
    if (!actor) return forbidden(c);
    return { roster, actor };
  };
  const back = (c: Context<Env>, roster: ManagedRoster, query: string) =>
    c.redirect(`/teams/${roster.slug}/manage?${query}`, 303);
  const done = (c: Context<Env>, roster: ManagedRoster, what: ManageDone) =>
    back(c, roster, `done=${what}`);
  const failed = (
    c: Context<Env>,
    roster: ManagedRoster,
    reply: { error: string; max?: number },
  ) => {
    const error: ManageError = isManageError(reply.error) ? reply.error : 'not_official';
    const max = reply.max === undefined ? '' : `&max=${String(reply.max)}`;
    return back(c, roster, `error=${error}${max}`);
  };

  app.get('/teams/:slug/manage', async (c) => {
    if (!deps.login) return notFound(c);
    const viewer = c.get('viewer');
    if (!viewer) return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);
    const found = await acting(c, viewer);
    if (found instanceof Response) return found;
    const { roster, actor } = found;
    // The roster's officials and league staff only; anyone else is refused like a stranger.
    const officials = teamOfficials(db, actor, roster.teamId);
    if (!officials.ok) return forbidden(c);
    const requests = listRequests(db, actor, roster.teamId);
    const competition = db
      .select({ scheduling: schema.competition.schedulingJson })
      .from(schema.competition)
      .where(eq(schema.competition.id, roster.competitionId))
      .get();
    return render(
      c,
      teamManagePage(locale, {
        team: roster,
        members: officials.members,
        players: rosterPlayers(db, roster.teamId),
        requests: requests.ok ? requests.requests : [],
        staff: requireStaff(db, actor).ok,
        myRole: highestRole(teamsOfPlayer(db, viewer.playerId), roster.teamId),
        csrf: viewer.csrf,
        timeZone: competition?.scheduling.time_zone ?? 'Europe/Paris',
        flash: flashOf(c),
      }),
    );
  });

  /** Files the change, or makes it for league staff, then tells Discord as `/team` does. */
  const submit = async (c: Context<Env>, viewer: Viewer, input: RequestInput) => {
    const found = await acting(c, viewer);
    if (found instanceof Response) return found;
    const { roster, actor } = found;
    const submitted = submitTeamChange(db, actor, { ...input, teamId: roster.teamId }, deps.now());
    if (!submitted.reply.ok) return failed(c, roster, submitted.reply);
    if (submitted.mode === 'direct') return done(c, roster, 'changed');
    const reply = submitted.reply;
    await announceFiled(discord, reply, deps.now());
    if (input.kind === 'team_member_remove' && input.member === null) {
      return reply.applied ? c.redirect('/me?left=1', 303) : done(c, roster, 'filed');
    }
    return done(c, roster, reply.applied ? 'applied' : 'filed');
  };

  /** The member of the league's Discord server a username names, or the refusal to show. */
  const memberNamed = async (
    c: Context<Env>,
    viewer: Viewer,
    username: string,
  ): Promise<{ member: MemberRef } | Response> => {
    const found = await acting(c, viewer);
    if (found instanceof Response) return found;
    const { roster, actor } = found;
    // Asked before Discord is: nobody else can use the form to learn who is on the server.
    if (actor.guildId === null || !teamOfficials(db, actor, roster.teamId).ok) return forbidden(c);
    try {
      const member = await deps.gateway.findMember(actor.guildId, username);
      return member
        ? { member: { id: member.id, displayName: member.displayName } }
        : failed(c, roster, { error: 'member_not_found' });
    } catch {
      return failed(c, roster, { error: 'discord_unreachable' });
    }
  };

  app.post('/teams/:slug/manage/add', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const role = ADDABLE_TEAM_ROLES.find((entry) => entry === field(form, 'role'));
    if (!role) {
      const roster = rosterToManage(db, c.req.param('slug'));
      return roster ? failed(c, roster, { error: 'invalid_role' }) : notFound(c);
    }
    const named = await memberNamed(c, viewer, field(form, 'username'));
    if (named instanceof Response) return named;
    const note = field(form, 'note') || null;
    return submit(c, viewer, {
      kind: 'team_member_add',
      member: named.member,
      role,
      teamId: null,
      note,
    });
  });

  app.post('/teams/:slug/manage/owner', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const named = await memberNamed(c, viewer, field(form, 'username'));
    if (named instanceof Response) return named;
    const note = field(form, 'note') || null;
    return submit(c, viewer, { kind: 'team_owner', member: named.member, teamId: null, note });
  });

  app.post('/teams/:slug/manage/remove', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const roster = rosterToManage(db, c.req.param('slug'));
    if (!roster) return notFound(c);
    // The name comes from the database, not the form: only a current official can be removed.
    const id = field(form, 'member');
    const official = SNOWFLAKE.test(id)
      ? listTeamStaff(db, roster.teamId).find((member) => member.discordUserId === id)
      : undefined;
    if (!official) return failed(c, roster, { error: 'not_on_team' });
    const member = { id, displayName: official.displayName };
    const note = field(form, 'note') || null;
    return submit(c, viewer, { kind: 'team_member_remove', member, teamId: null, note });
  });

  app.post('/teams/:slug/manage/leave', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    if (field(form, 'confirm') !== 'yes') {
      const roster = rosterToManage(db, c.req.param('slug'));
      return roster ? back(c, roster, '') : notFound(c);
    }
    return submit(c, viewer, {
      kind: 'team_member_remove',
      member: null,
      teamId: null,
      note: null,
    });
  });

  app.post('/teams/:slug/manage/requests/:id/withdraw', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const found = await acting(c, guarded.viewer);
    if (found instanceof Response) return found;
    const { roster, actor } = found;
    const id = c.req.param('id');
    if (!ROW_ID.test(id)) return notFound(c);
    const reply = withdrawRequest(db, actor, { requestId: Number(id) }, deps.now());
    if (!reply.ok) return failed(c, roster, reply);
    await announceDecision(discord, reply);
    return done(c, roster, 'withdrawn');
  });
}
