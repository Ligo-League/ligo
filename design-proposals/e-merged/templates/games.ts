// Several games (design doc sections 7, 9 and 12, 16 November 2026): one player page per person
// with one tab per game, a game tab drawn from the title's declared features and metrics only,
// a Rocket League series (no veto, no maps), and /me with ranks by queue.

import * as D from '../../_data/index.ts';
import { html, href, icon, teamBadge, flag, type Raw } from '../../_build/lib.ts';
import { page } from './layout.ts';
import { team, panel, pill, playerLink, kv, tabs, signedCell } from './parts.ts';
import { photo } from './art.ts';

type TK = D.TitleKey;
const T = D.TITLE_INFO;
const sum = (games: D.TitleGame[], k: string) => games.reduce((n, g) => n + (g.values[k] ?? 0), 0);
const has = (games: D.TitleGame[], k: string) => games.filter((g) => g.values[k] !== null && g.values[k] !== undefined);
const ratio = (a: number, b: number) => (b ? D.ratio(a / b) : '–');
const oppName = (o: D.TitleGame['opponent']) => ('slug' in o ? team(o as D.Team, { size: 14 }) : html`<span class="tm"><span class="n">${o.name}</span></span>`);

export const playerTitleRoute = (slug: string, title: TK) => (title === D.titlesOf(slug)[0] ? `/players/${slug}` : `/players/${slug}/${T[title].route}`);

/** One tab per game the player has played officially. */
export function gameTabs(slug: string, active: TK): Raw {
  const list = D.titlesOf(slug);
  return tabs(list.map((k) => ({ label: T[k].name, route: playerTitleRoute(slug, k), active: k === active })), 'boxed gtabs');
}

/** The person, once: shared by every game tab. */
export function personHead(slug: string, active: TK): Raw {
  const p = D.player(slug);
  const accs = D.gameAccounts[slug] ?? [];
  const where = D.titlesOf(slug).map((k) => {
    const a = accs.find((x) => x.title === k);
    const tm = a?.team ? D.team(a.team) : k === 'rocket_league' ? D.rlTeamOf(slug) : D.teamOf(slug);
    return html`<span>${T[k].name} · ${tm ? team(tm, { size: 14 }) : 'sans équipe'}</span>`;
  });
  return html`<div class="head phead">${photo(slug, 64)}<div style="flex:1"><h1>${flag(p.nat, 16)} ${p.tag}</h1><div class="sub ph-where">${where}</div></div>
    <label class="f">Saison<select><option selected>En cours</option><option>Toutes</option></select></label></div>
  ${gameTabs(slug, active)}`;
}

/** Game accounts and ranks by ranked queue; the one shown is the player's choice (O-34). */
export function accountsPanel(slug: string): Raw {
  const accs = D.gameAccounts[slug] ?? (D.rlTeamOf(slug) ? [{ title: 'rocket_league' as TK, name: `${D.player(slug).tag} (Epic)`, ranks: { standard: 'Grand Champion I', doubles: 'Champion III' }, shown: 'standard', team: D.rlTeamOf(slug)?.slug ?? null }] : []);
  return panel(
    'Jeux et rangs',
    html`<table class="data dense"><caption class="vh">Comptes de jeu</caption><tbody>${accs.map(
      (a) => html`<tr class="daysep"><td colspan="2">${T[a.title].name} · <span class="faint">${a.name}</span></td></tr>
      ${T[a.title].queues.map((q) => html`<tr><th scope="row">${q.label}</th><td>${a.ranks[q.key] ? html`${a.shown === q.key ? html`<b>${a.ranks[q.key]}</b> <span class="faint">affiché</span>` : a.ranks[q.key]}` : html`<span class="faint">non renseigné</span>`}</td></tr>`)}`,
    )}</tbody></table><p class="pad faint small">Rangs déclarés par le joueur, sans vérification. Le rang affiché est copié à l’inscription d’une saison.</p>`,
  );
}

