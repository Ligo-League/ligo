import { readFile } from 'node:fs/promises';
import { zonedDate, type FieldErrors } from '@ligo/core';
import { findLeague, listLeagueMatches, schema, type Db } from '@ligo/db';
import { and, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { R6_RANKS } from '@ligo/titles';
import type { EvidenceStore } from '../assets/evidence-store.ts';
import type { AssetStore } from '../assets/store.ts';
import type { DiscordGateway } from '../discord/gateway.ts';
import { announceReportDecision, announceRequestDecision } from '../discord/staff-decisions.ts';
import { t, type Locale, type MessageKey } from '../i18n/index.ts';
import { evidenceCompetition, openEvidence } from '../services/evidence.ts';
import { gameProfileOf, saveGameProfile, type SaveProfileError } from '../services/game-profile.ts';
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
  setBirthDate,
  setNationality,
  setStatsConsent,
} from '../services/me.ts';
import { rejectResult, validateResult } from '../services/reports.ts';
import { answerRequest } from '../services/requests.ts';
import { requireStaff } from '../services/permissions.ts';
import { publishRules, rulesPage } from '../services/rules.ts';
import { clubPage, listLeagues, matchPage, seasonPage, teamPage } from '../services/site.ts';
import {
  findCompetitionById,
  findLegacyCompetition,
  type CompetitionKey,
} from '../services/competitions.ts';
import { competitionPath } from '../services/paths.ts';
import { staffQueue } from '../services/staff-queue.ts';
import { layout, type Page } from './layout.ts';
import { clubPageView } from './pages/club.ts';
import { errorPage, messagePage, notFoundPage } from './pages/errors.ts';
import { homePage } from './pages/home.ts';
import { matchPageView } from './pages/match.ts';
import { ME_ERRORS, mePage, type MeFlash } from './pages/me.ts';
import { clubRoutes } from './clubs.ts';
import { matchCaptainRoutes } from './match-captain.ts';
import { matchStaffRoutes } from './match-staff.ts';
import { staffSanctionsRoutes } from './staff-sanctions.ts';
import { leagueChannelsRoutes } from './league-channels.ts';
import { staffMercatoRoutes } from './staff-mercato.ts';
import { rosterMercatoRoutes } from './roster-mercato.ts';
import { isMercatoTeamError, mercatoTeamErrorKey } from './pages/roster-mercato.ts';
import { movesToDecide } from '../services/roster-move-apply.ts';
import { matchReportRoutes } from './match-report.ts';
import { matchTimeRoutes } from './match-time.ts';
import { vetoRoutes } from './veto.ts';
import { matchStatsRoutes } from './match-stats.ts';
import { adminOrgRoutes } from './admin-orgs.ts';
import { ownedOrgs } from '../services/orgs.ts';
import { adminCompetitionRoutes } from './admin-competitions.ts';
import { adminSeasonRoutes } from './admin-seasons.ts';
import { matchScoreboard } from '../services/scoreboard.ts';
import { rosterRoutes } from './rosters.ts';
import { rostersOf } from '../services/rosters.ts';
import { teamManageRoutes } from './team-manage.ts';
import { gameProfileForm, registerFormView, registrationView } from './pages/register.ts';
import { leagueServer, notOnServer, registrationsOf } from '../services/registration-players.ts';
import {
  adminCompetitions,
  discordSettings,
  saveDiscordSettings,
  type SaveDiscordError,
} from '../services/league-discord.ts';
import { discordSettingsPage } from './pages/league-discord.ts';
import {
  approveRegistration,
  registrationsToApprove,
  rejectRegistration,
} from '../services/registration-approval.ts';
import { setLineup, withdrawRegistration } from '../services/registration-lineup.ts';
import { rulesFormView, rulesPageView, type RulesFormValues } from './pages/rules.ts';
import { seasonPageView } from './pages/season.ts';
import { staffPage } from './pages/staff.ts';
import { teamPageView } from './pages/team.ts';
import {
  createMemberCheck,
  staffCompetitions,
  webActor,
  type RoleReader,
  type WebUser,
} from './roles.ts';
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
  /** The stat grid's paste from a spreadsheet. */
  statPaste: string;
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
  /** The address that adds the bot to a server; null when the application is unknown. */
  botInstallUrl: string | null;
  now: () => number;
}

