import { html } from 'hono/html';
import { t, type Locale } from '../../i18n/index.ts';
import type { LeagueSyncReply } from '../../services/reconciler.ts';
import { syncReplyLines } from '../../discord/sync-text.ts';
import { csrfField, pageOf, type Page } from '../layout.ts';

// The league server's sync in the admin panel (phase 4; design doc section 6): what a sync
// would change now, and a button to make it.

export interface SyncPageData {
  org: { name: string; slug: string };
  competition: { name: string; slug: string };
  /** The dry run made for this page. */
  preview: LeagueSyncReply;
  /** What the last sync from this page did. */
  done: { applied: number; failed: number } | null;
  csrf: string;
}

export function syncPageView(locale: Locale, data: SyncPageData): Page {
  const { org, competition } = data;
  const base = `/admin/${org.slug}/${competition.slug}`;
  const title = t(locale, 'web.admin.sync.title');
  const canSync = data.preview.ok && data.preview.operations.length > 0;
  return pageOf(
    title,
    html`<p><a href="${base}">${competition.name}</a></p>
      <h1>${title}</h1>
      <p class="muted">${t(locale, 'web.admin.sync.intro')}</p>
      ${
        data.done
          ? html`<p class="card flash">
              ${t(locale, 'web.admin.sync.done', {
                applied: String(data.done.applied),
                failed: String(data.done.failed),
              })}
            </p>`
          : ''
      }
      <section class="card stack">
        ${syncReplyLines(locale, data.preview, true).map((line) => html`<p>${line}</p>`)}
        ${
          canSync
            ? html`<form method="post" action="${base}/discord/sync">
                ${csrfField(data.csrf)}
                <button type="submit">${t(locale, 'web.admin.sync.button')}</button>
              </form>`
            : ''
        }
      </section>`,
  );
}
