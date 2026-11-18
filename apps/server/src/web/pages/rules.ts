import { html, raw } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import type { PublishRulesError, RulesPage } from '../../services/rules.ts';
import { csrfField, pageOf, type Html, type Page } from '../layout.ts';
import { renderMarkdown } from '../markdown.ts';

type Data = Extract<RulesPage, { ok: true }>;

const dateOf = (locale: Locale, at: number, timeZone: string) =>
  new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    dateStyle: 'long',
    timeZone,
  }).format(at);

/** `/:org/:competition/rules` and `/:org/:competition/rules/:id`: one version, and the history. */
export function rulesPageView(
  locale: Locale,
  page: Data,
  options: { now: number; canPublish: boolean },
): Page {
  const { competition, shown } = page;
  const date = (at: number) => dateOf(locale, at, competition.timeZone);
  const base = `${competition.path}/rules`;
  const title = t(locale, 'web.rules.title', { competition: competition.name });

  let notice: Html | string = '';
  if (shown && shown.id !== page.currentId) {
    const upcoming = shown.effectiveFrom > options.now;
    notice = html`<p class="card flash error">
      ${t(locale, upcoming ? 'web.rules.upcoming' : 'web.rules.old')}
      ${page.currentId === null ? '' : html`<a href="${base}">${t(locale, 'web.rules.current')}</a>`}
    </p>`;
  }
  const meta = shown
    ? html`<p class="muted">
        ${t(locale, 'web.rules.version', { version: shown.version })} ·
        ${t(
          locale,
          shown.effectiveFrom > options.now ? 'web.rules.effectiveFuture' : 'web.rules.effective',
          { date: date(shown.effectiveFrom) },
        )}
        ${shown.votedAt === null ? '' : html` · ${t(locale, 'web.rules.voted', { date: date(shown.votedAt) })}`}
      </p>`
    : '';

  const body = html`<h1>${title}</h1>
    ${options.canPublish ? html`<p><a href="${base}/new">${t(locale, 'web.rules.publish')}</a></p>` : ''}
    ${notice} ${meta}
    ${
      shown
        ? // Rendered from staff's Markdown with raw HTML shown as text (see markdown.ts).
          html`<article class="card rules">${raw(renderMarkdown(shown.markdown))}</article>`
        : html`<p class="muted">${t(locale, 'web.rules.none')}</p>`
    }
    ${
      page.versions.length > 0
        ? html`<h2>${t(locale, 'web.rules.history')}</h2>
            <ul class="card">
              ${page.versions.map(
                (version) =>
                  html`<li>
                    ${
                      version.id === shown?.id
                        ? html`<strong>${version.version}</strong>`
                        : html`<a href="${base}/${String(version.id)}">${version.version}</a>`
                    }
                    <span class="muted">
                      ·
                      ${t(
                        locale,
                        version.effectiveFrom > options.now
                          ? 'web.rules.effectiveFuture'
                          : 'web.rules.effective',
                        { date: date(version.effectiveFrom) },
                      )}
                      ${version.id === page.currentId ? html` · ${t(locale, 'web.rules.inForce')}` : ''}
                    </span>
                  </li>`,
              )}
            </ul>`
        : ''
    }`;
  return pageOf(title, body);
}

export interface RulesFormValues {
  version: string;
  markdown: string;
  effectiveOn: string;
  votedOn: string;
}

/** `/:org/:competition/rules/new`: staff publish a version, starting from the one in force. */
export function rulesFormView(
  locale: Locale,
  competition: Data['competition'],
  form: { values: RulesFormValues; error: PublishRulesError | null; csrf: string },
): Page {
  const title = t(locale, 'web.rules.form.title', { competition: competition.name });
  const { values } = form;
  const error: MessageKey | null = form.error && `web.rules.error.${form.error}`;
  const body = html`<h1>${title}</h1>
    <p><a href="${competition.path}/rules">${t(locale, 'web.rules.back')}</a></p>
    ${error ? html`<p class="card flash error">${t(locale, error)}</p>` : ''}
    <form class="card stack" method="post" action="${competition.path}/rules">
      ${csrfField(form.csrf)}
      <label for="version">${t(locale, 'web.rules.form.version')}</label>
      <input
        id="version"
        name="version"
        type="text"
        maxlength="60"
        required
        value="${values.version}"
      />
      <p class="muted">${t(locale, 'web.rules.form.versionHint')}</p>
      <label for="effective">${t(locale, 'web.rules.form.effective')}</label>
      <input
        id="effective"
        name="effective_on"
        type="date"
        required
        value="${values.effectiveOn}"
      />
      <label for="voted">${t(locale, 'web.rules.form.voted')}</label>
      <input id="voted" name="voted_on" type="date" value="${values.votedOn}" />
      <label for="markdown">${t(locale, 'web.rules.form.markdown')}</label>
      <textarea id="markdown" name="markdown" rows="24" required>${values.markdown}</textarea>
      <p class="muted">${t(locale, 'web.rules.form.markdownHint')}</p>
      <p class="muted">${t(locale, 'web.rules.form.final')}</p>
      <button type="submit">${t(locale, 'web.rules.form.submit')}</button>
    </form>`;
  return pageOf(title, body);
}
