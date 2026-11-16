// Standings per division (also in German and Dutch for the label check), FRFL player standings,
// and the calendar by week.

import * as D from '../../_data/index.ts';
import { html, href, icon, raw, type Raw } from '../../_build/lib.ts';
import { t } from '../../_build/i18n.ts';
import { weekMatches, scoreOf, divisionName } from '../../_build/shared.ts';
import { page, rightSidebar } from './layout.ts';
import { team, panel, standingsTable, pill, playerLink, signedCell, miniStandings } from './parts.ts';
import { calRow } from './home.ts';

export function standings(division: string): string {
  const name = divisionName(division);
  const other = division === 'ligue-1' ? 'ligue-2' : 'ligue-1';
  const results = weekMatches(division, 6);
  const main = html`
  <div class="head">
    <div style="display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center">
      <h1>${t('standings')} ${name}</h1>
      <nav class="seg" aria-label="${t('division')}">
        <a href="${href('/c/lfr/s3/standings/ligue-1')}"${division === 'ligue-1' ? raw(' aria-current="page"') : ''}>Ligue 1</a>
        <a href="${href('/c/lfr/s3/standings/ligue-2')}"${division === 'ligue-2' ? raw(' aria-current="page"') : ''}>Ligue 2</a>
      </nav>
    </div>
    <div class="sub">LFR ${t('season')} 3 · ${t('week')} 6 · ${t('updated')} ${D.when(D.NOW)} · 3 pts par victoire, forfait 7–0, départage : points puis Diff</div>
  </div>
  <section class="panel">
    <div class="ph"><h2>${name} · ${division === 'ligue-1' ? '10' : '12'} ${t('colTeam').toLowerCase()}s</h2><div class="ph-x"><a href="#image">${icon('file', 12)} Image 1200 px</a></div></div>
    ${standingsTable(division, { caption: `${t('standings')} ${name}` })}
  </section>
  <section class="panel">
    <div class="ph"><h2>${t('legendPts')} · abréviations</h2></div>
    <p class="pad faint" style="font-size:11.5px">
      <b>${t('colPlayed')}</b> ${t('colPlayedLong').toLowerCase()} · <b>W</b> ${t('legendW')} · <b>L</b> ${t('legendL')} · <b>RW</b> ${t('legendRW')} · <b>RL</b> ${t('legendRL')} · <b>Diff</b> ${t('legendDiff')} · <b>PTS</b> ${t('legendPts')} ·
      <b>${t('colForm')}</b> : 5 derniers matchs, un cadre pointillé = ${t('formForfeit')} · <b>${t('colMove')}</b> : places gagnées ou perdues depuis la semaine 5.
    </p>
  </section>
  ${panel(
    `${t('week')} 6 · ${name}`,
    html`<table class="cal tagm"><caption class="vh">${t('week')} 6</caption><tbody>${results.map((m) => calRow(m))}</tbody></table>`,
    { extra: html`<a href="${href('/c/lfr/s3/calendar')}">${t('calendar')}</a>` },
  )}`;
  return page({
    title: `${t('standings')} ${name}`,
    crumbs: [[t('home'), '/'], ['LFR', '/c/lfr/s3'], [`${t('season')} 3`, '/c/lfr/s3'], [`${t('standings')} ${name}`, null]],
    main,
    league: { comp: 'lfr', season: 's3', tab: 'standings' },
    description: `${t('standings')} ${name}, LFR ${t('season')} 3`,
    right: html`${panel(divisionName(other), miniStandings(other), { extra: html`<a href="${href(`/c/lfr/s3/standings/${other}`)}">Complet</a>` })}${rightSidebar({ standings: false })}`,
  }).replace('href="#other-division"', `href="${href(`/c/lfr/s3/standings/${other}`)}"`);
}

export function frfl(): string {
  const rows = D.frflStandings;
  const main = html`
  <div class="head"><h1>FRFL · classement joueurs</h1><div class="sub">Saison 1 · équipes mixtes tirées à chaque lobby (FACEIT) · ${t('week')} 4 · minimum 6 matchs pour être classé · départage : % de victoires, différence de manches par match, matchs joués</div></div>
  <section class="panel">${raw('')}
    <div class="ph"><h2>Joueurs</h2><div class="ph-x"><span class="faint">${rows.length} joueurs</span></div></div>
    <div class="tw"><table class="st"><caption class="vh">Classement joueurs FRFL</caption>
    <thead><tr><th scope="col" class="num rk">#</th><th scope="col" class="tl">Joueur</th><th scope="col" class="opt">Équipe LFR</th><th scope="col" class="num"><abbr title="Matchs joués">MJ</abbr></th><th scope="col" class="num">W</th><th scope="col" class="num"><abbr title="% de victoires">Win %</abbr></th><th scope="col" class="num opt"><abbr title="Différence de manches par match">Diff/m</abbr></th><th scope="col" class="num pts"><abbr title="Rating OpenSkill (mu)">Rating</abbr></th></tr></thead>
    <tbody>${rows.map((r) => {
      const tm = D.teamOf(r.player);
      return html`<tr class="${r.qualified ? '' : 'ex'}"><td class="num rk">${r.qualified ? r.rank : html`<abbr title="Moins de 6 matchs : non classé">NC</abbr>`}</td><th scope="row" class="tl">${playerLink(r.player)}</th><td class="opt">${tm ? team(tm, { size: 14, tagOnly: true }) : html`<span class="faint">—</span>`}</td><td class="num">${r.games}</td><td class="num">${r.wins}</td><td class="num">${D.pct(r.wins / r.games)}</td><td class="num opt">${signedCell(Math.round(r.diffPerGame * 10) / 10)}</td><td class="num pts">${D.dec1(r.rating)}</td></tr>`;
    })}</tbody></table></div>
    <ul class="legend"><li>NC : non classé (moins de 6 matchs)</li><li>Rating : OpenSkill, mis à jour après chaque match validé</li></ul>
  </section>`;
  return page({ title: 'FRFL classement joueurs', crumbs: [['Accueil', '/'], ['FRFL', '/c/frfl/s1/standings'], ['Saison 1', null]], main, league: { comp: 'frfl', season: 's1', tab: 'standings' }, cols: 'right' });
}