/** The stylesheet next to this file, and htmx at the version pinned in package.json. */
export async function loadStaticFiles(): Promise<StaticFiles> {
  const [css, htmx, colors, statPaste] = await Promise.all([
    readFile(new URL('./static/site.css', import.meta.url), 'utf8'),
    readFile(new URL(import.meta.resolve('htmx.org/dist/htmx.min.js')), 'utf8'),
    readFile(new URL('./static/colors.js', import.meta.url), 'utf8'),
    readFile(new URL('./static/stat-paste.js', import.meta.url), 'utf8'),
  ]);
  return { css, htmx, colors, statPaste };
}

export interface Viewer extends WebUser {
  session: Session;
  csrf: string;
}

export type Env = { Variables: { viewer: Viewer | null } };

const LOGO_FILE = /^([a-z0-9][a-z0-9_-]{0,63})\.png$/;
const MATCH_ID = /^[1-9]\d{0,9}$/;
const ROW_ID = MATCH_ID;

// What a staff decision sends back to `/staff` with, read back from the address: anything else
// shows nothing.
const STAFF_DONE = [
  'validated',
  'rejected',
  'approved',
  'rejected_request',
  'registration_approved',
  'registration_rejected',
  'move_approved',
  'move_rejected',
] as const;
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
  'invalid_division',
  'not_approvable',
  'discord_unavailable',
] as const;
// What a filer's change sends back to the registration's page with; anything else shows nothing.
const REGISTRATION_DONE = ['lineup', 'withdrawn'] as const;
const REGISTRATION_ERRORS = [
  'lineup_locked',
  'captain_not_starter',
  'too_many_starters',
  'too_many_subs',
  'not_on_roster',
  'unavailable',
  'confirm',
] as const;

/** A path as the error log keeps it: an invitation's token is a secret and never written down. */
export const loggedPath = (path: string): string =>
  path.replace(/^\/(join|invite)\/([^/]*)\/[^/]+/, '/$1/$2/…');

const oneOf = <T extends string>(values: readonly T[], value: string | undefined): T | null =>
  values.find((candidate) => candidate === value) ?? null;

