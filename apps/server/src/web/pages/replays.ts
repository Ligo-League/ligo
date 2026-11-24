import type { UploaderConfig } from '@ligo/uploader';
import { html } from 'hono/html';
import { t, type Locale } from '../../i18n/index.ts';
import { pageOf, type Html, type Page } from '../layout.ts';

// `/matches/:id/replays` (design doc section 8, upload flow): the explanation, and the uploader
// island (`/static/uploader.js`), which reads its configuration from the page. Without scripts,
// or while the server has no parser build, the page says so.

export function replaysPage(
  locale: Locale,
  match: { id: number; a: string; b: string },
  config: UploaderConfig | null,
): Page {
  const title = t(locale, 'web.replays.title', { a: match.a, b: match.b });
  return pageOf(
    title,
    html`<h1>${title}</h1>
      <p><a href="/matches/${String(match.id)}">${t(locale, 'web.replays.ui.back')}</a></p>
      <p>${t(locale, 'web.replays.intro')}</p>
      ${
        config
          ? html`<div id="replay-uploader" data-config="${JSON.stringify(config)}">
                <noscript
                  ><p class="card flash error">${t(locale, 'web.replays.noscript')}</p></noscript
                >
              </div>
              <script src="/static/uploader.js" defer></script>`
          : html`<p class="card flash error">${t(locale, 'web.replays.unavailable')}</p>`
      }`,
  );
}

/** The match page's link, for the teams' players and officials and league staff. */
export const replaysLink = (locale: Locale, matchId: number): Html =>
  html`<p><a href="/matches/${String(matchId)}/replays">${t(locale, 'web.replays.link')}</a></p>`;
