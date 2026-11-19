import { R6_RANKS, type Title } from '@ligo/titles';
import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import { regionName } from '../../services/me.ts';
import { playerPath } from '../../services/paths.ts';
import type { CareerLine, PlayerPageData } from '../../services/player-page.ts';
import type { PlayerStats } from '../../services/player-stats.ts';
import { formatDay, formatWhen, pageOf, type Html, type Page } from '../layout.ts';
import { figure } from './match.ts';

// A player's public page (phase 3i; design doc section 7, M-42): the person once, the career,
// then one tab per game played officially. It shows nothing private: no profile ID, birth date,
// Discord ID or email reaches this view. Figures only for a player who accepted public stats.

const TITLE_KEYS = {
  r6: 'title.r6',
  valorant: 'title.valorant',
  rocket_league: 'title.rocket_league',
  lol: 'title.lol',
  cs: 'title.cs',
} as const satisfies Record<Title, MessageKey>;

const ROLE_KEYS = {
  player: 'web.registration.starter',
  sub: 'web.registration.sub',
  coach: 'web.player.role.coach',
} as const satisfies Record<'player' | 'sub' | 'coach', MessageKey>;

/** Matches and results are shown in French time, as everywhere on the site. */
const TIME_ZONE = 'Europe/Paris';

/** A declared rank by its name in the catalog; a rank of a game Ligo has no list for, as stored. */
function rankName(locale: Locale, title: Title, rank: string): string {
  const known = title === 'r6' ? R6_RANKS.find((candidate) => candidate === rank) : undefined;
  return known ? t(locale, `rank.r6.${known}`) : rank;
}

/** "1", "6=" when shared, "EX" for an excluded team, as the standings show it. */
function rankText(rank: CareerLine['rank']): string {
  if (!rank) return '–';
  if (rank.excluded) return 'EX';
  return `${String(rank.place)}${rank.shared ? '=' : ''}`;
}

function header(locale: Locale, player: PlayerPageData): Html {
  const country = player.nationality ? regionName(locale, player.nationality) : undefined;
  return html`<h1>${player.name}</h1>
    <dl class="card facts">
      <dt>${t(locale, 'web.player.nationality')}</dt>
      <dd>${country ?? '–'}</dd>
      <dt>${t(locale, 'web.player.teams')}</dt>
      <dd>
        ${
          player.teams.length === 0
            ? '–'
            : player.teams.map(
                (team, index) =>
                  html`${index > 0 ? html`<br />` : ''}<a href="/teams/${team.slug}"
                      >${team.name}</a
                    >
                    <span class="muted"
                      >·
                      ${t(locale, TITLE_KEYS[team.title])}${
                        team.role ? html` · ${t(locale, ROLE_KEYS[team.role])}` : ''
                      }${team.captain ? html` · ${t(locale, 'web.registration.captain')}` : ''}</span
                    >`,
              )
        }
      </dd>
      <dt>${t(locale, 'web.player.accounts')}</dt>
      <dd>
        ${
          player.accounts.length === 0
            ? '–'
            : player.accounts.map(
                (account, index) =>
                  html`${index > 0 ? html`<br />` : ''}${t(locale, TITLE_KEYS[account.title])} ·
                  ${account.name}${
                    account.rank
                      ? html` · ${rankName(locale, account.title, account.rank)}
                          <span class="muted"
                            >(${t(
                              locale,
                              account.verified ? 'web.player.verified' : 'web.player.declared',
                            )})</span
                          >`
                      : ''
                  }`,
              )
        }
      </dd>
      <dt>${t(locale, 'web.player.statsPublic')}</dt>
      <dd>${t(locale, player.statsPublic ? 'web.player.yes' : 'web.player.no')}</dd>
    </dl>`;
}

