import {
  findGuildLeague,
  latestScoreEvidence,
  listLeagueMatches,
  type LeagueMatch,
} from '@ligo/db';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { announceReportAnswer, postReport, reportQueueMessage } from '../discord/report-posts.ts';
import { t } from '../i18n/index.ts';
import { actsFor, matchRolesOf } from '../services/permissions.ts';
import { answerReport, reportingSide, reportResult } from '../services/reports.ts';
import { SCREENSHOT_MAX_BYTES } from '../services/results.ts';
import type { Env, Viewer } from './app.ts';
import type { Html } from './layout.ts';
import { messagePage } from './pages/errors.ts';
import {
  isReportError,
  REPORT_DONE,
  reportPanel,
  type ReportDone,
  type ReportFlash,
} from './pages/match-report.ts';
import type { RouteKit } from './route-kit.ts';
import { webActor } from './roles.ts';
import { matchPostChannel } from '../services/match-channels.ts';

// Results on the website (phase 3e): each side's officials and captain report the result with
// the scoreboard screenshot, and the other side confirms or disputes it, through the same
// services as `/match report` and its buttons. A report made here goes to the staff queue and is
// posted in the league's schedule channel with the bot's buttons (M-32); an answer given here
// edits the report's post, wherever it was made.

const ROW_ID = /^[1-9]\d{0,9}$/;
const ANSWERED = { confirmed: 'confirmed', validated: 'validated', disputed: 'disputed' } as const;
const noRoles = () => Promise.resolve([] as string[]);
const field = (form: Record<string, unknown>, name: string) =>
  typeof form[name] === 'string' ? form[name] : '';
// A score typed in the form: digits only, as the command's integer option takes.
const scoreOf = (value: string) => (/^\d{1,3}$/.test(value) ? Number(value) : -1);

function flashOf(c: Context<Env>): ReportFlash {
  const done = REPORT_DONE.find((entry) => entry === c.req.query('report'));
  if (done) return { done };
  const error = c.req.query('report_error');
  return isReportError(error) ? { error } : null;
}

const sidesOf = (db: RouteKit['deps']['db'], viewer: Viewer, found: LeagueMatch) => {
  const held = matchRolesOf(db, viewer.playerId, found.seasonId);
  return (['a', 'b'] as const).filter((side) => actsFor(held, found, side));
};

const PANEL_STATUSES = ['scheduled', 'reported', 'confirmed', 'disputed'] as const;
const inPanel = (status: LeagueMatch['status']): status is (typeof PANEL_STATUSES)[number] =>
  (PANEL_STATUSES as readonly string[]).includes(status);

