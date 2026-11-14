import { readFile } from 'node:fs/promises';
import { ROSTER_COLORS_MAX, zonedDate, type FieldErrors } from '@ligo/core';
import { findLeague, listLeagueMatches, schema, type Db } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { R6_RANKS } from '@ligo/titles';
import type { EvidenceStore } from '../assets/evidence-store.ts';
import type { AssetStore } from '../assets/store.ts';
import type { DiscordGateway } from '../discord/gateway.ts';
import { announceReportDecision, announceRequestDecision } from '../discord/staff-decisions.ts';
import { t, type Locale, type MessageKey } from '../i18n/index.ts';
import { evidenceCompetition, openEvidence } from '../services/evidence.ts';
import { gameProfileOf, saveGameProfile, type SaveProfileError } from '../services/game-profile.ts';
import { LOGO_MAX_BYTES } from '../services/logo.ts';
import {
  fileRegistration,
  registrationForm,
  registrationStatus,
  type RegistrationFieldError,
} from '../services/registrations.ts';
import {
  countryChoices,
  loginPlayer,
  profileOf,
  setNationality,
  setStatsConsent,
} from '../services/me.ts';
import { rejectResult, validateResult } from '../services/reports.ts';
import { answerRequest } from '../services/requests.ts';
import { requireStaff } from '../services/permissions.ts';
import { publishRules, rulesPage } from '../services/rules.ts';
import { clubPage, listLeagues, matchPage, seasonPage, teamPage } from '../services/site.ts';
import { staffQueue } from '../services/staff-queue.ts';
import { layout, type Page } from './layout.ts';
import { clubPageView } from './pages/club.ts';
import { errorPage, messagePage, notFoundPage } from './pages/errors.ts';
import { homePage } from './pages/home.ts';
import { matchPageView } from './pages/match.ts';
import { mePage } from './pages/me.ts';
import {
  EMPTY_REGISTER_VALUES,
  gameProfileForm,
  registerFormView,
  registrationView,
  type RegisterValues,
} from './pages/register.ts';
import { inviteUrl } from './invites.ts';
import { rulesFormView, rulesPageView, type RulesFormValues } from './pages/rules.ts';
import { seasonPageView } from './pages/season.ts';
import { staffPage } from './pages/staff.ts';
import { teamPageView } from './pages/team.ts';
import { staffCompetitions, webActor, type RoleReader, type WebUser } from './roles.ts';
import {
  checkCsrfToken,
  csrfToken,
  endSession,
  finishLogin,
  readSession,
  safeNext,
  startLogin,
  startSession,
  type LoginSettings,
  type Session,
} from './session.ts';

// The website (design doc section 7): server-rendered pages over the same services as the bot.
// Routes are thin: they read the request, call a service and render its answer.

/** Files the pages load, read once when the server starts. */
export interface StaticFiles {
  css: string;
  htmx: string;
  /** The registration form's "add a colour" button. */
  colors: string;
}

export interface WebDeps {
  db: Db;
  assets: AssetStore;
  /** The server's copies of match evidence: shown to staff, never public. */
  evidence: EvidenceStore;
  locale: Locale;
  files: StaticFiles;
  logger: { error: (details: object, message: string) => void };
  /** Discord login; null leaves the site public only (no secrets in .env). */
  login: LoginSettings | null;
  /** League staff roles, asked of the bot. */
  roles: RoleReader;
  /** The bot's Discord: decisions taken here mark its posts in the staff queue. */
  gateway: DiscordGateway;
  now: () => number;
}

/** The stylesheet next to this file, and htmx at the version pinned in package.json. */
export async function loadStaticFiles(): Promise<StaticFiles> {
  const [css, htmx, colors] = await Promise.all([
    readFile(new URL('./static/site.css', import.meta.url), 'utf8'),
    readFile(new URL(import.meta.resolve('htmx.org/dist/htmx.min.js')), 'utf8'),
    readFile(new URL('./static/colors.js', import.meta.url), 'utf8'),
  ]);
  return { css, htmx, colors };
}

