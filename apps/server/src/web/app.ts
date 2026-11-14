import { readFile } from 'node:fs/promises';
import type { Db } from '@ligo/db';
import { Hono } from 'hono';
import type { AssetStore } from '../assets/store.ts';
import type { Locale } from '../i18n/index.ts';
import { listLeagues, matchPage, seasonPage, teamPage } from '../services/site.ts';
import { errorPage, notFoundPage } from './pages/errors.ts';
import { homePage } from './pages/home.ts';
import { matchPageView } from './pages/match.ts';
import { seasonPageView } from './pages/season.ts';
import { teamPageView } from './pages/team.ts';

// The website (design doc section 7): server-rendered pages over the same services as the bot.
// Routes are thin: they read the URL, call a service and render its answer.

/** Files the pages load, read once when the server starts. */
export interface StaticFiles {
  css: string;
  htmx: string;
}

export interface WebDeps {
  db: Db;
  assets: AssetStore;
  locale: Locale;
  files: StaticFiles;
  logger: { error: (details: object, message: string) => void };
}

/** The stylesheet next to this file, and htmx at the version pinned in package.json. */
export async function loadStaticFiles(): Promise<StaticFiles> {
  const [css, htmx] = await Promise.all([
    readFile(new URL('./static/site.css', import.meta.url), 'utf8'),
    readFile(new URL(import.meta.resolve('htmx.org/dist/htmx.min.js')), 'utf8'),
  ]);
  return { css, htmx };
}

const LOGO_FILE = /^([a-z0-9][a-z0-9_-]{0,63})\.png$/;
const MATCH_ID = /^[1-9]\d{0,9}$/;
// Pages show live data; static files change only with a release.
const STATIC_CACHE = 'public, max-age=3600';

export function createWebApp(deps: WebDeps): Hono {
  const { db, locale } = deps;
  const app = new Hono();

  app.use(async (c, next) => {
    await next();
    // The pages need nothing from other sites, and never belong in a frame.
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'same-origin');
  });

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
  app.get('/logos/:file', async (c) => {
    const name = LOGO_FILE.exec(c.req.param('file'))?.[1];
    const image = name ? await deps.assets.read(`logos/${name}.png`) : null;
    if (!image) return c.html(notFoundPage(locale), 404);
    return c.body(new Uint8Array(image.data), 200, {
      'Content-Type': image.type,
      'Cache-Control': STATIC_CACHE,
    });
  });

  app.get('/', (c) => c.html(homePage(locale, listLeagues(db))));
  app.get('/c/:competition/:season', (c) => {
    const page = seasonPage(db, c.req.param('competition'), c.req.param('season'));
    return page.ok ? c.html(seasonPageView(locale, page)) : c.html(notFoundPage(locale), 404);
  });
  app.get('/teams/:slug', (c) => {
    const page = teamPage(db, c.req.param('slug'));
    return page.ok ? c.html(teamPageView(locale, page)) : c.html(notFoundPage(locale), 404);
  });
  app.get('/matches/:id', (c) => {
    const id = c.req.param('id');
    const page = MATCH_ID.test(id) ? matchPage(db, Number(id)) : null;
    return page?.ok ? c.html(matchPageView(locale, page)) : c.html(notFoundPage(locale), 404);
  });

  app.notFound((c) => c.html(notFoundPage(locale), 404));
  app.onError((error, c) => {
    deps.logger.error({ err: error, path: c.req.path }, 'Web page failed');
    return c.html(errorPage(locale), 500);
  });
  return app;
}
