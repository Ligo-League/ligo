import { schema } from '@ligo/db';
import { asc, eq, inArray } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { LOGO_MAX_BYTES } from '../services/logo.ts';
import {
  checkOrgInvite,
  createOrg,
  handOverOrg,
  orgAdmin,
  ownedOrgs,
  setOrgLogo,
  updateOrg,
  type OrgUser,
} from '../services/orgs.ts';
import { competitionPath } from '../services/paths.ts';
import type { Env, Viewer } from './app.ts';
import {
  adminHomeView,
  inviteError,
  isOrgPageError,
  ORG_DONE,
  orgNewView,
  orgPageView,
  type OrgFlash,
  type OrgPageData,
} from './pages/admin-orgs.ts';
import type { RouteKit } from './route-kit.ts';
import { staffCompetitions } from './roles.ts';

// The admin panel's organisation pages (phase 3h; design doc section 7, M-20): `/admin`,
// `/orgs/new` for whoever may manage a Discord server where the bot is, and `/admin/:org` for
// the organisation's owner. Every route asks who the viewer is again; the service checks the
// owner on every change.

const text = (form: Record<string, unknown>, key: string) =>
  typeof form[key] === 'string' ? form[key] : '';
const userOf = (viewer: Viewer): OrgUser => ({
  playerId: viewer.playerId,
  discordUserId: viewer.discordUserId,
});

function flashOf(c: Context<Env>): OrgFlash {
  const done = ORG_DONE.find((entry) => entry === c.req.query('done'));
  if (done) return { done };
  const error = c.req.query('error');
  return isOrgPageError(error) ? { error } : null;
}