/** Career across every game: the person's CV. */
export function careerAll(slug: string): Raw {
  const r6 = (D.careers[slug] ?? []).map((c) => ({ game: 'R6', comp: `${c.competition} ${c.season}`, team: D.team(c.team), div: c.division, rank: c.rank, awards: c.awards.join(', ') }));
  const valo = slug === 'vexo' ? [{ game: 'Valorant', comp: 'LFV Saison 1', team: D.team('not-scam-valkyr'), div: 'Division 1', rank: '2e · Coupe en cours', awards: '' }] : [];
  const rl = D.rlTeamOf(slug) ? [{ game: 'RL', comp: 'LFRL Saison 1', team: D.rlTeamOf(slug) as D.Team, div: 'Division 1', rank: 'en cours', awards: '' }] : [];
  return panel(
    'Carrière · tous les jeux',
    html`<table class="data"><caption class="vh">Carrière</caption><thead><tr><th scope="col">Jeu</th><th scope="col">Saison</th><th scope="col">Équipe</th><th scope="col" class="opt">Division</th><th scope="col">Classement</th><th scope="col" class="opt">Récompenses</th></tr></thead><tbody>
    ${[...valo, ...rl, ...r6].map((c) => html`<tr><td class="faint">${c.game}</td><td>${c.comp}</td><td>${team(c.team, { size: 14 })}</td><td class="opt">${c.div}</td><td>${c.rank}</td><td class="opt wrapcell">${c.awards || html`<span class="faint">—</span>`}</td></tr>`)}</tbody></table>`,
  );
}

function personInfobox(slug: string, title: TK): Raw {
  const p = D.player(slug);
  const acc = (D.gameAccounts[slug] ?? []).find((a) => a.title === title);
  const tm = acc?.team ? D.team(acc.team) : D.rlTeamOf(slug);
  return html`<section class="panel infobox"><div class="ib-title">${p.tag}</div><div class="ib-logo">${photo(slug, 132)}</div>
    ${kv([
      ['Nationalité', html`${flag(p.nat)} ${p.nat}`],
      [`Équipe ${T[title].name}`, tm ? team(tm, { size: 16 }) : 'sans équipe'],
      ['Stats publiques', p.consent ? 'oui (politique acceptée)' : 'non'],
    ])}</section>`;
}

/** Derived figures each title shows at the top of its tab (from the metric schema in production). */
function headline(title: TK, games: D.TitleGame[]): [string, string][] {
  const rounds = games.reduce((n, g) => n + g.rounds, 0);
  const w = games.filter((g) => g.won).length;
  const base: [string, string][] = [[T[title].scoreUnit === 'goals' ? 'Matchs' : 'Cartes', `${games.length} · ${w} V – ${games.length - w} D`]];
  if (title === 'valorant')
    return [...base, ['K/D', ratio(sum(games, 'kills'), sum(games, 'deaths'))], ['ACS', rounds ? String(Math.round(sum(games, 'combat_score') / rounds)) : '–'], ['Kills par round', ratio(sum(games, 'kills'), rounds)], ['Premiers kills', `${sum(games, 'first_kills')}–${sum(games, 'first_deaths')} (${D.signed(sum(games, 'first_kills') - sum(games, 'first_deaths'))})`]];
  const rep = has(games, 'shots');
  return [...base, ['Buts', `${sum(games, 'goals')} · ${ratio(sum(games, 'goals'), games.length)} par match`], ['Passes décisives', `${sum(games, 'assists')} · ${ratio(sum(games, 'assists'), games.length)} par match`], ['Tirs cadrés en but', rep.length ? `${D.pct(sum(rep, 'goals') / Math.max(1, sum(rep, 'shots')))} (${rep.length} matchs avec replay)` : '–']];
}

