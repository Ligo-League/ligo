// Standings (per division, also in German and Dutch), FRFL player standings, the calendar.

import * as D from '../../_data/index.ts';
import { html, href, icon, raw, flag, playerRoute, type Raw } from '../../_build/lib.ts';
import { t, currentLang } from '../../_build/i18n.ts';
import { weekMatches } from '../../_build/shared.ts';
import { page } from './layout.ts';
import { badge, divName, matchRow, pill, sectionHead, standingsTable, signedCell } from './parts.ts';

export function standingsPage(division: string): Raw {
  const fr = currentLang() === 'fr';
  const other = division === 'ligue-1' ? 'ligue-2' : 'ligue-1';
  const results = weekMatches(division, 6).filter((m) => m.status === 'validated' || (m.status === 'forfeit' && m.forfeit?.reason === 'no_show'));
  const body = html`<div class="wrap">
    <header class="page-title" style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:var(--s4)">
      <div><p class="kicker">${t('season')} 3 · ${divName(division)} · ${t('week')} 6</p><h1 style="font-size:var(--fs-d1)">${t('standings')}</h1>
      <p>${t('updated')} ${D.when(D.NOW)}</p></div>
      <nav class="filters" style="border:0;padding:0" aria-label="${t('division')}"><span class="group">
        <a href="${href('/c/lfr/s3/standings/ligue-1')}" ${division === 'ligue-1' ? raw('aria-current="page"') : ''}>Ligue 1</a>
        <a href="${href('/c/lfr/s3/standings/ligue-2')}" ${division === 'ligue-2' ? raw('aria-current="page"') : ''}>Ligue 2</a>
      </span></nav>
    </header>
    <div class="grid-main section">
      <div>${standingsTable(division)}</div>
      <aside class="stack">
        <div>${sectionHead(`${t('results')} · ${t('week')} 6`)}
          <div class="matchlist">${results.map((m) => html`<a class="mini" href="${href(`/matches/${m.id}`)}"><span class="t" style="font-size:18px">${m.scheduledAt ? D.time(m.scheduledAt) : '–'}<small>${m.scheduledAt ? D.day(m.scheduledAt) : ''}</small></span><span class="who">${badge(m.a, 18)} ${m.a.tag} – ${m.b.tag} ${badge(m.b, 18)}</span><span class="disp" style="font-size:22px">${m.score ? `${m.score[0]}–${m.score[1]}` : m.forfeit?.by === 'a' ? '0–7' : '7–0'}</span></a>`)}</div></div>
        ${
          fr
            ? html`<div class="panel"><p class="kicker">Fin de saison</p><ul style="margin-top:var(--s2);font-size:var(--fs-s)">
            ${division === 'ligue-1'
              ? html`<li style="padding:4px 0">1er : champion de Ligue 1.</li><li style="padding:4px 0">8e : barrage contre le 3e de Ligue 2, en BO1 avant la Coupe.</li><li style="padding:4px 0">9e et 10e : descente en Ligue 2.</li>`
              : html`<li style="padding:4px 0">1er et 2e : montée en Ligue 1.</li><li style="padding:4px 0">3e : barrage contre le 8e de Ligue 1.</li><li style="padding:4px 0">Pas de descente : aucune division sous la Ligue 2.</li>`}
          </ul></div>
          <div class="panel"><p class="kicker">Départage</p><p style="margin-top:6px;font-size:var(--fs-s)">Points, puis Diff. À égalité parfaite, les équipes partagent le rang (=) ; celle qui a la sélection du côté au match suivant est tirée au sort.</p></div>`
            : ''
        }
        <p><a href="${href(`/c/lfr/s3/standings/${other}`)}">${t('standings')} ${divName(other)} ${icon('chevronRight', 12)}</a></p>
      </aside>
    </div>
  </div>`;
  return page({ title: `${t('standings')} ${divName(division)}`, comp: 'lfr', band: true, tab: 'standings', crumbs: [[t('home'), '/'], ['LFR', '/c/lfr/s3'], [`${t('season')} 3`, '/c/lfr/s3'], [t('standings'), null]], body });
}

