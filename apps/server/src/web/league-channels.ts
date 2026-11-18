import type { Context, Hono } from 'hono';
import { t } from '../i18n/index.ts';
import { findCompetitionAt } from '../services/competitions.ts';
import {
  LEAGUE_CHANNEL_KINDS,
  listLeagueChannels,
  setLeagueChannel,
} from '../services/league-channels.ts';
import type { Env, Viewer } from './app.ts';
import { messagePage } from './pages/errors.ts';
import { CHANNEL_ERRORS, leagueChannelsPage, type ChannelError } from './pages/league-channels.ts';
import type { RouteKit } from './route-kit.ts';
import { webActor } from './roles.ts';

// `/:org/:competition/discord/channels` (phase 3f-6; design doc section 7): league staff choose
// the channels the bot posts in, as with `/league channel`, through the same service. Staff is
// asked of the league's Discord server on every request and checked again by the service, which
// also refuses a channel outside the league's server.

const ROW_ID = /^[1-9]\d{0,9}$/;
const SNOWFLAKE = /^\d{17,20}$/;
const field = (form: Record<string, unknown>, name: string) =>
  typeof form[name] === 'string' ? form[name] : '';

export function leagueChannelsRoutes(app: Hono<Env>, kit: RouteKit): void {
  const { deps, render, notFound, forbidden, guard } = kit;
  const { db, locale } = deps;
  const path = '/:org/:competition/discord/channels';

  /** The competition at the address, with the viewer as its staff; a Response otherwise. */
  const staffAt = async (c: Context<Env>, viewer: Viewer) => {
    const found = findCompetitionAt(db, {
      org: c.req.param('org') ?? '',
      competition: c.req.param('competition') ?? '',
    });
    if (!found) return notFound(c);
    const actor = await webActor(db, deps.roles, viewer, found.id, deps.now());
    const listed = actor && listLeagueChannels(db, actor);
    if (!actor?.guildId || !listed?.ok) return forbidden(c);
    return { found, actor, guildId: actor.guildId, listed };
  };

  app.get(path, async (c) => {
    if (!deps.login) return notFound(c);
    const viewer = c.get('viewer');
    if (!viewer) return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 303);
    const staff = await staffAt(c, viewer);
    if (staff instanceof Response) return staff;
    let channels;
    try {
      channels = await deps.gateway.guildTextChannels(staff.guildId);
    } catch {
      channels = null;
    }
    if (!channels) {
      const unavailable = messagePage(
        locale,
        t(locale, 'web.discord.unavailable.title'),
        t(locale, 'web.discord.unavailable.body'),
      );
      return render(c, unavailable, 502);
    }
    const error = CHANNEL_ERRORS.find((entry) => entry === c.req.query('error'));
    c.header('Cache-Control', 'no-store');
    return render(
      c,
      leagueChannelsPage(locale, {
        competition: { name: staff.found.name, path: staff.found.path },
        current: staff.listed,
        channels,
        csrf: viewer.csrf,
        flash: error ? { error } : c.req.query('saved') === '1' ? { saved: true } : null,
      }),
    );
  });

  app.post(path, async (c) => {
    const guarded = await guard(c);
    if (guarded instanceof Response) return guarded;
    const { viewer, form } = guarded;
    const staff = await staffAt(c, viewer);
    if (staff instanceof Response) return staff;
    const back = (query: string) =>
      c.redirect(`${staff.found.path}/discord/channels?${query}`, 303);
    const kind = LEAGUE_CHANNEL_KINDS.find((entry) => entry === field(form, 'kind'));
    if (!kind) return back('error=channel_required');
    const division = field(form, 'division');
    const channel = field(form, 'channel');
    if (division !== '' && !ROW_ID.test(division)) return back('error=division_not_found');
    if (channel !== '' && !SNOWFLAKE.test(channel)) return back('error=channel_not_in_server');
    const reply = await setLeagueChannel(
      db,
      deps.gateway,
      staff.actor,
      {
        kind,
        channelId: channel === '' ? null : channel,
        divisionId: division === '' ? null : Number(division),
        notice: (name) =>
          name === null
            ? t(locale, `league.channel.notice.${kind}`)
            : t(locale, 'league.channel.notice.resultsDivision', { division: name }),
      },
      deps.now(),
    );
    if (reply.ok) return back('saved=1');
    const error: ChannelError | undefined = CHANNEL_ERRORS.find((entry) => entry === reply.error);
    return error ? back(`error=${error}`) : forbidden(c);
  });
}
