import { nextMatchStatus, type MatchAction } from '@ligo/core';
import {
  findGuildLeague,
  latestScoreEvidence,
  listLeagueMatches,
  type LeagueMatch,
} from '@ligo/db';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  announceForfeit,
  announceMatchTime,
  announceStaffResult,
} from '../discord/staff-actions.ts';
import { announceReportDecision } from '../discord/staff-decisions.ts';
import { t } from '../i18n/index.ts';
import { matchForfeitCounts, recordForfeit } from '../services/forfeits.ts';
import { requireStaff, type Actor } from '../services/permissions.ts';
import { rejectResult, validateResult, voidMatch } from '../services/reports.ts';
import { enterResult, OPEN_STATUSES, SCREENSHOT_MAX_BYTES } from '../services/results.ts';
import { readMatchTime, setMatchTime } from '../services/scheduling.ts';
import { mossOverview, setMossHold } from '../services/moss.ts';
import { validationBlockers } from '../services/validation-gates.ts';
import type { Env, Viewer } from './app.ts';
import type { Html } from './layout.ts';
import { messagePage } from './pages/errors.ts';
import {
  isStaffError,
  STAFF_DONE,
  staffPanel,
  type StaffDone,
  type StaffFlash,
} from './pages/match-staff.ts';
import type { RouteKit } from './route-kit.ts';
import { webActor } from './roles.ts';

// The staff panel on the match page (phase 3f; design doc section 3): league staff enter or
// correct a result, validate or refuse a report, set the time, record a forfeit and annul a match, through the
// same services as the staff queue, with the same Discord announcements. Staff is asked of
// Discord on every request and checked again by the service.

const ROW_ID = /^[1-9]\d{0,9}$/;
const ACTIONS = [
  'validate',
  'reject',
  'void',
  'forfeit',
  'time',
  'moss-hold',
  'moss-release',
] as const;
const DONE = {
  validate: 'validated',
  reject: 'rejected',
  void: 'voided',
  forfeit: 'forfeited',
  time: 'timed',
  'moss-hold': 'moss_held',
  'moss-release': 'moss_released',
} as const satisfies Record<(typeof ACTIONS)[number], StaffDone>;
const field = (form: Record<string, unknown>, name: string) =>
  typeof form[name] === 'string' ? form[name] : '';
// A score typed in the form: digits only, as the report form takes.
const scoreOf = (value: string) => (/^\d{1,3}$/.test(value) ? Number(value) : -1);

function flashOf(c: Context<Env>): StaffFlash {
  const done = STAFF_DONE.find((entry) => entry === c.req.query('staff'));
  if (done) return { done };
  const error = c.req.query('staff_error');
  return isStaffError(error) ? { error } : null;
}

