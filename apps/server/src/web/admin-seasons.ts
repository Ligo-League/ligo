import type { Context, Hono } from 'hono';
import { t } from '../i18n/index.ts';
import { openCompetition } from '../services/admin-competitions.ts';
import { divisionAdmin, saveDivision } from '../services/admin-divisions.ts';
import {
  advanceSeason,
  createSeason,
  seasonAdmin,
  updateSeason,
} from '../services/admin-seasons.ts';
import type { OrgUser } from '../services/orgs.ts';
import type { SettingErrors } from '../services/settings-form.ts';
import type { Env, Viewer } from './app.ts';
import { divisionPageView, type DivisionPageData } from './pages/admin-division.ts';
import {
  SEASON_DONE,
  seasonNewView,
  seasonPageView,
  type SeasonPageData,
} from './pages/admin-season.ts';
import type { RouteKit } from './route-kit.ts';
import { staffCompetitions } from './roles.ts';

// Seasons in the admin panel (phase 3h; design doc section 7, M-40), for the organisation's owner
// and the competition's staff, whose staff role is asked of Discord again on every request:
// `/admin/:org/:comp/seasons/new`, then `/admin/:org/:comp/seasons/:id` with its status form,
// and its divisions at `…/seasons/:id/divisions/new` and `…/seasons/:id/divisions/:division`.

const userOf = (viewer: Viewer): OrgUser => ({
  playerId: viewer.playerId,
  discordUserId: viewer.discordUserId,
});
/** Every input as typed, the CSRF token aside; the services read only their own. */
const typedOf = (form: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(form).flatMap(([name, value]) =>
      typeof value === 'string' && name !== '_csrf' ? [[name, value]] : [],
    ),
  );
const EMPTY = { name: '', starts_on: '', ends_on: '' };