/** A game's tab, drawn only from what the title declares: no map, side or character section when the game has none. */
export function playerTitlePage(slug: string, title: TK): string {
  const info = T[title];
  const games = title === 'valorant' ? D.vexoValorant : D.rlPlayerGames(slug);
  const split = (key: (g: D.TitleGame) => string | null, label: string) => {
    const groups = new Map<string, D.TitleGame[]>();
    for (const g of games) {
      const k = key(g);
      if (k) groups.set(k, [...(groups.get(k) ?? []), g]);
    }
    return panel(
      `Par ${label.toLowerCase()}`,
      html`<table class="data dense"><caption class="vh">Par ${label}</caption><thead><tr><th scope="col">${label}</th><th scope="col" class="num">Cartes</th><th scope="col" class="num">V–D</th><th scope="col" class="num">K–D</th><th scope="col" class="num">ACS</th></tr></thead><tbody>
      ${[...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, l]) => {
        const rounds = l.reduce((n, g) => n + g.rounds, 0);
        return html`<tr><th scope="row">${k}</th><td class="num">${l.length}</td><td class="num">${l.filter((g) => g.won).length}–${l.filter((g) => !g.won).length}</td><td class="num">${sum(l, 'kills')}–${sum(l, 'deaths')}</td><td class="num">${Math.round(sum(l, 'combat_score') / rounds)}</td></tr>`;
      })}</tbody></table>`,
    );
  };
  const tm = title === 'valorant' ? D.team('not-scam-valkyr') : (D.rlTeamOf(slug) as D.Team);
  const main = html`
  ${personHead(slug, title)}
  ${panel(
    `${games[0]?.competition ?? ''} · ${tm.name}`,
    html`<div class="figs">${headline(title, games).map(([k, v]) => html`<div><span class="lbl">${k}</span><b>${v}</b></div>`)}</div>`,
    { extra: html`<span class="faint">${title === 'valorant' ? 'saisie manuelle (pas encore de replays Valorant)' : 'replays PC, saisie manuelle pour les consoles'}</span>` },
  )}
  ${info.maps || info.characters ? html`<div class="grid2">${info.maps ? split((g) => g.map, 'Carte') : ''}${info.characters ? split((g) => g.character, info.characters.one) : ''}</div>` : ''}
  ${panel(
    'Journal des matchs',
    html`<div class="tw"><table class="data tagm dense"><caption class="vh">Journal</caption><thead><tr><th scope="col">Date</th><th scope="col">Adversaire</th>${info.maps ? html`<th scope="col" class="opt">Carte</th>` : ''}${info.characters ? html`<th scope="col" class="opt">${info.characters.one}</th>` : ''}<th scope="col" class="num">Score</th>
      ${info.metrics.map((m) => html`<th scope="col" class="num ${m.manual ? '' : 'opt'}"><abbr title="${m.label}${m.manual ? '' : ' (replays seulement)'}">${m.short}</abbr></th>`)}<th scope="col" class="opt">Source</th></tr></thead><tbody>
    ${games.map((g) => html`<tr><td class="faint">${D.dateShort(g.at)}</td><td>${oppName(g.opponent)}</td>${info.maps ? html`<td class="opt">${g.map}</td>` : ''}${info.characters ? html`<td class="opt">${g.character}</td>` : ''}<td class="num"><span class="${g.won ? 'pos' : 'neg'}">${g.won ? 'V' : 'D'} ${g.score[0]}–${g.score[1]}</span></td>
      ${info.metrics.map((m) => html`<td class="num ${m.manual ? '' : 'opt'}">${g.values[m.key] ?? html`<span class="faint">–</span>`}</td>`)}<td class="opt faint">${g.source === 'replay' ? 'replay' : 'manuel'}</td></tr>`)}
    </tbody></table></div>
    <p class="pad faint small">Colonnes tirées du schéma de stats de ${info.name}${info.metrics.some((m) => !m.manual) ? ' ; « – » : stat venant des replays, absente d’un match saisi à la main' : ''}.</p>`,
  )}
  ${careerAll(slug)}`;
  return page({
    title: `${D.player(slug).tag} · ${info.name}`,
    crumbs: [['Ligo', '/'], ['Joueurs', null], [D.player(slug).tag, `/players/${slug}`], [info.name, null]],
    main,
    game: title,
    cols: 'right',
    right: html`${personInfobox(slug, title)}${accountsPanel(slug)}${panel(tm.name, html`<p class="pad">${team(tm, { size: 18 })}<br><span class="faint">${title === 'valorant' ? 'LFV · Division 1 · club Not Scam' : 'LFRL · Division 1 · club W Mates'}</span></p>`)}`,
  });
}

// ---------------------------------------------------------------------------------------------
// Rocket League series: no veto, no maps, no rounds; goals and assists per game.

