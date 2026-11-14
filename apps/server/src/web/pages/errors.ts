import { html } from 'hono/html';
import { t, type Locale } from '../../i18n/index.ts';
import { pageOf, type Page } from '../layout.ts';

export function notFoundPage(locale: Locale): Page {
  return pageOf(
    t(locale, 'web.notFound.title'),
    html`<h1>${t(locale, 'web.notFound.title')}</h1>
      <p>${t(locale, 'web.notFound.body')} <a href="/">${t(locale, 'web.nav.home')}</a></p>`,
  );
}

/** Says nothing about the fault itself: the details go to the server's log only. */
export function errorPage(locale: Locale): Page {
  return pageOf(
    t(locale, 'web.error.title'),
    html`<h1>${t(locale, 'web.error.title')}</h1>
      <p>${t(locale, 'web.error.body')}</p>`,
  );
}

/** A page that only says something: a refused action, a failed login. */
export function messagePage(locale: Locale, title: string, text: string): Page {
  return pageOf(
    title,
    html`<h1>${title}</h1>
      <p>${text}</p>
      <p><a href="/">${t(locale, 'web.nav.home')}</a></p>`,
  );
}