export function adminSeasonRoutes(app: Hono<Env>, kit: RouteKit): void {
  const { deps, render, notFound, forbidden, guard } = kit;
  const { db, locale } = deps;
  const toLogin = (c: Context<Env>) =>
    c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);
  const staffIds = async (viewer: Viewer) =>
    (await staffCompetitions(db, deps.roles, viewer, deps.now())).map((entry) => entry.id);
  const seasonIdOf = (c: Context<Env>) => {
    const id = c.req.param('id') ?? '';
    return /^\d{1,9}$/.test(id) ? Number(id) : null;
  };

  const showNew = async (
    c: Context<Env>,
    viewer: Viewer,
    typed: { values: Record<string, string>; errors: SettingErrors },
  ) => {
    const access = openCompetition(
      db,
      userOf(viewer),
      c.req.param('org') ?? '',
      c.req.param('comp') ?? '',
      await staffIds(viewer),
    );
    if (!access.ok) return access.error === 'not_found' ? notFound(c) : forbidden(c);
    c.header('Cache-Control', 'private, no-store');
    return render(
      c,
      seasonNewView(locale, {
        org: access.orgRow,
        competition: access.row,
        typed,
        csrf: viewer.csrf,
      }),
      Object.keys(typed.errors).length > 0 ? 400 : 200,
    );
  };

  app.get('/admin/:org/:comp/seasons/new', (c) => {
    const viewer = c.get('viewer');
    if (!deps.login) return notFound(c);
    if (!viewer) return toLogin(c);
    return showNew(c, viewer, { values: EMPTY, errors: {} });
  });

  app.post('/admin/:org/:comp/seasons/new', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const orgSlug = c.req.param('org');
    const compSlug = c.req.param('comp');
    const typed = { ...EMPTY, ...typedOf(form) };
    const reply = createSeason(
      db,
      userOf(viewer),
      { orgSlug, compSlug, staffIds: await staffIds(viewer) },
      typed,
      deps.now(),
    );
    if (reply.ok) {
      return c.redirect(
        `/admin/${orgSlug}/${compSlug}/seasons/${String(reply.id)}?done=created`,
        303,
      );
    }
    if (reply.error !== 'invalid') return reply.error === 'not_found' ? notFound(c) : forbidden(c);
    return showNew(c, viewer, { values: typed, errors: reply.errors });
  });

  const show = async (
    c: Context<Env>,
    viewer: Viewer,
    extra: Pick<SeasonPageData, 'typed' | 'done'>,
  ) => {
    const seasonId = seasonIdOf(c);
    if (seasonId === null) return notFound(c);
    const view = seasonAdmin(
      db,
      userOf(viewer),
      c.req.param('org') ?? '',
      c.req.param('comp') ?? '',
      seasonId,
      await staffIds(viewer),
    );
    if (!view.ok) return view.error === 'not_found' ? notFound(c) : forbidden(c);
    c.header('Cache-Control', 'private, no-store');
    return render(
      c,
      seasonPageView(locale, { view, csrf: viewer.csrf, ...extra }),
      extra.typed ? 400 : 200,
    );
  };

  app.get('/admin/:org/:comp/seasons/:id', async (c) => {
    const viewer = c.get('viewer');
    if (!deps.login) return notFound(c);
    if (!viewer) return toLogin(c);
    const done = SEASON_DONE.find((entry) => entry === c.req.query('done')) ?? null;
    return show(c, viewer, { typed: null, done });
  });

  /** The key of the season in the address, or null when the ID is not a number. */
  const keyOf = async (c: Context<Env>, viewer: Viewer) => {
    const seasonId = seasonIdOf(c);
    if (seasonId === null) return null;
    return {
      orgSlug: c.req.param('org') ?? '',
      compSlug: c.req.param('comp') ?? '',
      seasonId,
      staffIds: await staffIds(viewer),
    };
  };
  const pageOf = (key: { orgSlug: string; compSlug: string; seasonId: number }) =>
    `/admin/${key.orgSlug}/${key.compSlug}/seasons/${String(key.seasonId)}`;

  app.post('/admin/:org/:comp/seasons/:id', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const key = await keyOf(c, viewer);
    if (!key) return notFound(c);
    const typed = typedOf(form);
    const reply = updateSeason(db, userOf(viewer), key, typed, deps.now());
    if (reply.ok) return c.redirect(`${pageOf(key)}?done=saved`, 303);
    if (reply.error !== 'invalid') return reply.error === 'not_found' ? notFound(c) : forbidden(c);
    return show(c, viewer, { typed: { values: typed, errors: reply.errors }, done: null });
  });

  app.post('/admin/:org/:comp/seasons/:id/status', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const key = await keyOf(c, viewer);
    if (!key) return notFound(c);
    const status = typeof form.status === 'string' ? form.status : '';
    const reply = advanceSeason(db, userOf(viewer), key, status, deps.now());
    if (reply.ok) return c.redirect(`${pageOf(key)}?done=status`, 303);
    if (reply.error === 'not_found') return notFound(c);
    if (reply.error === 'not_allowed') return forbidden(c);
    // A status already passed (two tabs, say): the page shows where the season is.
    return c.redirect(pageOf(key), 303);
  });

  /** The season and division in the address; null when an ID is not a number. */
  const divisionKeyOf = async (c: Context<Env>, viewer: Viewer) => {
    const key = await keyOf(c, viewer);
    const raw = c.req.param('division') ?? 'new';
    if (!key || (raw !== 'new' && !/^\d{1,9}$/.test(raw))) return null;
    return { ...key, divisionId: raw === 'new' ? null : Number(raw) };
  };

  const showDivision = async (
    c: Context<Env>,
    viewer: Viewer,
    extra: Pick<DivisionPageData, 'typed' | 'saved'>,
  ) => {
    const key = await divisionKeyOf(c, viewer);
    if (!key) return notFound(c);
    const view = divisionAdmin(db, userOf(viewer), key);
    if (!view.ok) return view.error === 'not_found' ? notFound(c) : forbidden(c);
    let channels: DivisionPageData['channels'] = null;
    if (view.guildId !== null) {
      try {
        channels = await deps.gateway.guildTextChannels(view.guildId);
      } catch {
        channels = null;
      }
    }
    c.header('Cache-Control', 'private, no-store');
    return render(
      c,
      divisionPageView(locale, { view, channels, csrf: viewer.csrf, ...extra }),
      extra.typed ? 400 : 200,
    );
  };

  const divisionPaths = [
    '/admin/:org/:comp/seasons/:id/divisions/new',
    '/admin/:org/:comp/seasons/:id/divisions/:division',
  ];
  for (const path of divisionPaths) {
    app.get(path, async (c) => {
      const viewer = c.get('viewer');
      if (!deps.login) return notFound(c);
      if (!viewer) return toLogin(c);
      return showDivision(c, viewer, { typed: null, saved: c.req.query('done') === 'saved' });
    });

    app.post(path, async (c) => {
      const guarded = await guard(c);
      if (guarded instanceof Response) return guarded;
      const { viewer, form } = guarded;
      const key = await divisionKeyOf(c, viewer);
      if (!key) return notFound(c);
      const typed = typedOf(form);
      const reply = await saveDivision(
        db,
        deps.gateway,
        userOf(viewer),
        key,
        typed,
        (division) => t(locale, 'league.channel.notice.resultsDivision', { division }),
        deps.now(),
      );
      if (reply.ok) {
        return c.redirect(`${pageOf(key)}/divisions/${String(reply.id)}?done=saved`, 303);
      }
      if (reply.error !== 'invalid') {
        return reply.error === 'not_found' ? notFound(c) : forbidden(c);
      }
      return showDivision(c, viewer, {
        typed: { values: typed, errors: reply.errors },
        saved: false,
      });
    });
  }
}
