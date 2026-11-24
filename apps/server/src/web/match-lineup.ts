import { listLeagueMatches, type LeagueMatch } from '@ligo/db';
import type { Context, Hono } from 'hono';
import { html } from 'hono/html';
import { t } from '../i18n/index.ts';
import {
  announceLineup,
  announcedPlayers,
  lineupChoices,
  mayAnnounce,
  type AnnounceLineupError,
} from '../services/match-lineup.ts';
import { mossCheck } from '../services/moss.ts';
import { requireStaff } from '../services/permissions.ts';
import type { Env, Viewer } from './app.ts';
import { csrfField, type Html } from './layout.ts';
import { webActor } from './roles.ts';
import type { RouteKit } from './route-kit.ts';

// The players of a match, on the match page (M-47, maintainer 24 November 2026): where the league
// takes MOSS files from the lineup, each team's officials and captain say who plays this match,
// its roster's starters by default, until the result is reported; staff at any time. Each player
// ticked owes a MOSS file.

const ROW_ID = /^[1-9]\d{0,9}$/;
const ERRORS = ['not_allowed', 'locked', 'too_few', 'not_on_roster'] as const;
type Side = 'a' | 'b';

export function matchLineupRoutes(
  app: Hono<Env>,
  kit: RouteKit,
): { panel: (c: Context<Env>, matchId: number) => Promise<Html | string> } {
  const { deps, notFound, forbidden, guard } = kit;
  const { db, locale } = deps;

  const isStaff = async (viewer: Viewer, found: LeagueMatch) => {
    const actor = await webActor(db, deps.roles, viewer, found.competitionId, deps.now());
    return actor !== null && requireStaff(db, actor, { matchId: found.id }).ok;
  };
  /** The match, when its league takes MOSS files from the lineup and it is still to count. */
  const lineupMatch = (matchId: number) => {
    const [found] = listLeagueMatches(db, { matchId });
    if (!found || found.status === 'forfeit' || found.status === 'void') return null;
    const moss = mossCheck(db, found);
    return moss.required && moss.from === 'lineup' ? found : null;
  };

  const panel = async (c: Context<Env>, matchId: number): Promise<Html | string> => {
    const viewer = c.get('viewer');
    const found = lineupMatch(matchId);
    if (!viewer || !found) return '';
    const staff = await isStaff(viewer, found);
    const sides = (['a', 'b'] as const).filter(
      (side) => mayAnnounce(db, found, side, { playerId: viewer.playerId, staff }) === null,
    );
    if (sides.length === 0) return '';
    const done = c.req.query('lineup') === 'done';
    const error = ERRORS.find((code) => code === c.req.query('lineup_error'));
    return html`<section id="lineup" class="card">
      <h2>${t(locale, 'web.lineup.title')}</h2>
      <p class="muted">${t(locale, 'web.lineup.help')}</p>
      ${done ? html`<p class="flash">${t(locale, 'web.lineup.done')}</p>` : ''}
      ${error ? html`<p class="flash error">${t(locale, `web.lineup.error.${error}`)}</p>` : ''}
      ${sides.map((side) => sideForm(found, side, viewer.csrf))}
    </section>`;
  };

  const sideForm = (found: LeagueMatch, side: Side, csrf: string): Html => {
    const chosen = new Set(announcedPlayers(db, found, side).map((p) => p.playerId));
    return html`<form method="post" action="/matches/${String(found.id)}/lineup/${side}">
      ${csrfField(csrf)}
      <h3>${found[side].name}</h3>
      <ul>
        ${lineupChoices(db, found, side).map(
          (choice) =>
            html`<li>
              <label
                ><input
                  type="checkbox"
                  name="player_${String(choice.playerId)}"
                  ${chosen.has(choice.playerId) ? 'checked' : ''}
                />
                ${choice.name}
                <span class="muted">${t(locale, `web.lineup.role.${choice.role}`)}</span></label
              >
            </li>`,
        )}
      </ul>
      <button type="submit">${t(locale, 'web.lineup.save')}</button>
    </form>`;
  };

  app.post('/matches/:id/lineup/:side', async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const id = c.req.param('id');
    const side = (['a', 'b'] as const).find((entry) => entry === c.req.param('side'));
    const found = ROW_ID.test(id) ? lineupMatch(Number(id)) : null;
    if (!found || !side) return notFound(c);
    const { viewer, form } = guarded;
    const players = Object.keys(form).flatMap((name) => {
      const playerId = /^player_([1-9]\d{0,9})$/.exec(name)?.[1];
      return playerId ? [Number(playerId)] : [];
    });
    const staff = await isStaff(viewer, found);
    const reply = announceLineup(
      db,
      found,
      side,
      { playerId: viewer.playerId, staff },
      players,
      deps.now(),
    );
    const back = (query: string) => c.redirect(`/matches/${String(found.id)}?${query}#lineup`, 303);
    if (reply.ok) return back('lineup=done');
    const error: AnnounceLineupError = reply.error;
    return error === 'not_allowed' ? forbidden(c) : back(`lineup_error=${error}`);
  });

  return { panel };
}
