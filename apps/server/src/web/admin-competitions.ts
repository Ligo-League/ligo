import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import {
  competitionAdmin,
  createCompetition,
  GENERAL_FIELDS,
  updateCompetitionGeneral,
} from '../services/admin-competitions.ts';
import type { OrgUser } from '../services/orgs.ts';
import type { Env, Viewer } from './app.ts';
import {
  COMPETITION_DONE,
  competitionNewView,
  competitionPageView,
  type CompetitionPageData,
} from './pages/admin-competition.ts';
import type { RouteKit } from './route-kit.ts';
import { staffCompetitions } from './roles.ts';

// Competitions in the admin panel (phase 3h; design doc section 7, M-20): `/admin/:org/new` for
// the organisation's owner, `/admin/:org/:comp` for the owner and the competition's staff, whose
// staff role is asked of Discord again on every request.

const text = (form: Record<string, unknown>, key: string) =>
  typeof form[key] === 'string' ? form[key] : '';
const userOf = (viewer: Viewer): OrgUser => ({
  playerId: viewer.playerId,
  discordUserId: viewer.discordUserId,
});

export function adminCompetitionRoutes(app: Hono<Env>, kit: RouteKit): void {
  const { deps, render, notFound, forbidden, guard } = kit;
  const { db, locale } = deps;
  const toLogin = (c: Context<Env>) =>
    c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);

  /** The organisation, for its owner only. */
  const ownedOrg = (viewer: Viewer, slug: string) => {
    const row = db.select().from(schema.org).where(eq(schema.org.slug, slug)).get();
    if (!row) return 'not_found' as const;
    return viewer.discordUserId !== null && row.ownerDiscordUserId === viewer.discordUserId
      ? row
      : ('not_owner' as const);
  };
  const EMPTY = { title: 'r6', name: '', slug: '', participantMode: 'team' };

  app.get('/admin/:org/new', (c) => {
    const viewer = c.get('viewer');
    if (!deps.login) return notFound(c);
    if (!viewer) return toLogin(c);
    const org = ownedOrg(viewer, c.req.param('org'));
    if (org === 'not_found') return notFound(c);
    if (org === 'not_owner') return forbidden(c);
    c.header('Cache-Control', 'private, no-store');
    return render(
      c,
      competitionNewView(locale, { org, values: EMPTY, errors: {}, csrf: viewer.csrf }),
    );
  });

  app.post('/admin/:org/new', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const orgSlug = c.req.param('org');
    const values = {
      title: text(form, 'title'),
      name: text(form, 'name'),
      slug: text(form, 'slug'),
      participantMode: text(form, 'participant_mode'),
    };
    const reply = createCompetition(db, userOf(viewer), orgSlug, values, deps.now());
    if (reply.ok) return c.redirect(`/admin/${orgSlug}/${reply.slug}?done=created`, 303);
    if ('error' in reply) return reply.error === 'not_found' ? notFound(c) : forbidden(c);
    const org = ownedOrg(viewer, orgSlug);
    if (typeof org === 'string') return forbidden(c);
    return render(
      c,
      competitionNewView(locale, { org, values, errors: reply.errors, csrf: viewer.csrf }),
      400,
    );
  });

  /** The competitions whose staff role the viewer holds now, by ID. */
  const staffIds = async (viewer: Viewer) =>
    (await staffCompetitions(db, deps.roles, viewer, deps.now())).map((entry) => entry.id);

  const show = async (
    c: Context<Env>,
    viewer: Viewer,
    extra: Pick<CompetitionPageData, 'typed' | 'done'>,
  ) => {
    const view = competitionAdmin(
      db,
      userOf(viewer),
      c.req.param('org') ?? '',
      c.req.param('comp') ?? '',
      await staffIds(viewer),
    );
    if (!view.ok) return view.error === 'not_found' ? notFound(c) : forbidden(c);
    c.header('Cache-Control', 'private, no-store');
    return render(
      c,
      competitionPageView(locale, { view, csrf: viewer.csrf, ...extra }),
      extra.typed ? 400 : 200,
    );
  };

  app.get('/admin/:org/:comp', async (c) => {
    const viewer = c.get('viewer');
    if (!deps.login) return notFound(c);
    if (!viewer) return toLogin(c);
    const done = COMPETITION_DONE.find((entry) => entry === c.req.query('done')) ?? null;
    return show(c, viewer, { typed: null, done });
  });

  app.post('/admin/:org/:comp', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const orgSlug = c.req.param('org');
    const compSlug = c.req.param('comp');
    const typed = Object.fromEntries(
      GENERAL_FIELDS.map((field) => [field.path, text(form, field.path)]),
    );
    const reply = updateCompetitionGeneral(
      db,
      userOf(viewer),
      { orgSlug, compSlug, staffIds: await staffIds(viewer) },
      typed,
      deps.now(),
    );
    if (reply.ok) return c.redirect(`/admin/${orgSlug}/${compSlug}?done=saved`, 303);
    if (reply.error !== 'invalid') return reply.error === 'not_found' ? notFound(c) : forbidden(c);
    return show(c, viewer, { typed: { values: typed, errors: reply.errors }, done: null });
  });
}
