import { slugify } from '@ligo/core';
import { Marked, type Tokens } from 'marked';

// Markdown written by league staff, shown to everyone (the rulebook). Raw HTML is shown as text,
// links keep only web, mail and same-site addresses, and images become links: the page then runs
// no script and loads nothing from elsewhere, whatever the text holds.

const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

// `//host` is another site; `/path` and `#anchor` are this one.
const SAFE_HREF = /^(?:https?:\/\/|mailto:|\/(?!\/)|#)/i;

const linkTo = (href: string, title: string | null | undefined, inner: string): string =>
  SAFE_HREF.test(href)
    ? `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''}` +
      `${href.startsWith('/') || href.startsWith('#') ? '' : ' rel="nofollow noopener"'}>${inner}</a>`
    : inner;

/** The HTML of a Markdown text, safe to insert as it is. */
export function renderMarkdown(markdown: string): string {
  // Anchors are numbered per text, so each call has its own parser.
  const used = new Set<string>();
  let headings = 0;
  const anchorOf = (text: string): string => {
    headings += 1;
    const slug = slugify(text);
    const base = slug.ok ? slug.slug : `section-${String(headings)}`;
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${String(n)}`;
    used.add(id);
    return id;
  };

  const marked = new Marked({
    gfm: true,
    async: false,
    renderer: {
      html({ text }: Tokens.HTML | Tokens.Tag): string {
        return escapeHtml(text);
      },
      heading({ tokens, depth, text }: Tokens.Heading): string {
        const inner = this.parser.parseInline(tokens);
        return `<h${String(depth)} id="${anchorOf(text)}">${inner}</h${String(depth)}>\n`;
      },
      link({ href, title, tokens }: Tokens.Link): string {
        return linkTo(href, title, this.parser.parseInline(tokens));
      },
      image({ href, title, text }: Tokens.Image): string {
        return linkTo(href, title, escapeHtml(text));
      },
    },
  });
  return marked.parse(markdown, { async: false });
}