export function frflStandings(): Raw {
  const rows = D.frflStandings;
  const body = html`<div class="wrap">
    <header class="page-title"><p class="kicker">FACEIT · équipes mixtes · Saison 1</p><h1>Classement joueurs</h1><p>Chaque joueur d’une équipe gagnante prend les points de la victoire. Départage : % de victoires, puis écart de manches par match, puis matchs joués. 6 matchs minimum pour être classé.</p></header>
    <div class="section"><table class="tbl standings">
      <caption class="sr">Classement joueurs FRFL</caption>
      <thead><tr><th scope="col">#</th><th scope="col">Joueur</th><th scope="col" class="r"><abbr title="Matchs joués">MJ</abbr></th><th scope="col" class="r">W</th><th scope="col" class="r">% vict.</th><th scope="col" class="r hide-m"><abbr title="Écart de manches par match">Diff/m</abbr></th><th scope="col" class="r"><abbr title="Note OpenSkill (mu)">Rating</abbr></th><th scope="col" class="hide-m">Statut</th></tr></thead>
      <tbody>${rows.map((r) => {
        const p = D.player(r.player);
        return html`<tr class="${r.qualified ? '' : 'excluded'}"><th scope="row" class="rank">${r.qualified ? r.rank : '–'}</th><td>${flag(p.nat)} <a href="${href(playerRoute(p.slug))}" style="font-weight:600">${p.tag}</a></td><td class="r">${r.games}</td><td class="r">${r.wins}</td><td class="r strong">${D.pct(r.wins / r.games)}</td><td class="r hide-m">${signedCell(Math.round(r.diffPerGame * 10) / 10)}</td><td class="r">${D.dec1(r.rating)}</td><td class="hide-m">${r.qualified ? '' : pill('Moins de 6 matchs', 'muted')}</td></tr>`;
      })}</tbody></table>
      <p class="abbr"><b>MJ</b> matchs joués · <b>W</b> victoires · <b>Diff/m</b> écart de manches moyen · <b>Rating</b> note OpenSkill, mise à jour après chaque match validé</p></div>
  </div>`;
  return page({ title: 'Classement joueurs FRFL', comp: 'frfl', band: true, tab: 'standings', crumbs: [[t('home'), '/'], ['FRFL', null], ['Saison 1', null], [t('standings'), null]], body });
}

// ---------------------------------------------------------------------------------------------

function weekBlock(week: number, opts: { team?: string } = {}): Raw {
  const r = D.weekRange(week);
  const divs = ['ligue-1', 'ligue-2'].filter((d) => week <= (d === 'ligue-1' ? 9 : 11));
  const list = (d: string) => weekMatches(d, week).filter((m) => !opts.team || m.a.slug === opts.team || m.b.slug === opts.team);
  const extensionPlayedHere = D.matches.filter((m) => m.extension && m.week === week - 1 && m.status !== 'validated' && (!opts.team || m.a.slug === opts.team || m.b.slug === opts.team));
  const total = divs.reduce((n, d) => n + list(d).length, 0);
  if (opts.team && total === 0 && !extensionPlayedHere.length) return html``;
  const current = week === 6;
  const past = week < 5;
  const done = divs.flatMap(list).filter((m) => m.status === 'validated' || m.status === 'forfeit' || m.status === 'void' || m.status === 'no_result').length;
  const inner = html`${divs.map((d) => {
    const ms = list(d);
    if (!ms.length) return '';
    let todayShown = false;
    return html`${opts.team ? '' : html`<p class="kicker" style="margin:var(--s3) 0 4px">${divName(d)}</p>`}<div class="matchlist">${ms.map((m) => {
      let mark: Raw | string = '';
      if (current && !todayShown && m.scheduledAt && m.scheduledAt >= D.NOW - 3 * 3600_000 && D.sameDay(m.scheduledAt, D.NOW)) {
        todayShown = true;
        mark = html`<p class="today-mark">Aujourd’hui · ${D.day(D.NOW)} · ${D.time(D.NOW)}</p>`;
      }
      return html`${mark}${matchRow(m, { today: !!m.scheduledAt && D.sameDay(m.scheduledAt, D.NOW) })}`;
    })}</div>`;
  })}
  ${extensionPlayedHere.length ? html`<p class="kicker" style="margin:var(--s3) 0 4px">Prolongations de la semaine ${week - 1}, jouées cette semaine</p><div class="matchlist">${extensionPlayedHere.map((m) => matchRow(m, { showDiv: true }))}</div>` : ''}`;
  const head = html`<span style="display:flex;align-items:baseline;gap:var(--s3);flex-wrap:wrap"><h2>${t('week')} ${week}</h2><span class="dates">${D.dateShort(r.start)} – ${D.dateShort(r.end)}</span>${current ? pill('Semaine en cours', 'live') : ''}<span class="dates">${opts.team ? '' : `${done}/${total} terminés`}</span></span>`;
  if (past && !opts.team) {
    return html`<details class="week" id="s${week}"><summary class="week-head" style="cursor:pointer;list-style:none">${head}<span class="dates" style="margin-left:auto">Afficher ${icon('chevronDown', 14)}</span></summary>${inner}</details>`;
  }
  return html`<section class="week" id="s${week}"><div class="week-head">${head}</div>${inner}</section>`;
}