function registrationFlash(
  done: string | undefined,
  error: string | undefined,
): { error: boolean; key: MessageKey } | null {
  const doneKey = oneOf(REGISTRATION_DONE, done);
  if (doneKey) return { error: false, key: `web.registration.done.${doneKey}` };
  const errorKey = oneOf(REGISTRATION_ERRORS, error);
  return errorKey ? { error: true, key: `web.registration.error.${errorKey}` } : null;
}
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
      // Owners only: one query, no Discord call on every page. Staff reach the panel from /me
      // and /staff.
      user: viewer && {
        name: viewer.name,
        csrf: viewer.csrf,
        admin: ownedOrgs(db, viewer).length > 0,
      },
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
  app.get('/static/stat-paste.js', (c) =>
    c.body(deps.files.statPaste, 200, {
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
  // The addresses before the move to `/:org/:competition` (phase 3f-5): links already shared keep
  // working, and lead to the new address for good. Registered before the competition routes,
  // which would otherwise read `c` as an organisation.
  app.get('/c/:competition/*', (c) => {
    const slug = c.req.param('competition');
    const found = findLegacyCompetition(db, slug);
    if (!found) return notFound(c);
    const url = new URL(c.req.url);
    return c.redirect(found.path + url.pathname.slice(`/c/${slug}`.length) + url.search, 301);
  });

  // MLB Group's addresses before its name's typo was fixed (migration 0026): `/mbl-group/...`.
  app.get('/mbl-group/*', (c) => {
    const url = new URL(c.req.url);
    return c.redirect(`/mlb-group${url.pathname.slice('/mbl-group'.length)}${url.search}`, 301);
  });

  // Before the competition routes, which would read `/admin/x` and `/orgs/new` as one.
  adminOrgRoutes(app, { deps, render, notFound, forbidden, guard });
  adminCompetitionRoutes(app, { deps, render, notFound, forbidden, guard });
  adminSeasonRoutes(app, { deps, render, notFound, forbidden, guard });

  // A competition's pages live under its organisation, `/:org/:competition` (design doc section
  // 7). Each of these routes ends in a word no other route uses in that place; the season page,
  // `/:org/:competition/:season`, matches any third word, so it is registered last of all.
  const keyOf = (c: Context<Env>): CompetitionKey => ({
    org: c.req.param('org') ?? '',
    competition: c.req.param('competition') ?? '',
  });

  // The rulebook.

  /** The viewer as staff of this competition, asked of Discord now; null for anyone else. */
  const staffOf = async (viewer: Viewer | null, competitionId: number) => {
    if (!login || !viewer) return null;
    const actor = await webActor(db, deps.roles, viewer, competitionId, deps.now());
    const staff = actor && requireStaff(db, actor);
    return staff?.ok && staff.league.competition.id === competitionId ? actor : null;
  };
  const showRules = async (c: Context<Env>, versionId: number | null) => {
    const now = deps.now();
    const page = rulesPage(db, keyOf(c), now, versionId);
    if (!page.ok) return notFound(c);
    const canPublish = (await staffOf(c.get('viewer'), page.competition.id)) !== null;
    return render(c, rulesPageView(locale, page, { now, canPublish }));
  };
  // The league's Discord server, for whoever may manage it (maintainer, 15 November 2026).
  const showDiscord = async (
    c: Context<Env>,
    viewer: Viewer,
    chosen: string | null,
    state: { values?: { staffRoleId: string; inviteUrl: string }; error?: SaveDiscordError },
  ) => {
    const user = { playerId: viewer.playerId, discordUserId: viewer.discordUserId };
    const data = await discordSettings(db, deps.gateway, user, keyOf(c), chosen);
    if (!data.ok) {
      if (data.error === 'not_found') return notFound(c);
      if (data.error === 'not_admin') return forbidden(c);
      return message(c, 502, 'web.discord.unavailable.title', 'web.discord.unavailable.body');
    }
    const same = data.chosen.id === data.current.guildId;
    const flash: { error: boolean; key: MessageKey } | null = state.error
      ? { error: true, key: `web.discord.error.${state.error}` }
      : c.req.query('saved') === '1'
        ? { error: false, key: 'web.discord.saved' }
        : null;
    c.header('Cache-Control', 'no-store');
    return render(
      c,
      discordSettingsPage(locale, data, {
        csrf: viewer.csrf,
        installUrl: deps.botInstallUrl,
        values: state.values ?? {
          staffRoleId: same ? data.current.staffRoleId : '',
          inviteUrl: same ? (data.current.inviteUrl ?? '') : '',
        },
        flash,
      }),
      state.error ? 400 : 200,
    );
  };
  app.get('/:org/:competition/discord', async (c) => {
    if (!login) return notFound(c);
    const viewer = c.get('viewer');
    if (!viewer) return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);
    return showDiscord(c, viewer, c.req.query('server') ?? null, {});
  });
  app.post('/:org/:competition/discord', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const text = (key: string) => (typeof form[key] === 'string' ? form[key] : '');
    const change = {
      guildId: text('guild_id'),
      staffRoleId: text('staff_role'),
      inviteUrl: text('invite_url'),
    };
    const key = keyOf(c);
    const user = { playerId: viewer.playerId, discordUserId: viewer.discordUserId };
    const reply = await saveDiscordSettings(db, deps.gateway, user, key, change, deps.now());
    if (reply.ok) {
      return c.redirect(`${competitionPath(key.org, key.competition)}/discord?saved=1`, 303);
    }
    if (reply.error === 'not_found') return notFound(c);
    if (reply.error === 'not_admin') return forbidden(c);
    return showDiscord(c, viewer, change.guildId, {
      values: { staffRoleId: change.staffRoleId, inviteUrl: change.inviteUrl },
      error: reply.error,
    });
  });

  app.get('/:org/:competition/rules', (c) => showRules(c, null));
  app.get('/:org/:competition/rules/new', async (c) => {
    if (!login) return notFound(c);
    const page = rulesPage(db, keyOf(c), deps.now());
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
  app.get('/:org/:competition/rules/:id', (c) => {
    const id = c.req.param('id');
    return ROW_ID.test(id) ? showRules(c, Number(id)) : notFound(c);
  });
  app.post('/:org/:competition/rules', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const page = rulesPage(db, keyOf(c), deps.now());
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
    return c.redirect(`${page.competition.path}/rules/${String(reply.id)}`, 303);
  });

  // -------------------------------------------------------------------------------------------
  // Registration (phase 3d-4a).

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

  app.get('/:org/:competition/register', (c) => {
    if (!login) return notFound(c);
    const viewer = c.get('viewer');
    if (!viewer) return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);
    const form = registrationForm(db, keyOf(c), viewer.playerId, deps.now());
    if (!form.ok) return registrationClosed(c, form.error);
    c.header('Cache-Control', 'no-store');
    return render(c, registerFormView(locale, form, { teamId: '', errors: [], csrf: viewer.csrf }));
  });

  app.post('/:org/:competition/register', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const key = keyOf(c);
    const text = (name: string) => (typeof form[name] === 'string' ? form[name] : '');
    const reply = fileRegistration(
      db,
      viewer.playerId,
      key,
      {
        teamId: ROW_ID.test(text('team')) ? Number(text('team')) : -1,
        rulesVersionId: Number(text('rules_version')),
        rulesAccepted: text('rules_accepted') === '1',
      },
      deps.now(),
    );
    if (reply.ok) return c.redirect(`/registrations/${String(reply.id)}`, 303);
    if (!('errors' in reply)) return registrationClosed(c, reply.error);
    const again = registrationForm(db, key, viewer.playerId, deps.now());
    if (!again.ok) return registrationClosed(c, again.error);
    c.header('Cache-Control', 'no-store');
    return render(
      c,
      registerFormView(locale, again, {
        teamId: text('team'),
        errors: reply.errors satisfies FieldErrors<RegistrationFieldError>,
        csrf: viewer.csrf,
      }),
      400,
    );
  });

  // Asked of the bot on every visit: a player who just joined the league's server counts at once.
  const memberOf = createMemberCheck(deps.gateway);
  app.get('/registrations/:id', async (c) => {
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
      .where(eq(schema.competition.id, status.competition.id))
      .get();
    // The roster's officials' page, about other players: kept by no cache.
    c.header('Cache-Control', 'no-store');
    const offServer =
      status.status === 'pending'
        ? await notOnServer(
            db,
            memberOf,
            status.competition.id,
            status.players.map((entry) => entry.playerId),
          )
        : [];
    return render(
      c,
      registrationView(locale, status, {
        notOnServer: offServer,
        serverInvite: leagueServer(db, status.competition.id)?.inviteUrl ?? null,
        timeZone: competitionRow?.scheduling.time_zone ?? 'Europe/Paris',
        csrf: viewer.csrf,
        flash: registrationFlash(c.req.query('done'), c.req.query('error')),
      }),
    );
  });

  // The officials' changes to the registration: each answer goes back to its page.
  const backToRegistration = (
    c: Context<Env>,
    id: string,
    reply: { ok: true } | { ok: false; error: string },
    done: (typeof REGISTRATION_DONE)[number],
  ) => {
    if (reply.ok) return c.redirect(`/registrations/${id}?done=${done}`, 303);
    if (reply.error === 'not_found') return notFound(c);
    return c.redirect(`/registrations/${id}?error=${reply.error}`, 303);
  };
  app.post('/registrations/:id/lineup', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const id = c.req.param('id');
    if (!ROW_ID.test(id)) return notFound(c);
    const roles = new Map<number, 'player' | 'sub'>();
    for (const [key, value] of Object.entries(form)) {
      const playerId = /^role_([1-9]\d{0,9})$/.exec(key)?.[1];
      if (playerId && (value === 'player' || value === 'sub')) roles.set(Number(playerId), value);
    }
    const captain = typeof form.captain === 'string' && ROW_ID.test(form.captain);
    const reply = setLineup(
      db,
      viewer.playerId,
      Number(id),
      { roles, captainId: captain ? Number(form.captain) : null },
      deps.now(),
    );
    return backToRegistration(c, id, reply, 'lineup');
  });
  app.post('/registrations/:id/withdraw', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const id = c.req.param('id');
    if (!ROW_ID.test(id)) return notFound(c);
    // Checked first, so another member learns nothing from the confirmation's answer.
    const status = registrationStatus(db, guarded.viewer.playerId, Number(id), deps.now());
    if (!status.ok) return notFound(c);
    const reply =
      guarded.form.confirm === '1'
        ? withdrawRegistration(db, guarded.viewer.playerId, Number(id), deps.now())
        : { ok: false as const, error: 'confirm' };
    return backToRegistration(c, id, reply, 'withdrawn');
  });

  app.get('/teams/:slug', (c) => {
    const page = teamPage(db, c.req.param('slug'));
    return page.ok ? render(c, teamPageView(locale, page)) : notFound(c);
  });
  // Before `/clubs/:slug`, which would read "new" as a club's name.
  clubRoutes(app, { deps, render, notFound, forbidden, guard });
  app.get('/clubs/:slug', (c) => {
    const page = clubPage(db, c.req.param('slug'));
    return page.ok ? render(c, clubPageView(locale, page)) : notFound(c);
  });
  const matchTime = matchTimeRoutes(app, { deps, render, notFound, forbidden, guard });
  const matchReport = matchReportRoutes(app, { deps, render, notFound, forbidden, guard });
  const veto = vetoRoutes(app, { deps, render, notFound, forbidden, guard });
  const matchCaptain = matchCaptainRoutes(app, { deps, render, notFound, forbidden, guard });
  const matchStaff = matchStaffRoutes(app, { deps, render, notFound, forbidden, guard });
  const matchStats = matchStatsRoutes(app, { deps, render, notFound, forbidden, guard });
  staffSanctionsRoutes(app, { deps, render, notFound, forbidden, guard });
  leagueChannelsRoutes(app, { deps, render, notFound, forbidden, guard });
  staffMercatoRoutes(app, { deps, render, notFound, forbidden, guard });
  rosterRoutes(app, { deps, render, notFound, forbidden, guard });
  app.get('/matches/:id', async (c) => {
    const id = c.req.param('id');
    const page = MATCH_ID.test(id) ? matchPage(db, Number(id)) : null;
    if (!page?.ok) return notFound(c);
    // What the viewer's own team may do: the page is then theirs, kept by no shared cache.
    const panels = [
      veto.link(c, Number(id)),
      await matchStats.link(c, Number(id)),
      await matchReport.panel(c, Number(id)),
      await matchTime.panel(c, Number(id)),
      matchCaptain.panel(c, Number(id)),
      await matchStaff.panel(c, Number(id)),
    ].filter((panel) => panel !== '');
    if (panels.length > 0) c.header('Cache-Control', 'private, no-store');
    return render(c, matchPageView(locale, page, panels, matchScoreboard(db, Number(id))));
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
    const flash =
      c.req.query('saved') === '1'
        ? 'saved'
        : c.req.query('left') === '1'
          ? 'left'
          : c.req.query('joined') === '1'
            ? 'joined'
            : oneOf(ME_ERRORS, c.req.query('error'));
    return showMe(c, viewer, profile, { flash, game: null });
  });

  // The game account part of `/me` is filled again with what was typed when it is refused.
  const showMe = async (
    c: Context<Env>,
    viewer: Viewer,
    profile: NonNullable<ReturnType<typeof profileOf>>,
    state: {
      flash: MeFlash | null;
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
        admin: staffOf.length > 0 || ownedOrgs(db, viewer).length > 0,
        countries: countryChoices(locale),
        csrf: viewer.csrf,
        flash: state.flash,
        game,
        registrations: registrationsOf(db, viewer.playerId),
        rosters: rostersOf(db, viewer.playerId),
        adminOf: await adminCompetitions(db, deps.gateway, viewer.discordUserId),
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

  app.post('/me/birth-date', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const value = typeof form.birth_date === 'string' ? form.birth_date : '';
    const reply = setBirthDate(db, viewer.playerId, value, deps.now());
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
    const leagues = [];
    for (const competition of competitions) {
      const league = findLeague(db, competition.id);
      if (!league) continue;
      leagues.push({
        name: competition.name,
        path: findCompetitionById(db, competition.id)?.path ?? null,
        timeZone: league.competition.schedulingJson.time_zone,
        queue: staffQueue(db, league),
        registrations: await registrationsToApprove(db, memberOf, league.competition.id),
        moves: movesToDecide(db, league.competition.id),
      });
    }
    const done = oneOf(STAFF_DONE, c.req.query('done'));
    const error = oneOf(STAFF_ERRORS, c.req.query('error'));
    // A move that no longer passes the rules says which one.
    const moveError = c.req.query('move_error');
    const flash: { error: boolean; key: MessageKey } | null = done
      ? { error: false, key: `web.staff.done.${done}` }
      : error
        ? { error: true, key: `web.staff.error.${error}` }
        : isMercatoTeamError(moveError)
          ? { error: true, key: mercatoTeamErrorKey(moveError) }
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
      // Staff and the match's teams only: no shared cache, and the browser does not keep it.
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

  // Registrations: staff of the registration's own league, asked of Discord now; the services
  // check it again.
  const registrationActor = async (viewer: Viewer, id: string) => {
    const found = db
      .select({ competitionId: schema.request.competitionId })
      .from(schema.request)
      .where(and(eq(schema.request.id, Number(id)), eq(schema.request.kind, 'registration')))
      .get();
    if (!found) return null;
    return webActor(db, deps.roles, viewer, found.competitionId, deps.now());
  };
  app.post('/staff/registrations/:id/:decision', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const decision = oneOf(['approve', 'reject'] as const, c.req.param('decision'));
    const id = c.req.param('id');
    if (!decision || !ROW_ID.test(id)) return notFound(c);
    const actor = await registrationActor(viewer, id);
    if (!actor) return backToQueue(c, 'error=not_found');
    if (decision === 'reject') {
      const reason = typeof form.reason === 'string' ? form.reason : '';
      const reply = rejectRegistration(db, actor, { requestId: Number(id), reason }, deps.now());
      if (!reply.ok) {
        const refused = reply.error === 'not_staff' || reply.error === 'not_linked';
        return refused ? forbidden(c) : backToQueue(c, `error=${reply.error}`);
      }
      return backToQueue(c, 'done=registration_rejected');
    }
    const division = typeof form.division === 'string' && ROW_ID.test(form.division);
    const reply = await approveRegistration(
      db,
      memberOf,
      actor,
      { requestId: Number(id), divisionId: division ? Number(form.division) : -1 },
      deps.now(),
    );
    if (!reply.ok) {
      const refused = reply.error === 'not_staff' || reply.error === 'not_linked';
      return refused ? forbidden(c) : backToQueue(c, `error=${reply.error}`);
    }
    return backToQueue(c, 'done=registration_approved');
  });

  teamManageRoutes(app, { deps, render, notFound, forbidden, guard });
  rosterMercatoRoutes(app, { deps, render, notFound, forbidden, guard }, memberOf);

  // Last of all: any third word is read as a season (see `keyOf`).
  app.get('/:org/:competition/:season', (c) => {
    const page = seasonPage(db, keyOf(c), c.req.param('season'));
    return page.ok ? render(c, seasonPageView(locale, page)) : notFound(c);
  });

  app.notFound(notFound);
  app.onError((error, c) => {
    deps.logger.error({ err: error, path: loggedPath(c.req.path) }, 'Web page failed');
    return render(c, errorPage(locale), 500);
  });
  return app;
}
