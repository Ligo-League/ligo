import { html } from 'hono/html';
import { t, type Locale } from '../../i18n/index.ts';
import { layout, type Html } from '../layout.ts';

export function notFoundPage(locale: Locale): Html {
  return layout(
    locale,
    t(locale, 'web.notFound.title'),
    html`<h1>${t(locale, 'web.notFound.title')}</h1>
      <p>${t(locale, 'web.notFound.body')} <a href="/">${t(locale, 'web.nav.home')}</a></p>`,
  );
}

/** Says nothing about the fault itself: the details go to the server's log only. */
export function errorPage(locale: Locale): Html {
  return layout(
    locale,
    t(locale, 'web.error.title'),
    html`<h1>${t(locale, 'web.error.title')}</h1>
      <p>${t(locale, 'web.error.body')}</p>`,
  );
}