export function matchStaffRoutes(
  app: Hono<Env>,
  kit: RouteKit,
): { panel: (c: Context<Env>, matchId: number) => Promise<Html | string> } {
  const { deps, render, notFound, forbidden, guard } = kit;
  const { db, locale } = deps;
  const discord = { db, gateway: deps.gateway, assets: deps.assets, locale };

  /** The viewer as staff of the match's league or of its division (M-05), or null. */
  const staffOf = async (viewer: Viewer, found: LeagueMatch): Promise<Actor | null> => {
    const actor = await webActor(db, deps.roles, viewer, found.competitionId, deps.now());
    return actor && requireStaff(db, actor, { matchId: found.id }).ok ? actor : null;
  };

  /** The staff panel, for league staff of the match's league; nothing for anyone else. */
  const panel = async (c: Context<Env>, matchId: number): Promise<Html | string> => {
    const viewer = c.get('viewer');
    const [found] = listLeagueMatches(db, { matchId });
    if (!viewer || !found) return '';
    const actor = await staffOf(viewer, found);
    const league = actor?.guildId ? findGuildLeague(db, actor.guildId) : undefined;
    if (!actor || !league) return '';
    const { rulesetJson } = league.competition;
    const allows = (action: MatchAction) =>
      nextMatchStatus({
        status: found.status,
        action,
        actor: 'staff',
        validation: rulesetJson.result_validation,
      }).ok;
    const single = found.bestOf === 1;
    const evidence = allows('validate') ? latestScoreEvidence(db, found.id) : undefined;
    const counts = single && allows('forfeit') ? matchForfeitCounts(db, found.id) : null;
    return staffPanel(locale, {
      matchId: found.id,
      names: { a: found.a.name, b: found.b.name },
      entry:
        single && OPEN_STATUSES.includes(found.status)
          ? { correcting: found.status === 'validated' }
          : null,
      report: evidence
        ? {
            evidenceId: evidence.id,
            score: found.game ? { a: found.game.scoreA, b: found.game.scoreB } : null,
          }
        : null,
      forfeit: counts && { counts: { a: counts.a, b: counts.b }, thresholds: counts.thresholds },
      canVoid: allows('void'),
      canTime: found.status === 'scheduled',
      gameScore: rulesetJson.game_score ?? null,
      moss: (() => {
        const overview = mossOverview(db, found);
        const any = overview.sides.a.length + overview.sides.b.length > 0;
        return overview.required || any ? overview : null;
      })(),
      waiverNeeded: found.status !== 'validated' && validationBlockers(db, found).length > 0,
      csrf: viewer.csrf,
      flash: flashOf(c),
    });
  };

  const back = (c: Context<Env>, matchId: number, query: string) =>
    c.redirect(`/matches/${String(matchId)}?${query}#staff`, 303);
  /** A refusal: someone who is not staff is refused outright; staff see why on the page. */
  const refused = (c: Context<Env>, matchId: number, error: string) =>
    error === 'not_staff' || error === 'not_linked'
      ? forbidden(c)
      : back(c, matchId, `staff_error=${isStaffError(error) ? error : 'wrong_status'}`);

  /** The match and the viewer as staff, or the response that refuses them. */
  const acting = async (c: Context<Env>, viewer: Viewer) => {
    const id = c.req.param('id') ?? '';
    const [found] = ROW_ID.test(id) ? listLeagueMatches(db, { matchId: Number(id) }) : [];
    if (!found) return notFound(c);
    const actor = await staffOf(viewer, found);
    if (!actor) return forbidden(c);
    return { found, actor };
  };

  // The screenshot is at most what Discord accepts; the rest of the form is small.
  const limit = bodyLimit({
    maxSize: SCREENSHOT_MAX_BYTES + 64 * 1024,
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

  // Registered before `/:action`, which would otherwise take `result`.
  app.post('/matches/:id/staff/result', limit, async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const target = await acting(c, guarded.viewer);
    if (target instanceof Response) return target;
    const { found, actor } = target;
    const upload = guarded.form.screenshot;
    const screenshot =
      upload instanceof File && upload.size > 0 ? new Uint8Array(await upload.arrayBuffer()) : null;
    const reply = await enterResult(
      db,
      deps.evidence,
      actor,
      {
        matchId: found.id,
        scoreA: scoreOf(field(guarded.form, 'score_a')),
        scoreB: scoreOf(field(guarded.form, 'score_b')),
        screenshot,
        waiver: field(guarded.form, 'waiver'),
      },
      deps.now(),
    );
    if (!reply.ok) return refused(c, found.id, reply.error);
    await announceStaffResult(discord, reply, actor.user.id);
    return back(c, found.id, 'staff=entered');
  });

  app.post('/matches/:id/staff/:action', async (c) => {
    const what = ACTIONS.find((entry) => entry === c.req.param('action'));
    if (!what) return notFound(c);
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const target = await acting(c, guarded.viewer);
    if (target instanceof Response) return target;
    const { found, actor } = target;
    const { form } = guarded;
    const now = deps.now();

    if (what === 'forfeit') {
      const side = (['a', 'b', 'both'] as const).find((entry) => entry === field(form, 'side'));
      if (!side) return refused(c, found.id, 'wrong_status');
      const reply = recordForfeit(
        db,
        actor,
        {
          matchId: found.id,
          side,
          warningReason: (count) => t(locale, 'sanction.reason.forfeits', { count }),
          exclusionReason: (count) => t(locale, 'sanction.reason.exclusion', { count }),
        },
        now,
      );
      if (!reply.ok) return refused(c, found.id, reply.error);
      await announceForfeit(discord, reply, actor.user.id);
      return back(c, found.id, `staff=${DONE.forfeit}`);
    }

    if (what === 'moss-hold' || what === 'moss-release') {
      const reply = setMossHold(
        db,
        actor,
        { matchId: found.id, hold: what === 'moss-hold', reason: field(form, 'reason') },
        now,
      );
      if (!reply.ok) return refused(c, found.id, reply.error);
      return back(c, found.id, `staff=${DONE[what]}`);
    }

    if (what === 'time') {
      // Read in the league's own time zone, as the teams' proposals are.
      const time = readMatchTime(db, actor, field(form, 'date'), field(form, 'time'));
      if (!time.ok) return refused(c, found.id, time.error);
      const reply = setMatchTime(db, actor, { matchId: found.id, at: time.at }, now);
      if (!reply.ok) return refused(c, found.id, reply.error);
      await announceMatchTime(discord, reply);
      return back(c, found.id, `staff=${DONE.time}`);
    }

    const evidence = field(form, 'evidence');
    const report = {
      matchId: found.id,
      // The report staff looked at: a newer one makes the click stale.
      evidenceId: ROW_ID.test(evidence) ? Number(evidence) : -1,
    };
    const reply =
      what === 'validate'
        ? validateResult(db, actor, { ...report, waiver: field(form, 'waiver') }, now)
        : what === 'reject'
          ? rejectResult(db, actor, report, now)
          : voidMatch(db, actor, { matchId: found.id, reason: field(form, 'reason') }, now);
    if (!reply.ok) return refused(c, found.id, reply.error);
    await announceReportDecision(discord, reply, actor.user.id);
    return back(c, found.id, `staff=${DONE[what]}`);
  });

  return { panel };
}