export function rlSeriesPage(s: D.RlSeries): string {
  const games = D.rlGames(s);
  const wa = s.games.filter((g) => g[0] > g[1]).length;
  const wb = s.games.length - wa;
  const metrics = T.rocket_league.metrics;
  const side = (tm: D.Team, k: 'a' | 'b') => html`<a class="hx-team ${k}" href="${href(`/teams/${tm.slug}`)}">${teamBadge(tm, { size: 52 })}<span class="hx-txt"><span class="hx-n">${tm.name}</span><span class="hx-tg">${tm.tag}</span><span class="hx-m">LFRL · Division 1</span></span></a>`;
  const board = (lines: D.RlPlayerLine[], k: 'a' | 'b', tm: D.Team) => html`<table class="data dense sb"><caption class="vh">${tm.name}</caption><thead><tr><th scope="col">${team(tm, { size: 14 })}</th>${metrics.map((m) => html`<th scope="col" class="num ${m.manual ? '' : 'opt'}"><abbr title="${m.label}">${m.short}</abbr></th>`)}</tr></thead><tbody>
    ${lines.filter((l) => l.side === k).map((l) => html`<tr><th scope="row">${playerLink(l.player)}</th>${metrics.map((m) => html`<td class="num ${m.manual ? '' : 'opt'}">${l.values[m.key] ?? html`<span class="faint">–</span>`}</td>`)}</tr>`)}</tbody></table>`;
  const totals = (k: 'a' | 'b', tm: D.Team) => {
    const ids = D.rlRosters.get(tm.slug) ?? [];
    const lines = ids.map((p) => ({ player: p, side: k, values: Object.fromEntries(metrics.map((m) => {
      const vals = games.map((g) => g.lines.find((l) => l.player === p)?.values[m.key]);
      // Replay-only stats: summed over the games that have them (the footnote says how many).
      return [m.key, vals.reduce<number>((n, v) => n + (v ?? 0), 0)];
    })) }));
    return board(lines, k, tm);
  };
  const main = html`
  <section class="hx">
    <div class="hx-ctx"><a href="${href('/mbl-group/lfrl/s1')}">LFRL Saison 1</a> · Division 1 · Semaine ${s.week} · BO5</div>
    <div class="hx-body">${side(s.a, 'a')}<div class="hx-mid"><div class="hx-score"><span class="${wa > wb ? 'w' : ''}">${wa}</span><span class="sep">–</span><span class="${wb > wa ? 'w' : ''}">${wb}</span></div><div class="hx-when">série · ${pill('done', 'Validé', 'check')}</div></div>${side(s.b, 'b')}</div>
    <div class="hx-line"><span>${icon('calendar', 12)} <b>${D.when(s.at)}</b></span><span>Buts <b>${s.games.reduce((n, g) => n + g[0], 0)}–${s.games.reduce((n, g) => n + g[1], 0)}</b></span><span>Matchs <b>${s.games.map((g) => `${g[0]}–${g[1]}`).join(' · ')}</b></span><span>Pas de veto : Rocket League n’a pas de cartes à bannir</span></div>
  </section>
  ${tabs([{ label: 'Série', route: `/matches/${s.id}`, active: true }], 'mtabs')}
  ${panel(
    'Matchs de la série',
    html`<table class="data dense"><caption class="vh">Matchs</caption><thead><tr><th scope="col">Match</th><th scope="col" class="num">Score</th><th scope="col">Vainqueur</th><th scope="col" class="opt">Prolongation</th><th scope="col">Stats</th></tr></thead><tbody>
    ${games.map((g) => html`<tr><td>Match ${g.n}</td><td class="num"><b>${g.score[0]}–${g.score[1]}</b></td><td>${team(g.score[0] > g.score[1] ? s.a : s.b, { size: 14, tagOnly: true })}</td><td class="opt">${g.overtime ? 'oui' : 'non'}</td><td>${g.source === 'replay' ? pill('done', 'Replay', 'check') : pill('muted', 'Saisie manuelle')}</td></tr>`)}</tbody></table>`,
    { extra: html`<span class="faint">la série compte les buts au classement</span>` },
  )}
  ${panel('Joueurs · toute la série', html`${totals('a', s.a)}${totals('b', s.b)}<p class="pad faint small">Buts et passes décisives : les ${games.length} matchs. Arrêts, tirs, score et démolitions : les ${games.filter((g) => g.source === 'replay').length} matchs avec replay seulement.</p>`)}
  ${games.map((g) => panel(`Match ${g.n} · ${g.score[0]}–${g.score[1]}${g.overtime ? ' (prolongation)' : ''}`, html`<div class="grid2 flat">${board(g.lines, 'a', s.a)}${board(g.lines, 'b', s.b)}</div>`, { extra: g.source === 'replay' ? pill('done', 'Replay', 'check') : pill('muted', 'Saisie manuelle : console') }))}`;
  const rows = D.rlStandings();
  const marked = new Set([s.a.slug, s.b.slug]);
  const right = html`${panel('Données du match', kv([
    ['Format', 'BO5, premier à 3 matchs'],
    ['Veto', 'aucun (réglage du jeu)'],
    ['Stats', '4 matchs en replay, 1 saisi à la main'],
    ['Capture du score', html`${icon('lock', 11)} <span class="faint">staff et les deux équipes</span>`],
  ]))}
  ${panel('Division 1', html`<table class="st mini"><caption class="vh">Classement LFRL</caption><thead><tr><th scope="col" class="num">#</th><th scope="col" class="tl">Équipe</th><th scope="col" class="num">MJ</th><th scope="col" class="num">Diff</th><th scope="col" class="num pts">PTS</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr class="${marked.has(r.team.slug) ? 'is-me' : ''}"><td class="num">${r.rank}</td><th scope="row" class="tl">${team(r.team, { size: 14, tagOnly: true })}</th><td class="num">${r.played}</td><td class="num">${signedCell(r.diff)}</td><td class="num pts">${r.points}</td></tr>`)}</tbody></table>`, { extra: html`<span class="faint">division du match</span>` })}`;
  return page({
    title: `${s.a.tag}–${s.b.tag} · Rocket League`,
    crumbs: [['Ligo', '/'], ['LFRL', '/mbl-group/lfrl/s1'], [`Semaine ${s.week}`, null], [`${s.a.tag} – ${s.b.tag}`, null]],
    main, league: { comp: 'lfrl', season: 's1', tab: 'calendar' }, game: 'rocket_league', cols: 'right', right,
  });
}