function career(locale: Locale, lines: readonly CareerLine[]): Html {
  if (lines.length === 0) return html`<p class="muted">${t(locale, 'web.player.noCareer')}</p>`;
  return html`<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th scope="col">${t(locale, 'web.player.game')}</th>
          <th scope="col">${t(locale, 'web.player.season')}</th>
          <th scope="col">${t(locale, 'web.player.team')}</th>
          <th scope="col">${t(locale, 'web.player.division')}</th>
          <th scope="col">${t(locale, 'web.player.rank')}</th>
          <th scope="col">${t(locale, 'web.player.role')}</th>
        </tr>
      </thead>
      <tbody>
        ${lines.map(
          (line) =>
            html`<tr>
              <td>${t(locale, TITLE_KEYS[line.title])}</td>
              <td>
                <a href="${line.season.path}">${line.competition.name} · ${line.season.name}</a>
              </td>
              <td><a href="/teams/${line.team.slug}">${line.team.name}</a></td>
              <td>${line.division ?? '–'}</td>
              <td>
                ${rankText(line.rank)}${
                  line.season.status === 'closed'
                    ? ''
                    : html` <span class="muted">(${t(locale, 'web.player.ongoing')})</span>`
                }
              </td>
              <td>${t(locale, ROLE_KEYS[line.role])}</td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

type Columns = PlayerStats['columns'];

const headCells = (locale: Locale, columns: Columns) =>
  columns.map((column) => html`<th scope="col">${column.label[locale]}</th>`);
const valueCells = (locale: Locale, columns: Columns, values: Record<string, number | null>) =>
  columns.map((column) => html`<td>${figure(locale, column, values[column.key])}</td>`);

/** Totals, one row each: per season or per map. */
function totals(
  locale: Locale,
  columns: Columns,
  first: MessageKey,
  rows: readonly { label: Html; games: number; values: Record<string, number | null> }[],
): Html {
  return html`<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th scope="col">${t(locale, first)}</th>
          <th scope="col">${t(locale, 'web.player.maps')}</th>
          ${headCells(locale, columns)}
        </tr>
      </thead>
      <tbody>
        ${rows.map(
          (row) =>
            html`<tr>
              <th scope="row">${row.label}</th>
              <td>${String(row.games)}</td>
              ${valueCells(locale, columns, row.values)}
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

const RESULT_KEYS = {
  win: 'web.player.result.win',
  loss: 'web.player.result.loss',
  draw: 'web.player.result.draw',
} as const satisfies Record<'win' | 'loss' | 'draw', MessageKey>;

/** The game log: one row per map the player has figures in. */
function matchLog(locale: Locale, stats: PlayerStats): Html {
  const columns = stats.hidden ? [] : stats.columns;
  return html`<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th scope="col">${t(locale, 'web.player.date')}</th>
          <th scope="col">${t(locale, 'web.player.opponent')}</th>
          <th scope="col">${t(locale, 'web.player.map')}</th>
          <th scope="col">${t(locale, 'web.player.score')}</th>
          ${headCells(locale, columns)}
        </tr>
      </thead>
      <tbody>
        ${stats.matches.flatMap((entry) =>
          entry.games.map(
            (game) =>
              html`<tr>
                <td>
                  <a href="/matches/${String(entry.id)}"
                    >${(entry.timed ? formatWhen : formatDay)(locale, entry.at, TIME_ZONE)}</a
                  >
                </td>
                <td>
                  <a href="/teams/${entry.opponent.slug}">${entry.opponent.name}</a>
                </td>
                <td>${game.map ?? '–'}</td>
                <td>
                  ${t(locale, RESULT_KEYS[entry.result])}
                  ${String(game.scoreFor)}–${String(game.scoreAgainst)}
                </td>
                ${game.values ? valueCells(locale, columns, game.values) : ''}
              </tr>`,
          ),
        )}
      </tbody>
    </table>
  </div>`;
}

function gameTab(locale: Locale, stats: PlayerStats): Html {
  const hidden = stats.hidden
    ? html`<p class="card muted">${t(locale, 'web.player.statsHidden')}</p>`
    : '';
  const sums = stats.hidden
    ? ''
    : html`<h3>${t(locale, 'web.player.bySeason')}</h3>
        ${totals(
          locale,
          stats.columns,
          'web.player.season',
          stats.seasons.map((entry) => ({
            label: html`<a href="${entry.season.path}"
              >${entry.competition.name} · ${entry.season.name}</a
            >`,
            games: entry.games,
            values: entry.values,
          })),
        )}
        ${
          stats.maps.length === 0
            ? ''
            : html`<h3>${t(locale, 'web.player.byMap')}</h3>
                ${totals(
                  locale,
                  stats.columns,
                  'web.player.map',
                  stats.maps.map((entry) => ({
                    label: html`${entry.map}`,
                    games: entry.games,
                    values: entry.values,
                  })),
                )}`
        }`;
  return html`${hidden}${sums}
    <h3>${t(locale, 'web.player.matches')}</h3>
    ${matchLog(locale, stats)}`;
}

export interface PlayerPageViewData {
  player: PlayerPageData;
  /** The game whose tab is open, with its matches and stats; null when there is none. */
  tab: { title: Title; stats: PlayerStats } | null;
}

export function playerPageView(locale: Locale, data: PlayerPageViewData): Page {
  const { player, tab } = data;
  return pageOf(
    player.name,
    html`${header(locale, player)}
      <h2>${t(locale, 'web.player.career')}</h2>
      ${career(locale, player.career)}
      <h2>${t(locale, 'web.player.games')}</h2>
      ${
        tab === null
          ? html`<p class="muted">${t(locale, 'web.player.noGames')}</p>`
          : html`<nav class="tabs" aria-label="${t(locale, 'web.player.games')}">
                ${player.games.map(
                  (title) =>
                    html`<a
                      href="${playerPath(player.slug, title)}"
                      ${title === tab.title ? html`aria-current="page"` : ''}
                      >${t(locale, TITLE_KEYS[title])}</a
                    >`,
                )}
              </nav>
              ${gameTab(locale, tab.stats)}`
      }`,
  );
}
