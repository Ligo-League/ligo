// Standings per division (also in German and Dutch for the label-length check), FRFL player
// standings, and the calendar by week.

import * as D from '../../_data/index.ts';
import { href, html, icon, raw, rel, type Raw } from '../../_build/lib.ts';
import { currentLang, t } from '../../_build/i18n.ts';
import { weekMatches } from '../../_build/shared.ts';
import { compTabs, doc, lfrHead, tabs } from './layout.ts';
import { byDay, facts, matchList, pill, playerLink, sectionHead, standingsTable } from './ui.ts';

function divSwitch(current: string, base = '/c/lfr/s3/standings'): Raw {
  return html`<nav class="seg" aria-label="${t('division')}">${['ligue-1', 'ligue-2'].map(
    (d) => html`<a href="${href(`${base}/${d}`)}" ${d === current ? raw('aria-current="page"') : ''}>${d === 'ligue-1' ? 'Ligue 1' : 'Ligue 2'}</a>`,
  )}</nav>`;
}

export function standingsPage(division: string): string {
  const rows = D.standings(division);
  const divName = division === 'ligue-1' ? 'Ligue 1' : 'Ligue 2';
  const excluded = rows.filter((r) => r.excluded);
  const lang = currentLang();
  const body = html`${lfrHead()}
  ${compTabs('standings')}
  <div class="page split split-wide">
    <div class="col-main">
      <div class="bar">${divSwitch(division)}<p class="muted sm">${t('updated')} : ${D.when(D.NOW)}</p></div>
      <h2 class="h-sec">${t('standings')} ${divName} · ${t('season')} 3</h2>
      ${standingsTable(rows, { caption: `${t('standings')} ${divName}` })}
      <dl class="abbr-legend">
        <div><dt>${t('colPlayed')}</dt><dd>${t('colPlayedLong')}</dd></div>
        <div><dt>W / L</dt><dd>${t('legendW')} / ${t('legendL')}</dd></div>
        <div><dt>RW / RL</dt><dd>${t('legendRW')} / ${t('legendRL')}</dd></div>
        <div><dt>${t('colDiff')}</dt><dd>${t('legendDiff')}</dd></div>
      </dl>
      ${
        lang === 'fr'
          ? html`<div class="explain">
        <p><strong>Classement</strong> : 3 points par victoire, puis la différence de manches. Deux équipes à égalité de points et de différence partagent le rang (=). Un forfait compte 7–0.</p>
        ${excluded.length ? html`<p><strong>Équipes exclues</strong> : ${excluded.map((r) => `${r.team.name} (${D.EXCLUDED[r.team.slug]?.reason})`).join(', ')}. Elles ont joué moins de la moitié de leurs matchs : selon la règle des 50 %, chacun de leurs matchs compte comme une victoire par forfait pour l’adversaire${division === 'ligue-1' ? ', et leur match entre elles ne compte pour personne' : ''}.</p>` : ''}
        <p><a href="${href('/c/lfr/rules#art-6')}">Article 6 du règlement</a></p>
      </div>`
          : html`<p class="muted sm">Libellés traduits pour le contrôle de longueur ; les colonnes gardent les lettres anglaises dans toutes les langues (W, L, RW, RL, Diff, PTS).</p>`
      }
    </div>
    <aside class="col-side">
      <section>
        ${sectionHead(`${t('week')} 6`, [t('calendar'), '/c/lfr/s3/calendar'])}
        ${matchList(weekMatches(division, 6))}
      </section>
      <section>
        ${sectionHead('Fin de saison')}
        ${facts(
          division === 'ligue-1'
            ? [
                ['1er', 'Champion de Ligue 1, tête de série 1 de la Coupe'],
                ['8e', 'Barrage contre le 3e de Ligue 2, en BO1'],
                ['9e–10e', 'Descente en Ligue 2'],
              ]
            : [
                ['1er–2e', 'Montée en Ligue 1'],
                ['3e', 'Barrage contre le 8e de Ligue 1'],
                ['Autres', 'Pas de descente : aucune division sous la Ligue 2'],
              ],
        )}
      </section>
    </aside>
  </div>`;
  const base = `standings-${division}`;
  return doc({
    title: `${t('standings')} ${divName}`,
    comp: 'lfr',
    body,
    nav: 'standings',
    langPaths: division === 'ligue-1' ? { fr: `${base}.html`, de: `${base}-de.html`, nl: `${base}-nl.html` } : { fr: `${base}.html` },
  });
}

