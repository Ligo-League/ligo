import { html } from 'hono/html';
import { moveLine } from '../../discord/move-posts.ts';
import { t, type Locale } from '../../i18n/index.ts';
import type { PublicMove } from '../../services/roster-move-data.ts';
import { formatWhen, type Html } from '../layout.ts';

/** A season's approved mercato moves, latest first, with the roster each concerns. */
export function movesList(locale: Locale, moves: readonly PublicMove[], timeZone: string): Html {
  if (moves.length === 0) return html``;
  return html`<h2>${t(locale, 'web.moves.title')}</h2>
    <ul class="card">
      ${moves.map(
        (entry) =>
          html`<li>
            <span class="muted">${formatWhen(locale, entry.at, timeZone)}</span> ·
            <a href="/teams/${entry.team.slug}">${entry.team.name}</a> :
            ${moveLine(locale, entry.move)}
          </li>`,
      )}
    </ul>`;
}