export function calendar(teamFilter?: string): string {
  const tm = teamFilter ? D.team(teamFilter) : null;
  const weeks = Array.from({ length: 11 }, (_, i) => i + 1);
  const filter = (m: D.Match) => !tm || m.a.slug === tm.slug || m.b.slug === tm.slug;
  const lfrTeams = D.teams.filter((x) => x.competition === 'lfr');
  const main = html`
  <div class="head"><h1>${t('calendar')}${tm ? html` · ${tm.name}` : ''}</h1><div class="sub">LFR ${t('season')} 3 · Ligue 1 : semaines 1–9 · Ligue 2 : semaines 1–11 · heures de Paris</div></div>
  <section class="panel">
    <form class="filters" action="#" method="get">
      <label class="f">${t('division')}<select name="division"><option>Toutes</option><option>Ligue 1</option><option>Ligue 2</option></select></label>
      <label class="f">${t('colTeam')}<select name="team"><option value="">Toutes les équipes</option>${lfrTeams.map((x) => html`<option${x.slug === tm?.slug ? raw(' selected') : ''}>${x.name}</option>`)}</select></label>
      <label class="f">Statut<select name="status"><option>Tous</option><option>${t('stToSchedule')}</option><option>${t('stProposed')}</option><option>${t('stReported')}</option><option>${t('stDisputed')}</option></select></label>
      <span class="seg" style="margin-left:auto"><span aria-current="true">Semaines</span><a href="#month">Mois</a></span>
      ${tm ? html`<a href="${href('/c/lfr/s3/calendar')}">Effacer le filtre</a>` : ''}
    </form>
    <p class="pad faint" style="font-size:11.5px;margin:0">${icon('calendar', 12)} Aujourd’hui : ${D.day(D.NOW)} (semaine 6). Un match sans horaire convenu à la fin de sa semaine passe en <b>prolongation</b> : le bot le fixe au dimanche 21:00 de la semaine suivante.</p>
  </section>
  ${weeks.map((w) => {
    const range = D.weekRange(w);
    const ms = ['ligue-1', 'ligue-2'].flatMap((d) => (w <= (d === 'ligue-1' ? 9 : 11) ? weekMatches(d, w).filter(filter) : []));
    if (!ms.length) return '';
    const open = w >= 5 && w <= 7;
    const groups = ['ligue-1', 'ligue-2'].map((d) => [d, ms.filter((m) => m.division === d)] as const).filter(([, l]) => l.length);
    return html`<section class="panel wk ${w === 6 ? 'now' : ''}" id="w${w}">
      <div class="wk-h"><h3>${t('week')} ${w}</h3><span class="faint">${D.dateShort(range.start)} – ${D.dateShort(range.end)}${w >= 10 ? ' · Ligue 2 seulement' : ''}</span>
        <span class="faint" style="margin-left:auto">${ms.filter((m) => scoreOf(m)).length}/${ms.length} joués</span></div>
      ${open || tm
        ? html`<table class="cal tagm"><caption class="vh">${t('week')} ${w}</caption>
          <thead class="vh"><tr><th scope="col">Heure</th><th scope="col">A</th><th scope="col">Score</th><th scope="col">B</th><th scope="col">Détail</th><th scope="col">Statut</th></tr></thead>
          <tbody>${groups.map(([d, l]) => html`${groups.length > 1 || tm ? html`<tr class="daysep"><td colspan="6">${divisionName(d)}</td></tr>` : ''}${l.map((m) => calRow(m, { day: true }))}`)}</tbody></table>`
        : html`<details><summary class="pad" style="cursor:pointer;padding:6px 10px;font-size:12px">${ms.length} matchs · ${w < 6 ? 'résultats' : 'à venir'} ${icon('chevronDown', 12)}</summary>
          <table class="cal tagm"><caption class="vh">${t('week')} ${w}</caption><tbody>${groups.map(([d, l]) => html`<tr class="daysep"><td colspan="6">${divisionName(d)}</td></tr>${l.map((m) => calRow(m, { day: true }))}`)}</tbody></table></details>`}
    </section>`;
  })}
  ${panel(
    'Statuts',
    html`<p class="pad" style="font-size:11.5px;display:flex;flex-wrap:wrap;gap:6px 12px;margin:0">
      ${pill('muted', t('stToSchedule'))} ${pill('info', t('stProposed'))} ${pill('info', t('stScheduled'))} ${pill('info', t('stAuto'))} ${pill('warn', 'S5', undefined)}<span class="faint">= match de la semaine 5 en prolongation</span>
      ${pill('live', t('stVeto'), 'timer')} ${pill('pending', t('stReported'))} ${pill('danger', t('stDisputed'), 'alert')} ${pill('done', t('stValidated'), 'check')} ${pill('warn', 'Forfait (W.O.)')} ${pill('muted', t('stVoid'))} ${pill('muted', t('stNoResult'))}</p>`,
  )}`;
  return page({
    title: tm ? `${t('calendar')} ${tm.name}` : t('calendar'),
    crumbs: [['Accueil', '/'], ['LFR', '/c/lfr/s3'], ['Saison 3', '/c/lfr/s3'], [t('calendar'), null]],
    main,
    league: { comp: 'lfr', season: 's3', tab: 'calendar' },
    cols: 'right',
  });
}
