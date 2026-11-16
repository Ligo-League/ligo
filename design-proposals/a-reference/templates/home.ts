// Home (the group's scoreboard), the organisation page and the season hubs (LFR, LFRL, LFV).

import * as D from '../../_data/index.ts';
import { html, href, icon, raw, type Raw } from '../../_build/lib.ts';
import { t } from '../../_build/i18n.ts';
import { statusOf, scoreOf, weekMatches, latestResults, divisionName } from '../../_build/shared.ts';
import { page, rightSidebar, themeVars } from './layout.ts';
import { team, panel, pill, status, miniStandings, matchRow, matchHref, standingsTable, sourceBadge, empty, signedCell, form, kv } from './parts.ts';

const STATUS: Record<D.SeasonStatus, [string, 'done' | 'info' | 'warn' | 'muted']> = {
  registration: ['Inscriptions', 'info'],
  active: ['En cours', 'done'],
  cup: ['Coupe', 'warn'],
  closed: ['Terminée', 'muted'],
};

const compSquare = (c: D.Competition, size = 22) =>
  html`<span class="csq" style="display:inline-grid;place-items:center;width:${size + 14}px;height:${size}px;background:${c.theme.primary};color:${c.theme.onPrimary};font-weight:700;font-size:10px;border-radius:2px;letter-spacing:.02em">${c.short}</span>`;

const seasonRoute = (c: D.Competition, s: D.Season) => (c.slug === 'frfl' ? '/c/frfl/s1/standings' : `/c/${c.slug}/${s.slug}`);

/** A match line for a week table: time, division, A, score/status, B, info. */
export function calRow(m: D.Match, opts: { day?: boolean; division?: boolean; info?: boolean } = {}): Raw {
  const sc = scoreOf(m);
  const st = statusOf(m);
  const time = m.scheduledAt ? D.time(m.scheduledAt) : m.proposal ? D.time(m.proposal.at) : '—';
  const today = m.scheduledAt && D.sameDay(m.scheduledAt, D.NOW);
  let info: Raw | string = '';
  if (m.status === 'proposed' && m.proposal) info = html`Proposé par ${m.proposal.by === 'a' ? m.a.tag : m.b.tag} : ${D.day(m.proposal.at)} ${D.time(m.proposal.at)}`;
  else if (m.status === 'forfeit' && m.forfeit) info = m.forfeit.reason === 'exclusion' ? html`${m.forfeit.by === 'a' ? m.a.tag : m.b.tag} exclue · règle des 50 %${m.convertedFrom ? html` (joué ${m.convertedFrom[0]}–${m.convertedFrom[1]})` : ''}` : html`${m.forfeit.by === 'a' ? m.a.tag : m.b.tag} absente`;
  else if (m.status === 'void') info = 'Annulé par le staff';
  else if (m.status === 'no_result') info = 'Deux équipes exclues : compte pour aucune';
  else if (m.status === 'reported' && m.reported) info = html`${m.reported.score[0]}–${m.reported.score[1]} déclaré par ${m.reported.by === 'a' ? m.a.tag : m.b.tag}, attend la confirmation`;
  else if (m.status === 'disputed') info = 'Résultat contesté, en attente du staff';
  else if (m.autoScheduled) info = 'Fixé par le bot (prolongation), modifiable par accord';
  else if (m.status === 'validated' && m.map) info = html`${m.map}${m.game?.overtime ? ' · prol.' : ''}${m.game && m.game.lobbies > 1 ? ' · re-host' : ''}`;
  else if (m.host && m.status !== 'to_schedule') info = html`Hôte ${m.host === 'a' ? m.a.tag : m.b.tag} · côtés ${m.sideChooser === 'a' ? m.a.tag : m.b.tag}`;
  else if (m.status === 'to_schedule') info = html`Hôte ${m.host === 'a' ? m.a.tag : m.host === 'b' ? m.b.tag : 'à convenir'} · côtés ${m.sideChooser === 'a' ? m.a.tag : m.b.tag}`;
  return html`<tr class="${today ? 'today-mark' : ''}">
    <td class="t">${opts.day && m.scheduledAt ? html`${D.day(m.scheduledAt)} ` : ''}<b>${time}</b>${opts.division ? html` <span class="faint">${m.division === 'ligue-1' ? 'L1' : 'L2'}</span>` : ''}${m.extension ? html` <abbr class="pill pill-warn" title="Match de la semaine ${m.week} joué en prolongation">S${m.week}</abbr>` : ''}</td>
    <td class="ma ${sc?.winner === 'a' ? 'w' : ''}">${team(m.a, { size: 16 })}</td>
    <td class="mid">${sc ? html`<a class="sc" href="${matchHref(m)}"><span class="${sc.winner === 'a' ? 'w' : ''}">${sc.a}</span>–<span class="${sc.winner === 'b' ? 'w' : ''}">${sc.b}</span>${sc.forfeit ? html`<small>W.O.</small>` : ''}</a>` : html`<a class="sc st-${st.tone}" href="${matchHref(m)}">${m.status === 'reported' && m.reported ? `${m.reported.score[0]}–${m.reported.score[1]}?` : 'vs'}</a>`}</td>
    <td class="mb ${sc?.winner === 'b' ? 'w' : ''}">${team(m.b, { size: 16 })}</td>
    ${opts.info === false ? '' : html`<td class="info">${info}</td>`}
    <td class="stc">${status(m)}</td>
  </tr>`;
}

