import type { Context, Hono } from 'hono';
import type { Title } from '@ligo/titles';
import { titleOfWord } from '../services/paths.ts';
import { playerPage } from '../services/player-page.ts';
import { playerStats } from '../services/player-stats.ts';
import type { Env } from './app.ts';
import { playerPageView } from './pages/player.ts';
import type { RouteKit } from './route-kit.ts';

// A player's public page (phase 3i; design doc section 7, M-42): `/players/:slug` opens the game
// of the player's latest official match, `/players/:slug/:game` (`r6`, `rocket-league`…) one game.
// Public, no login: the services give only what may be shown.

export function playerRoutes(
  app: Hono<Env>,
  kit: Pick<RouteKit, 'deps' | 'render' | 'notFound'>,
): void {
  const { deps, render, notFound } = kit;
  const { db, locale } = deps;

  /** The page with `title`'s tab open; the latest game played when none is asked for. */
  const show = (c: Context<Env>, asked: Title | null) => {
    const found = playerPage(db, c.req.param('slug') ?? '');
    if (!found.ok) return notFound(c);
    const { player } = found;
    const title = asked ?? player.games[0] ?? null;
    // A game the player never played officially has no tab (design doc section 7).
    if (asked !== null && !player.games.includes(asked)) return notFound(c);
    const tab = title === null ? null : { title, stats: playerStats(db, player.id, title) };
    return render(c, playerPageView(locale, { player, tab }));
  };

  app.get('/players/:slug', (c) => show(c, null));
  app.get('/players/:slug/:game', (c) => {
    const title = titleOfWord(c.req.param('game'));
    return title === null ? notFound(c) : show(c, title);
  });
}
