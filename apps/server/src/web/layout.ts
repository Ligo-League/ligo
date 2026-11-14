import { html } from 'hono/html';
import { t, type Locale } from '../i18n/index.ts';
import type { MatchLine, MatchResult } from '../services/site.ts';

// The page frame and the pieces several pages share. Every value goes through Hono's `html`
// tag, which escapes it; only other `html` results are inserted as they are (M-07).

export type Html = ReturnType<typeof html>;

/** What a page puts in the frame: its title and its content. */
export interface Page {
  title: string;
  body: Html;
}

export const pageOf = (title: string, body: Html): Page => ({ title, body });

/** Who is looking, for the header: a logged-in user, or a login link when login is on. */
export interface Nav {
  user: { name: string; csrf: string } | null;
  login: boolean;
  /** The current path, to come back to after login. */
  path: string;
}

/** The hidden field every POST form carries (design doc section 7). */
export const csrfField = (token: string): Html =>
  html`<input type="hidden" name="_csrf" value="${token}" />`;

function account(locale: Locale, nav: Nav): Html | string {
  if (nav.user) {
    return html`<nav class="account">
      <a href="/me">${nav.user.name}</a>
      <form method="post" action="/auth/logout">
        ${csrfField(nav.user.csrf)}<button type="submit">${t(locale, 'web.auth.logout')}</button>
      </form>
    </nav>`;
  }
  if (!nav.login) return '';
  const next = encodeURIComponent(nav.path);
  return html`<nav class="account">
    <a href="/auth/login?next=${next}">${t(locale, 'web.auth.login')}</a>
  </nav>`;
}

export function layout(locale: Locale, page: Page, nav: Nav): Html {
  return html`<!doctype html>
    <html lang="${locale}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${page.title} · ${t(locale, 'web.title')}</title>
        <link rel="stylesheet" href="/static/site.css" />
        <script src="/static/htmx.min.js" defer></script>
      </head>
      <body>
        <header class="site">
          <a class="brand" href="/">${t(locale, 'web.title')}</a>
          ${account(locale, nav)}
        </header>
        <main>${page.body}</main>
        <footer class="site">${t(locale, 'web.footer')}</footer>
      </body>
    </html>`;
}

/** "jeu. 20 nov., 21:00", in the league's time zone. */
export function formatWhen(locale: Locale, at: number, timeZone: string): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}

const teamLink = (team: MatchLine['a']) =>
  team.slug ? html`<a href="/teams/${team.slug}">${team.name}</a>` : html`${team.name}`;

function resultText(locale: Locale, line: MatchLine, result: NonNullable<MatchResult>): Html {
  if (result.kind === 'forfeit') {
    return html`<span class="score"
      >${t(locale, 'web.match.forfeit', { team: line[result.by].name })}</span
    >`;
  }
  return html`<span class="score">${result.a} – ${result.b}</span>`;
}

/** What stands where the score will be: the result, or the time and status. */
export function matchOutcome(locale: Locale, line: MatchLine, timeZone: string): Html {
  if (line.result) return resultText(locale, line, line.result);
  const status = t(locale, `web.match.status.${line.status}`);
  if (line.status !== 'scheduled') return html`<span class="muted">${status}</span>`;
  const when =
    line.scheduledAt === null
      ? t(locale, 'web.match.noTime')
      : formatWhen(locale, line.scheduledAt, timeZone);
  return html`<span class="muted">${when}</span>`;
}

/** One match in a list: both teams, a link to the match, and its outcome. */
export function matchItem(locale: Locale, line: MatchLine, timeZone: string): Html {
  return html`<li>
    <span
      >${teamLink(line.a)}
      <a class="muted" href="/matches/${line.id}">${t(locale, 'web.match.vs')}</a>
      ${teamLink(line.b)}</span
    >
    ${matchOutcome(locale, line, timeZone)}
  </li>`;
}

export function matchList(locale: Locale, lines: readonly MatchLine[], timeZone: string): Html {
  return html`<ul class="matches">
    ${lines.map((line) => matchItem(locale, line, timeZone))}
  </ul>`;
}

/** A hex colour from the database, checked again before it reaches a style attribute. */
export const safeColor = (color: string): string | null =>
  /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