// ---------------------------------------------------------------------------------------------
// /me: the player's own profile, game accounts and ranks by queue.

export function mePage(): string {
  const slug = 'vexo';
  const p = D.player(slug);
  const main = html`
  <div class="head phead">${photo(slug, 64)}<div style="flex:1"><h1>Mon profil</h1><div class="sub">Ce que vous déclarez ici vaut pour toutes vos ligues. Personne d’autre ne le remplit pour vous.</div></div></div>
  ${panel('Identité', html`<form class="mform" action="#save">${kv([
    ['Pseudo', html`<input value="${p.tag}">`],
    ['Nationalité', html`<select><option selected>France</option><option>Belgique</option><option>Suisse</option></select>`],
    ['Photo', html`<a class="btn" href="#photo">${icon('upload', 12)} Changer</a> <span class="faint">carrée, 512 px conseillés</span>`],
    ['Politique de confidentialité', html`${pill('done', 'Acceptée', 'check')} <span class="faint">le 2 sept. 2026 · elle couvre la publication de vos stats</span>`],
  ])}</form>`)}
  ${(D.gameAccounts[slug] ?? []).map((a) => panel(
    `${T[a.title].name}`,
    html`<form class="mform" action="#save">${kv([
      ['Compte', html`<input value="${a.name}"> <span class="faint">${a.title === 'r6' ? 'nom Ubisoft ; le profileID se lie au premier replay' : 'Riot ID'}</span>`],
      ...T[a.title].queues.map((q): [string, Raw] => [`Rang ${q.label}`, html`<select><option>${a.ranks[q.key] ?? 'Non classé'}</option></select> <label class="f-inline"><input type="radio" name="shown-${a.title}" ${a.shown === q.key ? 'checked' : ''}> afficher celui-ci</label>`]),
      ['Équipe', a.team ? team(D.team(a.team), { size: 16 }) : 'sans équipe'],
    ])}</form>`,
    { extra: html`<span class="faint">${T[a.title].queues.length > 1 ? 'un rang par file classée, tous facultatifs' : 'rang facultatif'}</span>` },
  ))}
  ${panel('Ajouter un jeu', html`<p class="pad">${D.games.filter((g) => !(D.gameAccounts[slug] ?? []).some((a) => (a.title === 'r6' ? 'r6' : a.title) === g.key)).map((g) => html`<a class="btn" href="#add-${g.key}">${g.name}</a> `)}</p><p class="pad faint small">Un compte par jeu : celui avec lequel vous jouez vos matchs de ligue.</p>`)}`;
  return page({ title: 'Mon profil', crumbs: [['Ligo', '/'], ['Mon profil', null]], main, cols: 'right', right: accountsPanel(slug), viewer: { name: 'Vexo', role: 'Joueur · Greed Esport', team: 'greed-esport', player: 'vexo' } });
}