export function adminOrgRoutes(app: Hono<Env>, kit: RouteKit): void {
  const { deps, render, notFound, forbidden, guard } = kit;
  const { db, locale } = deps;
  const toLogin = (c: Context<Env>) =>
    c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);
  // The logo is at most 1 MB; a larger body is refused before it is read.
  const limit = bodyLimit({ maxSize: LOGO_MAX_BYTES + 64 * 1024 });

  /** Whether Discord says the viewer may manage a server where the bot is; null if it did not. */
  const managesAServer = async (viewer: Viewer): Promise<boolean | null> => {
    if (viewer.discordUserId === null) return false;
    try {
      return (await deps.gateway.manageableGuilds(viewer.discordUserId)).length > 0;
    } catch {
      return null;
    }
  };

  app.get('/admin', async (c) => {
    const viewer = c.get('viewer');
    if (!deps.login) return notFound(c);
    if (!viewer) return toLogin(c);
    const staffIds = (await staffCompetitions(db, deps.roles, viewer, deps.now())).map(
      (entry) => entry.id,
    );
    const staff =
      staffIds.length === 0
        ? []
        : db
            .select({
              name: schema.competition.name,
              slug: schema.competition.slug,
              org: schema.org.slug,
            })
            .from(schema.competition)
            .innerJoin(schema.org, eq(schema.competition.orgId, schema.org.id))
            .where(inArray(schema.competition.id, staffIds))
            .orderBy(asc(schema.competition.name))
            .all()
            .map((row) => ({ name: row.name, path: competitionPath(row.org, row.slug) }));
    c.header('Cache-Control', 'private, no-store');
    return render(c, adminHomeView(locale, { owned: ownedOrgs(db, userOf(viewer)), staff }));
  });

  const EMPTY = { name: '', slug: '', locale: deps.locale, description: '' };

  app.get('/orgs/new', async (c) => {
    const viewer = c.get('viewer');
    if (!deps.login) return notFound(c);
    if (!viewer) return toLogin(c);
    c.header('Cache-Control', 'private, no-store');
    return render(
      c,
      orgNewView(locale, {
        values: EMPTY,
        errors: {},
        managesAServer: await managesAServer(viewer),
        botInstallUrl: deps.botInstallUrl,
        csrf: viewer.csrf,
      }),
    );
  });

  app.post('/orgs/new', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const values = {
      name: text(form, 'name'),
      slug: text(form, 'slug'),
      locale: text(form, 'locale'),
      description: text(form, 'description').replaceAll('\r\n', '\n'),
    };
    const manages = await managesAServer(viewer);
    const reply = createOrg(
      db,
      userOf(viewer),
      values,
      { managesAServer: manages === true },
      deps.now(),
    );
    if (reply.ok) return c.redirect(`/admin/${reply.slug}?done=created`, 303);
    return render(
      c,
      orgNewView(locale, {
        values,
        errors: reply.errors,
        managesAServer: manages,
        botInstallUrl: deps.botInstallUrl,
        csrf: viewer.csrf,
      }),
      400,
    );
  });

  const showOrg = (
    c: Context<Env>,
    viewer: Viewer,
    slug: string,
    extra: Pick<OrgPageData, 'flash' | 'typed'>,
  ) => {
    const view = orgAdmin(db, userOf(viewer), slug);
    if (!view.ok) return view.error === 'not_found' ? notFound(c) : forbidden(c);
    c.header('Cache-Control', 'private, no-store');
    return render(
      c,
      orgPageView(locale, { view, csrf: viewer.csrf, ...extra }),
      extra.typed ? 400 : 200,
    );
  };
  const back = (c: Context<Env>, slug: string, query: string) =>
    c.redirect(`/admin/${slug}?${query}`, 303);

  app.get('/admin/:org', (c) => {
    const viewer = c.get('viewer');
    if (!deps.login) return notFound(c);
    if (!viewer) return toLogin(c);
    return showOrg(c, viewer, c.req.param('org'), { flash: flashOf(c), typed: null });
  });

  app.post('/admin/:org', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const slug = c.req.param('org');
    const values = {
      name: text(form, 'name'),
      locale: text(form, 'locale'),
      description: text(form, 'description').replaceAll('\r\n', '\n'),
      inviteUrl: text(form, 'invite_url'),
    };
    // Owner first: Discord is asked about the invitation only for the organisation's owner.
    const view = orgAdmin(db, userOf(viewer), slug);
    if (!view.ok) return view.error === 'not_found' ? notFound(c) : forbidden(c);
    const problem =
      values.inviteUrl.trim() === view.org.inviteUrl
        ? null
        : await checkOrgInvite(deps.gateway, values.inviteUrl);
    if (problem === 'discord_unavailable' || problem === 'expires') {
      return showOrg(c, viewer, slug, {
        flash: { error: inviteError(problem) },
        typed: { values, errors: {} },
      });
    }
    const reply =
      problem === 'invalid'
        ? {
            ok: false as const,
            error: 'invalid' as const,
            errors: { inviteUrl: 'invalid' as const },
          }
        : updateOrg(db, userOf(viewer), slug, values, deps.now());
    if (reply.ok) return back(c, slug, 'done=saved');
    if (reply.error !== 'invalid') return forbidden(c);
    return showOrg(c, viewer, slug, { flash: null, typed: { values, errors: reply.errors } });
  });

  app.post('/admin/:org/logo', limit, async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const slug = c.req.param('org');
    const upload = guarded.form.logo;
    if (!(upload instanceof File) || upload.size === 0) return back(c, slug, 'error=invalid_logo');
    const reply = await setOrgLogo(
      db,
      deps.assets,
      userOf(guarded.viewer),
      slug,
      new Uint8Array(await upload.arrayBuffer()),
      deps.now(),
    );
    if (reply.ok) return back(c, slug, 'done=logo');
    if (reply.error === 'not_found') return notFound(c);
    if (reply.error === 'not_owner') return forbidden(c);
    return back(c, slug, `error=${reply.error}`);
  });

  app.post('/admin/:org/owner', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const slug = c.req.param('org');
    if (text(guarded.form, 'confirm') !== '1') return back(c, slug, 'error=confirm');
    const reply = handOverOrg(
      db,
      userOf(guarded.viewer),
      slug,
      text(guarded.form, 'owner'),
      deps.now(),
    );
    if (reply.ok) return c.redirect('/admin', 303);
    if (reply.error === 'not_found') return notFound(c);
    if (reply.error === 'not_owner') return forbidden(c);
    return back(c, slug, `error=${reply.error}`);
  });
}