interface Viewer extends WebUser {
  session: Session;
  csrf: string;
}

type Env = { Variables: { viewer: Viewer | null } };

const LOGO_FILE = /^([a-z0-9][a-z0-9_-]{0,63})\.png$/;
const MATCH_ID = /^[1-9]\d{0,9}$/;
const ROW_ID = MATCH_ID;

// What a staff decision sends back to `/staff` with, read back from the address: anything else
// shows nothing.
const STAFF_DONE = ['validated', 'rejected', 'approved', 'rejected_request'] as const;
const STAFF_ERRORS = [
  'match_not_found',
  'stale',
  'wrong_status',
  'not_found',
  'not_pending',
  'reason_required',
  'already_on_team',
  'not_on_team',
  'owner_cannot_leave',
  'role_full',
] as const;
const oneOf = <T extends string>(values: readonly T[], value: string | undefined): T | null =>
  values.find((candidate) => candidate === value) ?? null;
// Pages show live data; static files change only with a release.
const STATIC_CACHE = 'public, max-age=3600';
// Scripts and styles from this site only; inline style attributes carry team colours.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

export function createWebApp(deps: WebDeps): Hono<Env> {
  const { db, locale, login } = deps;
  const app = new Hono<Env>();

  const render = (
    c: Context<Env>,
    page: Page,
    status: 200 | 400 | 403 | 404 | 413 | 500 | 502 = 200,
  ) => {
    const viewer = c.get('viewer');
    const nav = {
      user: viewer && { name: viewer.name, csrf: viewer.csrf },
      login: login !== null,
      path: c.req.path,
    };
    return c.html(layout(locale, page, nav), status);
  };
  const notFound = (c: Context<Env>) => render(c, notFoundPage(locale), 404);
  const message = (
    c: Context<Env>,
    status: 400 | 403 | 502,
    title: Parameters<typeof t>[1],
    text: Parameters<typeof t>[1],
  ) => render(c, messagePage(locale, t(locale, title), t(locale, text)), status);
  const forbidden = (c: Context<Env>) =>
    message(c, 403, 'web.forbidden.title', 'web.forbidden.body');

  app.use(async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'same-origin');
    c.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  });

  // With login on, one address only: cookies and the origin check belong to PUBLIC_URL, so
  // `127.0.0.1:3000` goes to `localhost:3000`.
  app.use(async (c, next) => {
    if (!login) return next();
    const url = new URL(c.req.url);
    if (url.origin === login.publicUrl.origin) return next();
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return forbidden(c);
    return c.redirect(new URL(url.pathname + url.search, login.publicUrl).href, 308);
  });

  // Who is looking: re-read from the database on every request.
  app.use(async (c, next) => {
    c.set('viewer', null);
    const session = login && (await readSession(c, login, deps.now()));
    const found =
      login && session
        ? db
            .select({
              id: schema.player.id,
              name: schema.player.displayName,
              discordUserId: schema.player.discordUserId,
            })
            .from(schema.player)
            .where(eq(schema.player.id, session.playerId))
            .get()
        : undefined;
    if (login && session && found) {
      c.set('viewer', {
        playerId: found.id,
        name: found.name,
        discordUserId: found.discordUserId,
        session,
        csrf: csrfToken(login, session),
      });
    }
    return next();
  });

  /**
   * Every POST: from this site (its Origin, or Sec-Fetch-Site for browsers that send none),
   * by a logged-in user, with the token of their session. Returns the form, or the refusal.
   */
  const guard = async (
    c: Context<Env>,
  ): Promise<{ viewer: Viewer; form: Record<string, unknown> } | Response> => {
    const viewer = c.get('viewer');
    if (!login) return notFound(c);
    const origin = c.req.header('origin');
    const sameSite =
      origin === undefined
        ? c.req.header('sec-fetch-site') === 'same-origin'
        : origin === login.publicUrl.origin;
    if (!sameSite || !viewer) return forbidden(c);
    const form = await c.req.parseBody();
    if (!checkCsrfToken(login, viewer.session, form._csrf)) return forbidden(c);
    return { viewer, form };
  };

  app.get('/static/site.css', (c) =>
    c.body(deps.files.css, 200, {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': STATIC_CACHE,
    }),
  );
  app.get('/static/htmx.min.js', (c) =>
    c.body(deps.files.htmx, 200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': STATIC_CACHE,
    }),
  );
  app.get('/static/colors.js', (c) =>
    c.body(deps.files.colors, 200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': STATIC_CACHE,
    }),
  );
  app.get('/logos/:file', async (c) => {
    const name = LOGO_FILE.exec(c.req.param('file'))?.[1];
    const image = name ? await deps.assets.read(`logos/${name}.png`) : null;
    if (!image) return notFound(c);
    return c.body(new Uint8Array(image.data), 200, {
      'Content-Type': image.type,
      'Cache-Control': STATIC_CACHE,
    });
  });

  // -------------------------------------------------------------------------------------------
  // Public pages

  app.get('/', (c) => render(c, homePage(locale, listLeagues(db))));

  // -------------------------------------------------------------------------------------------
  // The rulebook. Registered before `/c/:competition/:season`, which would read `rules` as a
  // season.

  /** The viewer as staff of this competition, asked of Discord now; null for anyone else. */
  const staffOf = async (viewer: Viewer | null, competitionId: number) => {
    if (!login || !viewer) return null;
    const actor = await webActor(db, deps.roles, viewer, competitionId, deps.now());
    const staff = actor && requireStaff(db, actor);
    return staff?.ok && staff.league.competition.id === competitionId ? actor : null;
  };
  const showRules = async (c: Context<Env>, versionId: number | null) => {
    const now = deps.now();
    const page = rulesPage(db, c.req.param('competition') ?? '', now, versionId);
    if (!page.ok) return notFound(c);
    const canPublish = (await staffOf(c.get('viewer'), page.competition.id)) !== null;
    return render(c, rulesPageView(locale, page, { now, canPublish }));
  };
  app.get('/c/:competition/rules', (c) => showRules(c, null));
  app.get('/c/:competition/rules/new', async (c) => {
    if (!login) return notFound(c);
    const page = rulesPage(db, c.req.param('competition'), deps.now());
    if (!page.ok) return notFound(c);
    const viewer = c.get('viewer');
    if (!viewer) return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);
    if (!(await staffOf(viewer, page.competition.id))) return forbidden(c);
    const values: RulesFormValues = {
      // The version in force is the starting point: staff change what changed.
      version: '',
      markdown: page.shown?.markdown ?? '',
      effectiveOn: zonedDate(deps.now(), page.competition.timeZone).date,
      votedOn: '',
    };
    c.header('Cache-Control', 'no-store');
    return render(
      c,
      rulesFormView(locale, page.competition, { values, error: null, csrf: viewer.csrf }),
    );
  });
  app.get('/c/:competition/rules/:id', (c) => {
    const id = c.req.param('id');
    return ROW_ID.test(id) ? showRules(c, Number(id)) : notFound(c);
  });
  app.post('/c/:competition/rules', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const page = rulesPage(db, c.req.param('competition'), deps.now());
    if (!page.ok) return notFound(c);
    const actor = await staffOf(viewer, page.competition.id);
    if (!actor) return forbidden(c);
    const text = (key: string) => (typeof form[key] === 'string' ? form[key] : '');
    const values: RulesFormValues = {
      version: text('version'),
      // Browsers send line breaks in a form as CRLF.
      markdown: text('markdown').replaceAll('\r\n', '\n'),
      effectiveOn: text('effective_on'),
      votedOn: text('voted_on'),
    };
    const reply = publishRules(
      db,
      actor,
      {
        competitionId: page.competition.id,
        version: values.version,
        markdown: values.markdown,
        effectiveOn: values.effectiveOn,
        votedOn: values.votedOn === '' ? null : values.votedOn,
      },
      deps.now(),
    );
    if (!reply.ok) {
      if (reply.error === 'not_staff' || reply.error === 'not_linked') return forbidden(c);
      c.header('Cache-Control', 'no-store');
      return render(
        c,
        rulesFormView(locale, page.competition, { values, error: reply.error, csrf: viewer.csrf }),
        400,
      );
    }
    return c.redirect(`/c/${page.competition.slug}/rules/${String(reply.id)}`, 303);
  });

  // -------------------------------------------------------------------------------------------
  // Registration (phase 3d-4a). Registered before `/c/:competition/:season` too.

  const registrationClosed = (c: Context<Env>, error: 'not_found' | 'closed' | 'no_rules') =>
    error === 'not_found'
      ? notFound(c)
      : error === 'closed'
        ? render(
            c,
            messagePage(
              locale,
              t(locale, 'web.register.closed.title'),
              t(locale, 'web.register.closed.body'),
            ),
          )
        : render(
            c,
            messagePage(
              locale,
              t(locale, 'web.register.noRules.title'),
              t(locale, 'web.register.noRules.body'),
            ),
          );

  app.get('/c/:competition/register', (c) => {
    if (!login) return notFound(c);
    const viewer = c.get('viewer');
    if (!viewer) return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);
    const form = registrationForm(db, c.req.param('competition'), viewer.playerId, deps.now());
    if (!form.ok) return registrationClosed(c, form.error);
    c.header('Cache-Control', 'no-store');
    return render(
      c,
      registerFormView(locale, form, {
        values: { ...EMPTY_REGISTER_VALUES, clubKind: form.clubs.length > 0 ? 'existing' : 'new' },
        errors: [],
        csrf: viewer.csrf,
      }),
    );
  });

  app.post(
    '/c/:competition/register',
    // The logo is at most 1 MB; the rest of the form is small. A larger body is refused before
    // it is read.
    bodyLimit({
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
    }),
    async (c) => {
      const guarded = await guard(c);
      if (guarded instanceof Response) return guarded;
      const { viewer, form } = guarded;
      const slug = c.req.param('competition');
      const text = (key: string) => (typeof form[key] === 'string' ? form[key] : '');
      const values: RegisterValues = {
        clubKind: text('club_kind') === 'existing' ? 'existing' : 'new',
        clubId: text('club_id'),
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
        upload instanceof File && upload.size > 0
          ? new Uint8Array(await upload.arrayBuffer())
          : null;
      const reply = await fileRegistration(
        db,
        deps.evidence,
        viewer.playerId,
        slug,
        {
          club:
            values.clubKind === 'existing'
              ? {
                  kind: 'existing',
                  clubId: /^\d{1,10}$/.test(values.clubId) ? Number(values.clubId) : -1,
                }
              : {
                  kind: 'new',
                  name: values.clubName,
                  city: values.clubCity,
                  legalStatus: values.clubLegalStatus,
                  socials: values.clubSocials,
                  discordUrl: values.clubDiscord,
                },
          roster: {
            name: values.rosterName,
            tag: values.tag,
            colors: values.colors,
            canStream: values.canStream,
          },
          logo,
          rulesVersionId: Number(text('rules_version')),
          rulesAccepted: text('rules_accepted') === '1',
        },
        deps.now(),
      );
      if (reply.ok) return c.redirect(`/registrations/${String(reply.id)}`, 303);
      if (!('errors' in reply)) return registrationClosed(c, reply.error);
      const form2 = registrationForm(db, slug, viewer.playerId, deps.now());
      if (!form2.ok) return registrationClosed(c, form2.error);
      c.header('Cache-Control', 'no-store');
      return render(
        c,
        registerFormView(locale, form2, {
          values,
          errors: reply.errors satisfies FieldErrors<RegistrationFieldError>,
          csrf: viewer.csrf,
        }),
        400,
      );
    },
  );

  app.get('/registrations/:id', (c) => {
    if (!login) return notFound(c);
    const viewer = c.get('viewer');
    if (!viewer) return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);
    const id = c.req.param('id');
    const status = ROW_ID.test(id)
      ? registrationStatus(db, viewer.playerId, Number(id), deps.now())
      : null;
    if (!status?.ok) return notFound(c);
    const competitionRow = db
      .select({ scheduling: schema.competition.schedulingJson })
      .from(schema.competition)
      .where(eq(schema.competition.slug, status.competition.slug))
      .get();
    // The link holds the invitation's secret: the page is the filer's only, and kept by no cache.
    c.header('Cache-Control', 'no-store');
    return render(
      c,
      registrationView(locale, status, {
        inviteUrl: status.invite ? inviteUrl(login.publicUrl, login.secret, status.invite) : null,
        timeZone: competitionRow?.scheduling.time_zone ?? 'Europe/Paris',
      }),
    );
  });

  app.get('/c/:competition/:season', (c) => {
    const page = seasonPage(db, c.req.param('competition'), c.req.param('season'));
    return page.ok ? render(c, seasonPageView(locale, page)) : notFound(c);
  });
  app.get('/teams/:slug', (c) => {
    const page = teamPage(db, c.req.param('slug'));
    return page.ok ? render(c, teamPageView(locale, page)) : notFound(c);
  });
  app.get('/clubs/:slug', (c) => {
    const page = clubPage(db, c.req.param('slug'));
    return page.ok ? render(c, clubPageView(locale, page)) : notFound(c);
  });
  app.get('/matches/:id', (c) => {
    const id = c.req.param('id');
    const page = MATCH_ID.test(id) ? matchPage(db, Number(id)) : null;
    return page?.ok ? render(c, matchPageView(locale, page)) : notFound(c);
  });

  // -------------------------------------------------------------------------------------------
  // Discord login

  app.get('/auth/login', async (c) => {
    if (!login) return notFound(c);
    const state = await startLogin(c, login, safeNext(c.req.query('next')));
    return c.redirect(login.oauth.authorizeUrl(state), 302);
  });

  app.get('/auth/callback', async (c) => {
    if (!login) return notFound(c);
    const next = await finishLogin(c, login, c.req.query('state') ?? '');
    if (c.req.query('error') !== undefined) {
      return message(c, 400, 'web.auth.cancelled.title', 'web.auth.cancelled.body');
    }
    const code = c.req.query('code');
    if (next === null || !code) {
      return message(c, 400, 'web.auth.failed.title', 'web.auth.failed.body');
    }
    let user;
    try {
      user = await login.oauth.userFor(code);
    } catch (error) {
      // The error names the step only; the code and the token never reach the log.
      deps.logger.error({ err: error }, 'Discord login failed');
      return message(c, 502, 'web.auth.failed.title', 'web.auth.unavailable.body');
    }
    if (!user) return message(c, 400, 'web.auth.failed.title', 'web.auth.failed.body');
    const player = loginPlayer(db, user, deps.now());
    if (!player.ok) throw new Error(`Login refused: ${player.error}`);
    await startSession(c, login, player.player.id, deps.now());
    return c.redirect(next, 303);
  });

  app.post('/auth/logout', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    if (login) endSession(c, login);
    return c.redirect('/', 303);
  });

  // -------------------------------------------------------------------------------------------
  // The player's own account

  app.get('/me', async (c) => {
    if (!login) return notFound(c);
    const viewer = c.get('viewer');
    if (!viewer) return c.redirect('/auth/login?next=/me', 303);
    const profile = profileOf(db, viewer.playerId);
    if (!profile) return c.redirect('/auth/login?next=/me', 303);
    const flash = c.req.query('saved') === '1' ? 'saved' : (c.req.query('error') ?? null);
    return showMe(c, viewer, profile, {
      flash: flash === 'saved' || flash === 'invalid_nationality' ? flash : null,
      game: null,
    });
  });

  // The game account part of `/me` is filled again with what was typed when it is refused.
  const showMe = async (
    c: Context<Env>,
    viewer: Viewer,
    profile: NonNullable<ReturnType<typeof profileOf>>,
    state: {
      flash: 'saved' | 'invalid_nationality' | null;
      game: {
        values: { ubisoftName: string; profileId: string; rank: string };
        errors: FieldErrors<SaveProfileError>;
      } | null;
    },
    status: 200 | 400 = 200,
  ) => {
    const staffOf = await staffCompetitions(db, deps.roles, viewer, deps.now());
    const stored = gameProfileOf(db, viewer.playerId);
    const game = gameProfileForm(locale, {
      values: state.game?.values ?? {
        ubisoftName: stored?.ubisoftName ?? '',
        profileId: stored?.profileId ?? '',
        rank: stored?.rank ?? '',
      },
      ranks: R6_RANKS,
      verified: stored?.verified ?? false,
      errors: state.game?.errors ?? [],
      csrf: viewer.csrf,
    });
    return render(
      c,
      mePage(locale, {
        profile,
        staffOf: staffOf.map((competition) => competition.name),
        countries: countryChoices(locale),
        csrf: viewer.csrf,
        flash: state.flash,
        game,
      }),
      status,
    );
  };

  app.post('/me/game-profile', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const text = (key: string) => (typeof form[key] === 'string' ? form[key] : '');
    const values = {
      ubisoftName: text('ubisoft_name'),
      profileId: text('profile_id'),
      rank: text('rank'),
    };
    const reply = saveGameProfile(
      db,
      viewer.playerId,
      { ...values, profileId: values.profileId.trim() === '' ? null : values.profileId },
      deps.now(),
    );
    if (reply.ok) return c.redirect('/me?saved=1', 303);
    const profile = profileOf(db, viewer.playerId);
    if (!profile) return c.redirect('/auth/login?next=/me', 303);
    return showMe(c, viewer, profile, { flash: null, game: { values, errors: reply.errors } }, 400);
  });

  app.post('/me/nationality', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const value = typeof form.nationality === 'string' ? form.nationality : '';
    const reply = setNationality(db, viewer.playerId, value, deps.now());
    return c.redirect(reply.ok ? '/me?saved=1' : `/me?error=${reply.error}`, 303);
  });

  app.post('/me/consent', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    if (form.consent !== 'give' && form.consent !== 'withdraw') return forbidden(c);
    setStatsConsent(db, viewer.playerId, form.consent === 'give', deps.now());
    return c.redirect('/me?saved=1', 303);
  });

  // -------------------------------------------------------------------------------------------
  // League staff: the queue of what waits for them (design doc section 7)

  // Discord as the bot's buttons see it, for what follows a decision taken here.
  const discord = { db, gateway: deps.gateway, assets: deps.assets, locale };
  const backToQueue = (c: Context<Env>, query: string) => c.redirect(`/staff?${query}`, 303);

  app.get('/staff', async (c) => {
    if (!login) return notFound(c);
    const viewer = c.get('viewer');
    if (!viewer) return c.redirect('/auth/login?next=/staff', 303);
    const competitions = await staffCompetitions(db, deps.roles, viewer, deps.now());
    if (competitions.length === 0) return forbidden(c);
    const leagues = competitions.flatMap((competition) => {
      const league = findLeague(db, competition.id);
      if (!league) return [];
      const timeZone = league.competition.schedulingJson.time_zone;
      return [{ name: competition.name, timeZone, queue: staffQueue(db, league) }];
    });
    const done = oneOf(STAFF_DONE, c.req.query('done'));
    const error = oneOf(STAFF_ERRORS, c.req.query('error'));
    const flash: { error: boolean; key: MessageKey } | null = done
      ? { error: false, key: `web.staff.done.${done}` }
      : error
        ? { error: true, key: `web.staff.error.${error}` }
        : null;
    // The queue is for this viewer only: no shared cache keeps it.
    c.header('Cache-Control', 'no-store');
    return render(c, staffPage(locale, { leagues, csrf: viewer.csrf, now: deps.now(), flash }));
  });

  // A score screenshot, for staff of the match's league; to anyone else it does not exist.
  app.get('/evidence/:id', async (c) => {
    if (!login) return notFound(c);
    const viewer = c.get('viewer');
    const id = c.req.param('id');
    if (!viewer) return forbidden(c);
    const competitionId = ROW_ID.test(id) ? evidenceCompetition(db, Number(id)) : null;
    if (competitionId === null) return notFound(c);
    const actor = await webActor(db, deps.roles, viewer, competitionId, deps.now());
    if (!actor) return forbidden(c);
    const shown = await openEvidence(db, deps.evidence, actor, Number(id));
    if (!shown.ok) return shown.error === 'not_found' ? notFound(c) : forbidden(c);
    return c.body(new Uint8Array(shown.data), 200, {
      'Content-Type': shown.type,
      'Content-Disposition': 'inline',
      // Staff only: no shared cache, and the browser does not keep it either.
      'Cache-Control': 'private, no-store',
    });
  });

  app.post('/staff/matches/:id/:decision', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const decision = oneOf(['validate', 'reject'] as const, c.req.param('decision'));
    const id = c.req.param('id');
    if (!decision || !MATCH_ID.test(id)) return notFound(c);
    const [found] = listLeagueMatches(db, { matchId: Number(id) });
    if (!found) return backToQueue(c, 'error=match_not_found');
    // Staff of the match's own league, asked of Discord now; the service checks it again.
    const actor = await webActor(db, deps.roles, viewer, found.competitionId, deps.now());
    if (!actor) return forbidden(c);
    const evidence = typeof form.evidence === 'string' ? form.evidence : '';
    const request = {
      matchId: found.id,
      evidenceId: ROW_ID.test(evidence) ? Number(evidence) : -1,
    };
    const reply =
      decision === 'validate'
        ? validateResult(db, actor, request, deps.now())
        : rejectResult(db, actor, request, deps.now());
    if (!reply.ok) {
      const refused = reply.error === 'not_staff' || reply.error === 'not_linked';
      return refused ? forbidden(c) : backToQueue(c, `error=${reply.error}`);
    }
    await announceReportDecision(discord, reply, actor.user.id);
    return backToQueue(c, `done=${decision === 'validate' ? 'validated' : 'rejected'}`);
  });

  app.post('/staff/requests/:id/:decision', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const decision = oneOf(['approve', 'reject'] as const, c.req.param('decision'));
    const id = c.req.param('id');
    if (!decision || !ROW_ID.test(id)) return notFound(c);
    const found = db
      .select({ competitionId: schema.request.competitionId })
      .from(schema.request)
      .where(eq(schema.request.id, Number(id)))
      .get();
    if (!found) return backToQueue(c, 'error=not_found');
    const actor = await webActor(db, deps.roles, viewer, found.competitionId, deps.now());
    if (!actor) return forbidden(c);
    const reason = typeof form.reason === 'string' ? form.reason : null;
    const reply = answerRequest(
      db,
      actor,
      { requestId: Number(id), decision, reason: decision === 'reject' ? reason : null },
      deps.now(),
    );
    if (!reply.ok) {
      const refused = reply.error === 'not_staff' || reply.error === 'not_linked';
      return refused ? forbidden(c) : backToQueue(c, `error=${reply.error}`);
    }
    await announceRequestDecision(discord, reply);
    return backToQueue(c, `done=${decision === 'approve' ? 'approved' : 'rejected_request'}`);
  });

  app.notFound(notFound);
  app.onError((error, c) => {
    deps.logger.error({ err: error, path: c.req.path }, 'Web page failed');
    return render(c, errorPage(locale), 500);
  });
  return app;
}