export function matchReportRoutes(
  app: Hono<Env>,
  kit: RouteKit,
): { panel: (c: Context<Env>, matchId: number) => Promise<Html | string> } {
  const { deps, render, notFound, forbidden, guard } = kit;
  const { db, locale } = deps;
  const discord = {
    db,
    gateway: deps.gateway,
    assets: deps.assets,
    locale,
    now: deps.now,
    publicUrl: deps.login?.publicUrl,
  };

  /**
   * The result panel for the viewer, when they act for a side of a best-of-1 match still to be
   * reported or waiting for an answer; nothing otherwise. It reads the database only.
   */
  const panel = async (c: Context<Env>, matchId: number): Promise<Html | string> => {
    const viewer = c.get('viewer');
    const [found] = listLeagueMatches(db, { matchId });
    if (!viewer || !found || found.bestOf !== 1 || !inPanel(found.status)) return '';
    const sides = sidesOf(db, viewer, found);
    if (sides.length === 0) return '';
    // Team actions need no Discord role; the actor only names the league's server.
    const actor = await webActor(db, noRoles, viewer, found.competitionId, deps.now());
    const league = actor?.guildId ? findGuildLeague(db, actor.guildId) : undefined;
    if (!actor || !league) return '';
    const evidence = latestScoreEvidence(db, found.id);
    const { rulesetJson } = league.competition;
    return reportPanel(locale, {
      matchId: found.id,
      sides,
      names: { a: found.a.name, b: found.b.name },
      report:
        found.status === 'scheduled' || !evidence
          ? null
          : {
              evidenceId: evidence.id,
              side: reportingSide(db, found),
              score: found.game ? { a: found.game.scoreA, b: found.game.scoreB } : null,
              status: found.status,
              shown: evidence.objectKey !== null && evidence.visibility !== 'staff',
            },
      reasons: rulesetJson.dispute_reasons,
      gameScore: rulesetJson.game_score ?? null,
      posted: matchPostChannel(db, league.guild, found.id) !== null,
      csrf: viewer.csrf,
      flash: flashOf(c),
    });
  };

  const back = (c: Context<Env>, matchId: number, query: string) =>
    c.redirect(`/matches/${String(matchId)}?${query}#result`, 303);
  const done = (c: Context<Env>, matchId: number, what: ReportDone) =>
    back(c, matchId, `report=${what}`);
  const failed = (c: Context<Env>, matchId: number, error: string) =>
    back(c, matchId, `report_error=${isReportError(error) ? error : 'not_your_match'}`);

  /** The match and the viewer as the services know them. */
  const acting = async (c: Context<Env>, viewer: Viewer) => {
    const id = c.req.param('id') ?? '';
    const [found] = ROW_ID.test(id) ? listLeagueMatches(db, { matchId: Number(id) }) : [];
    if (!found) return notFound(c);
    const actor = await webActor(db, deps.roles, viewer, found.competitionId, deps.now());
    if (!actor) return forbidden(c);
    return { found, actor };
  };

  // The screenshot is at most what Discord accepts; the rest of the form is small. A larger body
  // is refused before it is read.
  const limit = bodyLimit({
    maxSize: SCREENSHOT_MAX_BYTES + 64 * 1024,
    // bodyLimit types its context loosely: it is this app's own.
    onError: (c: Context<Env>) =>
      render(
        c,
        messagePage(
          locale,
          t(locale, 'web.report.tooBig.title'),
          t(locale, 'web.report.tooBig.body'),
        ),
        413,
      ),
  });

  app.post('/matches/:id/report', limit, async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const found = await acting(c, guarded.viewer);
    if (found instanceof Response) return found;
    const { found: match, actor } = found;
    const upload = guarded.form.screenshot;
    const data =
      upload instanceof File && upload.size > 0 ? new Uint8Array(await upload.arrayBuffer()) : null;
    const reply = await reportResult(
      db,
      deps.gateway,
      deps.evidence,
      actor,
      {
        matchId: match.id,
        scoreA: scoreOf(field(guarded.form, 'score_a')),
        scoreB: scoreOf(field(guarded.form, 'score_b')),
        screenshot: data && { data },
      },
      (report) => reportQueueMessage(locale, report, actor.user.id),
      deps.now(),
    );
    if (!reply.ok) return failed(c, match.id, reply.error);
    const posted =
      reply.scheduleChannelId !== null &&
      (await postReport(discord, reply.scheduleChannelId, reply, actor.user.id));
    return done(c, match.id, posted ? 'reported' : 'reported_unposted');
  });

  app.post('/matches/:id/report/:evidence/:action', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const action = c.req.param('action');
    const evidenceId = c.req.param('evidence');
    if ((action !== 'confirm' && action !== 'dispute') || !ROW_ID.test(evidenceId)) {
      return notFound(c);
    }
    const found = await acting(c, guarded.viewer);
    if (found instanceof Response) return found;
    const { found: match, actor } = found;
    const target = { matchId: match.id, evidenceId: Number(evidenceId) };
    const reply = answerReport(
      db,
      actor,
      action === 'confirm'
        ? { ...target, action }
        : {
            ...target,
            action,
            reason: field(guarded.form, 'reason'),
            details: field(guarded.form, 'details').replaceAll('\r\n', '\n'),
          },
      deps.now(),
    );
    if (!reply.ok) return failed(c, match.id, reply.error);
    await announceReportAnswer(discord, reply, actor.user.id, { editPost: true });
    return done(c, match.id, ANSWERED[reply.status]);
  });

  return { panel };
}