export function calendar(team?: string): Raw {
  const tm = team ? D.team(team) : null;
  const body = html`<div class="wrap">
    <header class="page-title"><p class="kicker">Saison 3 · semaines 1 à 9 (Ligue 1) et 1 à 11 (Ligue 2)</p><h1>${t('calendar')}${tm ? html` · <span style="color:var(--text-2)">${tm.name}</span>` : ''}</h1>
      <p>Heures en Europe/Paris. Chaque équipe joue un match par semaine ; sans horaire convenu, une semaine de prolongation puis le dimanche 21:00.</p></header>
    <div class="filters" role="group" aria-label="Filtres">
      <label>${t('division')}</label><span class="group"><a href="${href('/c/lfr/s3/calendar')}" ${!tm ? raw('aria-current="true"') : ''}>Toutes</a><a href="#l1">Ligue 1</a><a href="#l2">Ligue 2</a></span>
      <label>Équipe</label><a class="select" href="${href(tm ? '/c/lfr/s3/calendar' : '/c/lfr/s3/calendar?team=greed-esport')}">${tm ? html`${badge(tm, 16)} ${tm.name}` : 'Toutes les équipes'} ${icon('chevronDown', 14)}</a>
      ${tm ? html`<a href="${href('/c/lfr/s3/calendar')}" class="btn btn-small">${icon('x', 12)} Retirer le filtre</a>` : ''}
    </div>
    <nav class="weeknav" aria-label="Semaines" style="margin-top:var(--s3)">${Array.from({ length: 11 }, (_, i) => i + 1).map((w) => html`<a href="#s${w}" class="${w < 6 ? 'past' : ''}" ${w === 6 ? raw('aria-current="true"') : ''}>S${w}</a>`)}</nav>
    ${tm ? html`<div class="callout" style="margin-top:var(--s4)"><strong>${tm.name} · ${divName(tm.division)}</strong>Hôte quand elle est mieux classée que l’adversaire ; choix du côté et premier ban quand elle l’est moins.</div>` : ''}
    ${Array.from({ length: 11 }, (_, i) => weekBlock(i + 1, team ? { team } : {}))}
    <p class="abbr" style="margin-top:var(--s5)"><b>Statuts</b> : À planifier · Horaire proposé · Programmé · Horaire automatique · Prolongation · Résultat déclaré · Contesté · Validé · Forfait (W.O.) · Annulé · Sans résultat (deux équipes exclues).</p>
  </div>`;
  return page({ title: tm ? `${t('calendar')} ${tm.name}` : t('calendar'), comp: 'lfr', band: true, tab: 'calendar', crumbs: [[t('home'), '/'], ['LFR', '/c/lfr/s3'], ['Saison 3', '/c/lfr/s3'], [t('calendar'), null]], body });
}

export { icon };