function weekByDay(ms: D.Match[]): Raw {
  const sorted = [...ms].sort((a, b) => (a.scheduledAt ?? a.proposal?.at ?? 9e15) - (b.scheduledAt ?? b.proposal?.at ?? 9e15));
  const rows: Raw[] = [];
  let lastDay = '';
  for (const m of sorted) {
    const at = m.scheduledAt ?? m.proposal?.at ?? null;
    const label = at ? D.day(at) : 'Sans horaire';
    if (label !== lastDay) {
      const today = at !== null && D.sameDay(at, D.NOW);
      rows.push(html`<tr class="daysep ${today ? 'today' : ''}"><td colspan="6">${label}${today ? ' · aujourd’hui' : ''}</td></tr>`);
      lastDay = label;
    }
    rows.push(calRow(m, { division: true }));
  }
  return html`<table class="cal tagm"><caption class="vh">Matchs de la semaine</caption><thead><tr><th scope="col">Heure</th><th scope="col" class="ma">Équipe A</th><th scope="col" class="mid">Score</th><th scope="col">Équipe B</th><th scope="col" class="info">Détail</th><th scope="col" class="stc">Statut</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function resultsTable(ms: D.Match[]): Raw {
  return html`<table class="data tagm dense"><caption class="vh">Derniers résultats</caption>
  <thead><tr><th scope="col">Date</th><th scope="col">Div.</th><th scope="col" style="text-align:right">Équipe A</th><th scope="col" class="mid" style="text-align:center">Score</th><th scope="col">Équipe B</th><th scope="col" class="opt">Carte</th><th scope="col" class="opt">Stats</th></tr></thead>
  <tbody>${ms.map((m) => {
    const sc = scoreOf(m);
    return html`<tr><td class="faint">${m.scheduledAt ? D.dateShort(m.scheduledAt) : ''}</td><td>${m.division === 'ligue-1' ? 'L1' : 'L2'} · S${m.week}</td>
      <td style="text-align:right" class="${sc?.winner === 'a' ? 'w' : ''}">${team(m.a, { size: 14 })}</td>
      <td style="text-align:center"><a class="sc" href="${matchHref(m)}"><span class="${sc?.winner === 'a' ? 'w' : ''}">${sc?.a}</span>–<span class="${sc?.winner === 'b' ? 'w' : ''}">${sc?.b}</span>${sc?.forfeit ? html`<small>W.O.</small>` : ''}</a></td>
      <td>${team(m.b, { size: 14 })}</td><td class="opt">${m.map ?? '—'}</td><td class="opt">${m.status === 'validated' ? sourceBadge(m.stats) : html`<span class="faint">forfait</span>`}</td></tr>`;
  })}</tbody></table>`;
}

export function home(): string {
  const comps = D.competitions;
  const week = D.matches.filter((m) => (m.week === 6 || (m.extension && m.scheduledAt && m.scheduledAt >= D.weekRange(6).start)) && m.status !== 'no_result' && !(m.status === 'forfeit' && m.forfeit?.reason === 'exclusion'));
  const main = html`
  <section class="panel">
    <div class="ph"><h2>Compétitions de MBL Group</h2><div class="ph-x"><a href="${href('/o/mbl-group')}">Organisation</a></div></div>
    <table class="data"><caption class="vh">Compétitions et saisons en cours</caption>
      <thead><tr><th scope="col">Ligue</th><th scope="col" class="opt">Jeu</th><th scope="col">Saison</th><th scope="col">Statut</th><th scope="col" class="opt">Où en est-on</th><th scope="col" class="num opt">Membres</th></tr></thead>
      <tbody>${comps.map((c) => {
        const s = c.seasons[0] as D.Season;
        const [label, tone] = STATUS[s.status];
        const where = s.currentWeek ? `${t('week')} ${s.currentWeek} sur ${s.divisions[0]?.weeks}` : s.note ?? '';
        return html`<tr><th scope="row"><a class="tm" href="${href(seasonRoute(c, s))}">${compSquare(c, 18)}<span>${c.name}</span></a></th>
          <td class="opt">${c.titleLabel}${c.mode === 'mixed' ? ' · mixte' : ''}</td><td>${s.name}</td><td>${pill(tone, label)}</td><td class="opt faint wrapcell">${where}</td><td class="num opt">${D.int(c.discordMembers)}</td></tr>`;
      })}</tbody></table>
  </section>
  ${panel(
    'LFR · semaine 6 · 23–29 nov.',
    weekByDay(week),
    { extra: html`<a href="${href('/c/lfr/s3/calendar')}">${t('calendar')}</a>` },
  )}
  <div class="grid2">
    ${panel('Classement Ligue 1', miniStandings('ligue-1'), { extra: html`<a href="${href('/c/lfr/s3/standings/ligue-1')}">Complet</a>` })}
    ${panel('Classement Ligue 2', miniStandings('ligue-2'), { extra: html`<a href="${href('/c/lfr/s3/standings/ligue-2')}">Complet</a>` })}
  </div>
  ${panel('Derniers résultats validés', resultsTable(latestResults(8)), { extra: html`<span class="faint">LFR</span>` })}
  ${panel(
    'Autres ligues',
    html`<table class="data dense"><caption class="vh">Autres ligues</caption><tbody>
      ${D.otherTonight.map((o) => html`<tr><td class="faint">${D.day(o.at)}<br>${D.time(o.at)}</td><td class="wrapcell">${o.label}</td><td class="wrapcell">${o.a && o.b ? html`${team(D.team(o.a), { size: 14 })} <span class="faint">vs</span> ${team(D.team(o.b), { size: 14 })}` : html`<span class="faint">${(o as { note?: string }).note}</span>`}</td></tr>`)}
      ${D.rlStandings().slice(0, 1).map((r) => html`<tr><td class="faint">LFRL</td><td class="wrapcell">Division 1 · en tête</td><td class="wrapcell">${team(r.team, { size: 14 })} <span class="faint">${r.points} pts, ${D.signed(r.diff)} buts</span></td></tr>`)}
    </tbody></table>`,
  )}`;
  return page({
    title: 'Accueil',
    crumbs: [['Accueil', null]],
    main,
    right: rightSidebar({ standings: false }),
    description: 'Matchs, résultats et classements des ligues de MBL Group.',
  });
}

export function org(): string {
  const byTitle = [
    { label: 'Rainbow Six Siege', comps: ['lfr', 'frfl'] },
    { label: 'Valorant', comps: ['lfv'] },
    { label: 'Rocket League', comps: ['lfrl'] },
  ];
  const main = html`
  <div class="head"><h1>MBL Group</h1><div class="sub">${D.org.about} Fondé en ${D.org.founded}. Langue de travail : français.</div></div>
  ${byTitle.map((g) =>
    panel(
      g.label,
      html`<table class="data"><caption class="vh">${g.label}</caption><thead><tr><th scope="col">Compétition</th><th scope="col">Saison</th><th scope="col">Statut</th><th scope="col" class="opt">Dates</th><th scope="col">Discord</th></tr></thead><tbody>
      ${g.comps.flatMap((slug) => {
        const c = D.competition(slug);
        return c.seasons.map(
          (s, i) => html`<tr>
            <th scope="row">${i === 0 ? html`<a class="tm" href="${href(seasonRoute(c, s))}">${compSquare(c, 18)}<span>${c.name}</span></a>` : html`<span class="faint" style="padding-left:38px">${c.short}</span>`}</th>
            <td><a href="${href(seasonRoute(c, s))}">${s.name}</a></td>
            <td>${pill(STATUS[s.status][1], STATUS[s.status][0])}${s.note ? html` <span class="faint">${s.note}</span>` : ''}</td>
            <td class="opt faint">${D.dateYear(s.startsOn)} – ${D.dateYear(s.endsOn)}</td>
            <td>${i === 0 ? html`<a href="${c.discordInvite}">${c.discordInvite.replace('https://', '')}</a> <span class="faint">${D.int(c.discordMembers)}</span>` : ''}</td></tr>`,
        );
      })}</tbody></table>`,
    ),
  )}
  ${panel(
    'Bannissements partagés (triche)',
    html`<p class="pad faint">Un joueur banni pour triche l’est dans toutes les ligues du groupe : LFR, LFV, LFRL (et FRFL). Seul le motif public est affiché.</p>
    <table class="data dense"><caption class="vh">Bannissements</caption><thead><tr><th scope="col">Compte</th><th scope="col">Depuis</th><th scope="col">Motif</th><th scope="col" class="opt">Ligues</th></tr></thead>
    <tbody>${D.orgBans.map((b) => html`<tr><td><code>${b.account}</code></td><td>${D.dateYear(b.since)}</td><td class="wrapcell">${b.reason}</td><td class="opt">${b.leagues.join(', ')}</td></tr>`)}</tbody></table>`,
  )}`;
  const right = html`${panel(
    'MBL Group',
    kv([
      ['Ligues', '4'],
      ['Jeux', 'R6, Valorant, Rocket League'],
      ['Saisons en cours', '3'],
      ['Membres Discord', D.int(D.competitions.reduce((s, c) => s + c.discordMembers, 0))],
      ['Contact', D.org.contact],
    ]),
    { cls: 'infobox' },
  )}${rightSidebar({ standings: false })}`;
  return page({ title: 'MBL Group', crumbs: [['Accueil', '/'], ['Organisation', null]], main, cols: 'right', right });
}

/** LFR Season 3 hub. */
export function lfrHub(): string {
  const c = D.competition('lfr');
  const main = html`
  <div class="head"><h1>LFR · Saison 3</h1><div class="sub">Ligue 1 (10 équipes) et Ligue 2 (12 équipes) · aller simple, un BO1 par semaine · du 19 oct. au 20 déc. 2026 · semaine 6 en cours (23–29 nov.)</div></div>
  <div class="grid2">
    ${['ligue-1', 'ligue-2'].map((d) => panel(`Classement ${divisionName(d)}`, miniStandings(d), { extra: html`<a href="${href(`/c/lfr/s3/standings/${d}`)}">Complet</a>` }))}
  </div>
  ${panel(
    'Semaine 6 · Ligue 1 et Ligue 2',
    weekByDay(D.matches.filter((m) => (m.week === 6 || (m.extension && m.week === 5 && (m.scheduledAt ?? 0) > D.weekRange(6).start)) && m.status !== 'no_result')),
    { extra: html`<a href="${href('/c/lfr/s3/calendar')}">Toutes les semaines</a>` },
  )}
  ${panel('Derniers résultats', resultsTable(latestResults(6)))}`;
  const right = html`${panel(
    'Saison 3',
    kv([
      ['Statut', pill('done', 'En cours')],
      ['Semaine', '6 sur 9 (L1) · 6 sur 11 (L2)'],
      ['Format', 'BO1, 3 pts par victoire'],
      ['Forfait', '7–0'],
      ['Coupe de France', 'après la saison'],
      ['Règlement', html`<a href="${href('/c/lfr/rules')}">v3.2, en vigueur</a>`],
      ['Discord', html`<a href="${c.discordInvite}">${icon('discord', 13)} rejoindre</a>`],
    ]),
    { cls: 'infobox' },
  )}${rightSidebar({ standings: false })}`;
  return page({ title: 'LFR Saison 3', crumbs: [['Accueil', '/'], ['LFR', '/c/lfr/s3'], ['Saison 3', null]], main, league: { comp: 'lfr', season: 's3', tab: 'hub' }, cols: 'right', right });
}

/** LFRL Season 1 hub: the same template, only the theme variables change. */
export function lfrlHub(): string {
  const c = D.competition('lfrl');
  const rows = D.rlStandings();
  const weekSeries = D.rlSeries.filter((s) => s.week === 4 || s.week === 3);
  const main = html`
  <div class="head"><h1>LFRL · Saison 1</h1><div class="sub">Division 1 (8 équipes) · aller simple, une série BO5 par semaine · le classement compte les buts · semaine 4 en cours</div></div>
  ${panel(
    'Classement Division 1',
    html`<div class="tw"><table class="st tagm"><caption class="vh">Classement LFRL</caption>
      <thead><tr><th scope="col" class="zc"><span class="vh">Zone</span></th><th scope="col" class="num rk">#</th><th scope="col" class="tl">${t('colTeam')}</th><th scope="col" class="num"><abbr title="Séries jouées">MJ</abbr></th><th scope="col" class="num">W</th><th scope="col" class="num">L</th><th scope="col" class="num opt"><abbr title="Manches (matchs) gagnées">GW</abbr></th><th scope="col" class="num opt"><abbr title="Buts pour">GF</abbr></th><th scope="col" class="num opt"><abbr title="Buts contre">GA</abbr></th><th scope="col" class="num"><abbr title="Différence de buts">Diff</abbr></th><th scope="col" class="num pts">PTS</th><th scope="col" class="opt2 fc">${t('colForm')}</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr><td class="zc">${r.zone ? html`<span class="zb z-champion" title="Champion"><span class="vh">Champion</span>C</span>` : ''}</td><td class="num rk">${r.rank}</td><th scope="row" class="tl">${team(r.team)}</th><td class="num">${r.played}</td><td class="num">${r.wins}</td><td class="num">${r.losses}</td><td class="num opt">${r.gw}</td><td class="num opt">${r.gf}</td><td class="num opt">${r.ga}</td><td class="num">${signedCell(r.diff)}</td><td class="num pts">${r.points}</td>
        <td class="opt2 fc"><span class="form">${r.form.map((f) => html`<span class="fb fb-${f}">${f}</span>`)}</span></td></tr>`)}</tbody></table></div>
      <ul class="legend"><li><span class="zm z-champion">C</span>Champion</li><li>GW : matchs gagnés dans les séries · GF/GA : buts pour et contre · Diff : différence de buts</li></ul>`,
  )}
  ${panel(
    'Semaines 3 et 4',
    html`<table class="cal tagm"><caption class="vh">Séries</caption><thead><tr><th scope="col">Heure</th><th scope="col" class="ma">Équipe A</th><th scope="col" class="mid">Série</th><th scope="col">Équipe B</th><th scope="col" class="info">Matchs</th><th scope="col" class="stc">Statut</th></tr></thead><tbody>
    ${weekSeries.map((s) => {
      const wa = s.games.filter((g) => g[0] > g[1]).length;
      const wb = s.games.length - wa;
      const done = s.status === 'validated';
      return html`<tr class="${D.sameDay(s.at, D.NOW) ? 'today-mark' : ''}"><td class="t">${D.day(s.at)} <b>${D.time(s.at)}</b></td><td class="ma ${done && wa > wb ? 'w' : ''}">${team(s.a, { size: 16 })}</td>
        <td class="mid">${done ? html`<span class="sc"><span class="${wa > wb ? 'w' : ''}">${wa}</span>–<span class="${wb > wa ? 'w' : ''}">${wb}</span></span>` : html`<span class="sc st-info">vs</span>`}</td>
        <td class="mb ${done && wb > wa ? 'w' : ''}">${team(s.b, { size: 16 })}</td><td class="info">${done ? s.games.map((g) => `${g[0]}–${g[1]}`).join(' · ') : 'BO5'}</td><td class="stc">${done ? pill('done', 'Validé', 'check') : pill('info', 'Programmé')}</td></tr>`;
    })}</tbody></table>`,
  )}`;
  const right = html`${panel(
    'Saison 1',
    kv([
      ['Statut', pill('done', 'En cours')],
      ['Semaine', '4 sur 7'],
      ['Format', 'BO5, 3 pts par série gagnée'],
      ['Stats', 'replays PC (boxcars), saisie manuelle pour les consoles'],
      ['Discord', html`<a href="${c.discordInvite}">${icon('discord', 13)} rejoindre</a>`],
    ]),
    { cls: 'infobox' },
  )}${panel('Derniers résultats', html`<ul class="mlist">${D.rlSeries.filter((s) => s.status === 'validated').slice(-6).reverse().map((s) => {
    const wa = s.games.filter((g) => g[0] > g[1]).length;
    const wb = s.games.length - wa;
    return html`<li class="mr"><span class="mr-t">${D.dateShort(s.at)}</span><span class="mr-a ${wa > wb ? 'w' : ''}">${team(s.a, { size: 14, tagOnly: true })}</span><span class="sc"><span class="${wa > wb ? 'w' : ''}">${wa}</span>–<span class="${wb > wa ? 'w' : ''}">${wb}</span></span><span class="mr-b ${wb > wa ? 'w' : ''}">${team(s.b, { size: 14, tagOnly: true })}</span></li>`;
  })}</ul>`)}`;
  return page({ title: 'LFRL Saison 1', crumbs: [['Accueil', '/'], ['LFRL', '/c/lfrl/s1'], ['Saison 1', null]], main, league: { comp: 'lfrl', season: 's1', tab: 'hub' }, cols: 'right', right });
}

