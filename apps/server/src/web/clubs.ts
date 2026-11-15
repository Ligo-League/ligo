import { ROSTER_COLORS_MAX } from '@ligo/core';
import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { t } from '../i18n/index.ts';
import { addRoster, clubsRunBy, createClub, creationChoices } from '../services/clubs.ts';
import { LOGO_MAX_BYTES } from '../services/logo.ts';
import type { Env } from './app.ts';
import {
  clubNewPage,
  EMPTY_CLUB_VALUES,
  rosterNewPage,
  type ClubValues,
} from './pages/club-new.ts';
import { messagePage } from './pages/errors.ts';
import type { RouteKit } from './route-kit.ts';

// Creating a club and its rosters, in no competition (M-33). Anyone logged in creates a club
// and owns it; its owner and managers add rosters. Registered before `/clubs/:slug`, which would
// otherwise read "new" as a club's name.

export function clubRoutes(app: Hono<Env>, kit: RouteKit): void {
  const { deps, render, notFound, forbidden, guard } = kit;
  const { db, locale } = deps;

  const toLogin = (c: Context<Env>) =>
    c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);
  // The logo is at most 1 MB; the rest of the form is small. A larger body is refused before it
  // is read.
  const limit = bodyLimit({
    maxSize: LOGO_MAX_BYTES + 64 * 1024,
    // bodyLimit types its context loosely: it is this app's own.
    onError: (c: Context<Env>) =>
      render(
        c,
        messagePage(
          locale,
          t(locale, 'web.register.tooBig.title'),
          t(locale, 'web.register.tooBig.body'),
        ),
        413,
      ),
  });

  /** What the form sent, as typed, and its logo. */
  async function readForm(form: Record<string, unknown>) {
    const text = (key: string) => (typeof form[key] === 'string' ? form[key] : '');
    const values: ClubValues = {
      orgId: text('org'),
      title: text('title'),
      clubName: text('club_name'),
      clubCity: text('club_city'),
      clubLegalStatus: text('club_legal_status'),
      clubSocials: text('club_socials').replaceAll('\r\n', '\n'),
      clubDiscord: text('club_discord'),
      rosterName: text('roster_name'),
      tag: text('roster_tag'),
      // Disabled pickers are not sent: the colours are the places that were, in order.
      colors: Array.from({ length: ROSTER_COLORS_MAX }, (_, index) =>
        text(`color_${index + 1}`),
      ).filter((color) => color.trim() !== ''),
      canStream: text('can_stream') === '1',
    };
    const upload = form.logo;
    const logo =
      upload instanceof File && upload.size > 0 ? new Uint8Array(await upload.arrayBuffer()) : null;
    const roster = {
      name: values.rosterName,
      tag: values.tag,
      colors: values.colors,
      canStream: values.canStream,
    };
    return { values, logo, roster };
  }

  app.get('/clubs/new', (c) => {
    if (!deps.login) return notFound(c);
    const viewer = c.get('viewer');
    if (!viewer) return toLogin(c);
    return render(
      c,
      clubNewPage(locale, {
        groups: creationChoices(db),
        values: EMPTY_CLUB_VALUES,
        errors: [],
        csrf: viewer.csrf,
      }),
    );
  });

  app.post('/clubs/new', limit, async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const { values, logo, roster } = await readForm(form);
    const reply = await createClub(
      db,
      deps.assets,
      viewer.playerId,
      {
        orgId: /^\d{1,10}$/.test(values.orgId) ? Number(values.orgId) : -1,
        title: values.title,
        club: {
          name: values.clubName,
          city: values.clubCity,
          legalStatus: values.clubLegalStatus,
          socials: values.clubSocials,
          discordUrl: values.clubDiscord,
        },
        roster,
        logo,
      },
      deps.now(),
    );
    if (reply.ok) return c.redirect(`/teams/${reply.teamSlug}/manage?done=created`, 303);
    return render(
      c,
      clubNewPage(locale, {
        groups: creationChoices(db),
        values,
        errors: reply.errors,
        csrf: viewer.csrf,
      }),
      400,
    );
  });

  /** The club and the games its group plays, for its own officials only. */
  const clubToGrow = async (c: Context<Env>, playerId: number) => {
    const found = db
      .select()
      .from(schema.club)
      .where(eq(schema.club.slug, c.req.param('slug') ?? ''))
      .get();
    if (!found) return notFound(c);
    if (!clubsRunBy(db, playerId, found.orgId).some((entry) => entry.id === found.id)) {
      return forbidden(c);
    }
    const titles = creationChoices(db).find((entry) => entry.id === found.orgId)?.titles ?? [];
    return { club: { name: found.name, slug: found.slug }, titles };
  };

  app.get('/clubs/:slug/rosters/new', async (c) => {
    if (!deps.login) return notFound(c);
    const viewer = c.get('viewer');
    if (!viewer) return toLogin(c);
    const found = await clubToGrow(c, viewer.playerId);
    if (found instanceof Response) return found;
    return render(
      c,
      rosterNewPage(locale, {
        ...found,
        values: EMPTY_CLUB_VALUES,
        errors: [],
        csrf: viewer.csrf,
      }),
    );
  });

  app.post('/clubs/:slug/rosters', limit, async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const found = await clubToGrow(c, viewer.playerId);
    if (found instanceof Response) return found;
    const { values, logo, roster } = await readForm(form);
    const reply = await addRoster(
      db,
      deps.assets,
      viewer.playerId,
      found.club.slug,
      { title: values.title, roster, logo },
      deps.now(),
    );
    if (reply.ok) return c.redirect(`/teams/${reply.teamSlug}/manage?done=created`, 303);
    if (!('errors' in reply)) return reply.error === 'not_found' ? notFound(c) : forbidden(c);
    return render(
      c,
      rosterNewPage(locale, { ...found, values, errors: reply.errors, csrf: viewer.csrf }),
      400,
    );
  });
}