export function frflStandings(): string {
  const c = D.competition('frfl');
  const body = html`<section class="ent"><div class="ent-in">
      <nav class="crumbs" aria-label="Fil d’Ariane"><ol><li><a href="${href('/o/mbl-group')}">MBL Group</a></li><li><a href="${href('/c/frfl/s1')}">FRFL</a></li><li><span aria-current="page">Saison 1</span></li></ol></nav>
      <div class="ent-main"><div class="ent-visual"><span class="comp-mark" aria-hidden="true">FRFL</span></div><div class="ent-text"><h1>${c.name}</h1><p class="ent-sub">R6 sur FACEIT · équipes mixtes tirées à chaque lobby · ${t('week')} 4</p></div>
      <div class="ent-side"><a class="btn btn-on" href="${c.discordInvite}">${icon('discord', 18)} ${t('joinDiscord')}</a></div></div>
    </div></section>
    ${tabs([
      { label: t('overview'), route: '/c/frfl/s1' },
      { label: t('matches'), route: '/c/frfl/s1/calendar' },
      { label: t('standings'), route: '/c/frfl/s1/standings', current: true },
      { label: t('stats'), route: '/c/frfl/s1/leaders' },
      { label: t('rules'), route: '/c/frfl/rules' },
    ])}
    <div class="page">
      <h2 class="h-sec">Classement des joueurs</h2>
      <div class="tbl-wrap"><table class="st">
        <thead><tr><th scope="col" class="c-rank">#</th><th scope="col" class="c-team">Joueur</th><th scope="col" class="num"><abbr title="Matchs joués">MJ</abbr></th><th scope="col" class="num"><abbr title="Victoires">W</abbr></th><th scope="col" class="num">% W</th><th scope="col" class="num hide-s"><abbr title="Différence de manches par match">Diff/m</abbr></th><th scope="col" class="num c-pts"><abbr title="Rating OpenSkill (mu)">Rating</abbr></th></tr></thead>
        <tbody>${D.frflStandings.map(
          (r) => html`<tr class="${r.qualified ? '' : 'ex'}"><td class="c-rank">${r.qualified ? r.rank : '–'}</td><th scope="row" class="c-team">${playerLink(r.player)}${r.qualified ? '' : pill('muted', 'moins de 6 matchs', 'pill-xs')}</th><td class="num">${r.games}</td><td class="num">${r.wins}</td><td class="num">${D.pct(r.wins / r.games)}</td><td class="num hide-s">${D.signed(Math.round(r.diffPerGame * 10) / 10).replace('.', ',')}</td><td class="num c-pts">${D.dec1(r.rating)}</td></tr>`,
        )}</tbody>
      </table></div>
      <p class="muted sm">Chaque membre d’une équipe gagnante prend les points de la victoire. Égalités : % de victoires, puis différence de manches par match, puis matchs joués. 6 matchs minimum pour être classé.</p>
    </div>`;
  return doc({ title: 'Classement FRFL', comp: 'frfl', body, nav: 'standings' });
}

// ---------------------------------------------------------------------------------------------
// Calendar: weeks 1–11, the current week open, filters as links.

export function calendar(teamFilter?: string): string {
  const filterTeam = teamFilter ? D.team(teamFilter) : null;
  const weeks = Array.from({ length: 11 }, (_, i) => i + 1);
  const legend = html`<p class="cal-legend sm"><abbr class="mk" title="Hôte du lobby">H</abbr> hôte · <abbr class="mk" title="Choix du côté et premier ban">CC</abbr> choix du côté et premier ban · <span class="mk mk-ex">EX</span> équipe exclue · ${icon('coin', 13)} tirage au sort (rangs égaux)</p>`;
  const lfrTeams = D.teams.filter((x) => x.competition === 'lfr').sort((a, b) => a.name.localeCompare(b.name));
  const body = html`${lfrHead()}
  ${compTabs('matches')}
  <div class="page">
    <form class="filters" action="${rel('calendar-team.html')}" method="get">
      <nav class="seg" aria-label="${t('division')}"><a href="${href('/c/lfr/s3/calendar')}" ${!filterTeam ? raw('aria-current="page"') : ''}>Tout</a><a href="#div-ligue-1">Ligue 1</a><a href="#div-ligue-2">Ligue 2</a></nav>
      <label class="select"><span class="sr">${t('colTeam')}</span>${icon('filter', 14)}
        <select name="team">
          <option value="">Toutes les équipes</option>
          ${lfrTeams.map((x) => html`<option value="${x.slug}" ${filterTeam?.slug === x.slug ? raw('selected') : ''}>${x.name}</option>`)}
        </select>
      </label>
      <noscript><button type="submit" class="btn btn-ghost">Filtrer</button></noscript>
    </form>
    ${filterTeam ? html`<p class="filter-on">${icon('filter', 14)} Matchs de <strong>${filterTeam.name}</strong> · <a href="${href('/c/lfr/s3/calendar')}">retirer le filtre</a></p>` : ''}
    ${legend}
    ${weeks.map((w) => {
      const r = D.weekRange(w);
      const ms = D.matches
        .filter((m) => m.week === w && (!filterTeam || m.a.slug === filterTeam.slug || m.b.slug === filterTeam.slug))
        .filter((m) => !(filterTeam === null && false));
      const l1 = ms.filter((m) => m.division === 'ligue-1');
      const l2 = ms.filter((m) => m.division === 'ligue-2');
      const current = w === 6;
      const past = r.end < D.NOW;
      const done = ms.filter((m) => m.status === 'validated' || m.status === 'forfeit').length;
      if (ms.length === 0) return '';
      return html`<details class="wk ${current ? 'wk-now' : ''}" ${current || filterTeam ? raw('open') : ''} id="s${w}">
        <summary><span class="wk-n">${t('week')} ${w}</span><span class="wk-d">${D.dateShort(r.start)} – ${D.dateShort(r.end)}</span>${current ? pill('live', 'Cette semaine') : ''}${w > 9 ? pill('muted', 'Ligue 2 seulement') : ''}<span class="wk-c">${done}/${ms.length} ${past || current ? 'joués' : ''}</span>${icon('chevronDown', 16)}</summary>
        ${
          filterTeam
            ? matchList(ms, { showDate: true, highlight: filterTeam.slug })
            : html`${l1.length ? html`<h3 class="day-h" id="${w === 1 ? 'div-ligue-1' : ''}">Ligue 1</h3>${matchList(l1, { showDate: true })}` : ''}${l2.length ? html`<h3 class="day-h" id="${w === 1 ? 'div-ligue-2' : ''}">Ligue 2</h3>${matchList(l2, { showDate: true })}` : ''}`
        }
      </details>`;
    })}
  </div>`;
  return doc({ title: filterTeam ? `${t('calendar')} · ${filterTeam.name}` : t('calendar'), comp: 'lfr', body, nav: 'matches' });
}

export { byDay };