/** LFV Season 2, still in registration: the empty states. */
export function lfvHub(): string {
  const c = D.competition('lfv');
  const filed = D.teams.filter((x) => x.competition === 'lfv');
  const main = html`
  <div class="head"><h1>LFV · Saison 2</h1><div class="sub">Inscriptions ouvertes jusqu’au 20 déc. 2026 · début prévu le 11 janv. 2027 · Division 1, 12 places</div></div>
  ${panel(t('standings'), empty('Pas encore de classement', 'Le classement apparaîtra après la première semaine de matchs, le 18 janvier.'))}
  ${panel(t('calendar'), empty('Calendrier pas encore publié', 'Le staff publie le calendrier une fois les inscriptions closes. Chaque équipe reçoit alors son salon de match sur le Discord de la LFV.'))}
  ${panel(
    'Équipes inscrites (4 sur 12)',
    html`<table class="data"><caption class="vh">Inscriptions</caption><thead><tr><th scope="col">Équipe</th><th scope="col">Club</th><th scope="col">État</th></tr></thead><tbody>
    ${filed.map((x, i) => html`<tr><th scope="row">${team(x)}</th><td>${D.clubBySlug.get(x.club)?.name ?? ''}</td><td>${i < 2 ? pill('done', 'Validée') : i === 2 ? pill('pending', 'En attente du staff') : pill('warn', 'Incomplète : 4 joueurs sur 5')}</td></tr>`)}
    </tbody></table>
    <div class="actions"><a class="btn btn-p" href="#register">Inscrire une équipe</a><span class="faint" style="align-self:center">Il faut un club et une équipe créés sur Ligo, et un compte Riot sur /me pour chaque joueur.</span></div>`,
  )}`;
  const right = html`${panel(
    'Saison 2',
    kv([
      ['Statut', pill('info', 'Inscriptions')],
      ['Saison précédente', html`<a href="#lfv-s1">Saison 1 · Coupe en cours</a>`],
      ['Stats', 'saisie manuelle (pas de replays pour les parties personnalisées)'],
      ['Discord', html`<a href="${c.discordInvite}">${icon('discord', 13)} rejoindre</a>`],
    ]),
    { cls: 'infobox' },
  )}${rightSidebar({ standings: false })}`;
  return page({ title: 'LFV Saison 2', crumbs: [['Accueil', '/'], ['LFV', '/c/lfv/s2'], ['Saison 2', null]], main, league: { comp: 'lfv', season: 's2', tab: 'hub' }, cols: 'right', right });
}

export { weekByDay, resultsTable, compSquare, themeVars, raw, form, matchRow, status, standingsTable };
