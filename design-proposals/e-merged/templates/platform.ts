// Ligo's own pages: the home at / (visitor and logged in) and a game's home (/r6). Ligo is the
// platform; MBL Group is one organisation among others.

import * as D from '../../_data/index.ts';
import { html, href, icon, raw, teamBadge, type Raw } from '../../_build/lib.ts';
import { scoreOf, latestResults } from '../../_build/shared.ts';
import { leftQuick, rightQuick, qLeaders, qResults, qMercato, focusTeam } from './quick.ts';
import { page, hubLeft, pendingPanel, gameIcon, type Viewer } from './layout.ts';
import { team, panel, pill, status, matchHref, tabs, kv } from './parts.ts';
import { calRow } from './home.ts';
import { photo } from './art.ts';

const STATUS: Record<D.CompetitionCard['status'], [string, 'done' | 'info' | 'warn' | 'muted']> = {
  registration: ['Inscriptions', 'info'],
  active: ['En cours', 'done'],
  cup: ['Coupe', 'warn'],
  closed: ['Terminée', 'muted'],
};

const compMark = (c: D.CompetitionCard) =>
  html`<span class="cmark" style="background:${c.primary}">${c.short}</span>`;

const compLink = (c: D.CompetitionCard) => (c.slug === 'lfr' ? href('/mbl-group/lfr/s3') : `#${c.org}/${c.slug}`);

/** Running competitions of one game (or all): organisation, status, progress, size, today. */
function competitionsTable(cards: D.CompetitionCard[], withGame: boolean): Raw {
  return html`<table class="data comps-t"><caption class="vh">Compétitions en cours</caption>
    <thead><tr><th scope="col">Compétition</th>${withGame ? html`<th scope="col" class="opt">Jeu</th>` : ''}<th scope="col" class="opt">Organisation</th><th scope="col">Statut</th><th scope="col" class="opt2">Où en est-on</th><th scope="col" class="num opt">Équipes</th><th scope="col" class="num opt"><abbr title="Matchs aujourd’hui">Auj.</abbr></th></tr></thead>
    <tbody>${cards.map((c) => {
      const org = D.orgs.find((o) => o.slug === c.org) as D.Org;
      const g = D.games.find((x) => x.key === c.game) as D.GameInfo;
      const [label, tone] = STATUS[c.status];
      return html`<tr>
        <th scope="row"><a class="cl" href="${compLink(c)}">${compMark(c)}<span><span class="cn">${c.name}</span><span class="cs">${c.season} · ${c.divisions.join(', ')} · ${c.language}</span></span></a></th>
        ${withGame ? html`<td class="opt">${gameIcon(g, 16)} ${g.short}</td>` : ''}
        <td class="opt"><a href="${org.slug === 'mbl-group' ? href('/mbl-group') : `#${org.slug}`}">${org.name}</a>${org.verified ? html` <abbr class="vf" title="Organisation vérifiée">${icon('check', 10)}</abbr>` : ''}</td>
        <td>${pill(tone, label)}</td>
        <td class="opt2 faint wrapcell">${c.progress}</td>
        <td class="num opt">${c.teams || '—'}</td>
        <td class="num opt">${c.today || html`<span class="faint">0</span>`}</td>
      </tr>`;
    })}</tbody></table>`;
}

/** Today's matches across competitions: one table, a competition mark per row. */
function todayTable(game: 'r6' | 'all'): Raw {
  const lfr = D.matches.filter((m) => m.scheduledAt && D.sameDay(m.scheduledAt, D.NOW)).sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
  const others = D.otherMatchesToday.filter((o) => game === 'all' || o.competition === 'bsl');
  const card = (slug: string) => D.competitionCards.find((c) => c.slug === slug) as D.CompetitionCard;
  type Row = { at: number; html: Raw };
  const rows: Row[] = [
    ...lfr.map((m) => ({
      at: m.scheduledAt as number,
      html: html`<tr><td class="t"><b>${D.time(m.scheduledAt as number)}</b></td><td>${compMark(card('lfr'))}</td><td class="opt faint">${m.division === 'ligue-1' ? 'Ligue 1' : 'Ligue 2'} · S${m.week}</td>
        <td class="ma">${team(m.a, { size: 16 })}</td><td class="mid">${(() => {
          const sc = scoreOf(m);
          return sc ? html`<a class="sc" href="${matchHref(m)}">${sc.a}–${sc.b}</a>` : html`<a class="sc" href="${matchHref(m)}">${m.status === 'reported' && m.reported ? `${m.reported.score[0]}–${m.reported.score[1]}?` : 'vs'}</a>`;
        })()}</td><td class="mb">${team(m.b, { size: 16 })}</td><td class="stc">${status(m)}</td></tr>`,
    })),
    ...others.map((o) => ({
      at: o.at,
      html: html`<tr><td class="t"><b>${D.time(o.at)}</b></td><td>${compMark(card(o.competition))}</td><td class="opt faint">${o.context.split(' · ').slice(1).join(' · ')}</td>
        <td class="ma"><span class="tm">${teamBadge(o.a, { size: 16 })}<span class="n">${o.a.name}</span><span class="tg">${o.a.tag}</span></span></td>
        <td class="mid"><span class="sc">${o.score ? `${o.score[0]}–${o.score[1]}` : 'vs'}</span></td>
        <td class="mb"><span class="tm">${teamBadge(o.b, { size: 16 })}<span class="n">${o.b.name}</span><span class="tg">${o.b.tag}</span></span></td>
        <td class="stc">${o.status === 'validated' ? pill('done', 'Validé', 'check') : pill('info', 'Programmé')}</td></tr>`,
    })),
  ];
  if (game === 'all') {
    for (const o of D.otherTonight.filter((x) => D.sameDay(x.at, D.NOW))) {
      const c = card(o.competition);
      rows.push({
        at: o.at,
        html: html`<tr><td class="t"><b>${D.time(o.at)}</b></td><td>${compMark(c)}</td><td class="opt faint">${o.label.split(' · ').slice(1).join(' · ')}</td>
          ${o.a && o.b ? html`<td class="ma">${team(D.team(o.a), { size: 16 })}</td><td class="mid"><span class="sc">vs</span></td><td class="mb">${team(D.team(o.b), { size: 16 })}</td>` : html`<td colspan="3" class="faint">${(o as { note?: string }).note ?? ''}</td>`}
          <td class="stc">${pill('info', 'Programmé')}</td></tr>`,
      });
    }
  }
  rows.sort((a, b) => a.at - b.at);
  return html`<table class="cal tagm today-t"><caption class="vh">Matchs du jour</caption>
    <thead><tr><th scope="col">Heure</th><th scope="col"><span class="vh">Compétition</span></th><th scope="col" class="opt">Phase</th><th scope="col" class="ma">Équipe A</th><th scope="col" class="mid">Score</th><th scope="col">Équipe B</th><th scope="col" class="stc">Statut</th></tr></thead>
    <tbody>${rows.map((r) => r.html)}</tbody></table>`;
}

function recruitmentPanel(): Raw {
  return panel(
    'Recrutement · R6',
    html`<ul class="wl">${D.listings.players.slice(0, 4).map(
      (l) => html`<li><b>${l.player}</b> <span class="faint">${l.roles.join(', ')} · ${l.rank} · ${l.languages.join('/')}</span></li>`,
    )}${D.listings.teams.slice(0, 2).map((l) => html`<li>${team(D.team(l.team), { size: 14 })} <span class="faint">cherche : ${l.role}</span></li>`)}</ul>`,
    { extra: html`<a href="${href('/recruitment')}">Tout voir</a>` },
  );
}

function orgsPanel(): Raw {
  return panel(
    'Organisations',
    html`<ul class="orgs">${D.orgs.map(
      (o) => html`<li><a href="${o.slug === 'mbl-group' ? href('/mbl-group') : `#${o.slug}`}"><span class="omark" style="background:${o.color}">${o.mark}</span><span><b>${o.name}</b>${o.verified ? html` <abbr class="vf" title="Organisation vérifiée">${icon('check', 10)}</abbr>` : ''}<br><span class="faint">${o.competitions.length} compétition${o.competitions.length > 1 ? 's' : ''} · ${o.country}</span></span></a></li>`,
    )}</ul><p class="pad faint small">Une ligue seule est une organisation avec une compétition. <a href="#create">Créer une ligue</a></p>`,
  );
}

function gameTabs(active: 'all' | 'r6' | 'valorant' | 'rocket_league'): Raw {
  return tabs(
    [
      { label: 'Tous les jeux', route: '/', active: active === 'all' },
      ...D.games.map((g) => ({ label: g.name, route: `/${g.key === 'rocket_league' ? 'rocket-league' : g.key}`, active: active === g.key, count: D.competitionCards.filter((c) => c.game === g.key && c.status !== 'closed').length })),
    ],
    'boxed',
  );
}

/** Mine: what a logged-in player sees first (their team's next match, results, to-dos). */
function mineStrip(v: NonNullable<Viewer>): Raw {
  const tm = D.team(v.team as string);
  const next = D.findMatch('ligue-1', 7, 'greed-esport', 'rck-esport');
  const last = D.featured.noStats;
  const row = D.standings(tm.division).find((r) => r.team.slug === tm.slug) as D.StandingRow;
  return html`<section class="panel mine">
    <div class="ph"><h2>Mes équipes et mes matchs</h2><div class="ph-x"><a href="${href(`/teams/${tm.slug}/workspace`)}">Espace équipe</a></div></div>
    <div class="mine-g">
      <div class="mine-who">${photo(v.player ?? 'vexo', 44)}<div><b>${v.name}</b><br>${team(tm, { size: 16 })} <span class="faint">· Ligue 1 · ${row.rank}er · ${row.points} pts</span></div></div>
      <div><div class="lbl">Prochain match</div><a href="${matchHref(next)}">${team(next.a, { size: 14, tagOnly: true, link: false })} vs ${team(next.b, { size: 14, tagOnly: true, link: false })}</a><div class="faint">${next.scheduledAt ? D.when(next.scheduledAt) : ''}</div></div>
      <div><div class="lbl">Dernier résultat</div><a href="${matchHref(last)}">${last.a.tag} ${last.score?.[0]}–${last.score?.[1]} ${last.b.tag}</a><div class="faint">${last.scheduledAt ? D.day(last.scheduledAt) : ''} · ${last.map}</div></div>
      <div><div class="lbl">À faire</div><a href="${href(`/matches/${last.id}/upload`)}">${icon('upload', 12)} Envoyer les replays de CIV–GRD</a><div class="faint">aucun replay reçu pour ce match</div></div>
    </div>
  </section>`;
}

export function ligoHome(viewer: Viewer = null): string {
  const main = html`
  ${viewer ? mineStrip(viewer) : ''}
  <div class="head"><h1>Aujourd’hui sur Ligo</h1><div class="sub">${D.day(D.NOW)} · ${D.competitionCards.filter((c) => c.status !== 'closed').length} compétitions de ${D.orgs.length} organisations, sur ${D.games.length} jeux</div></div>
  ${gameTabs('all')}
  ${panel('Matchs du jour', todayTable('all'), { extra: html`<a href="${href('/matches')}">Tous les matchs</a>` })}
  ${panel('Compétitions', competitionsTable(D.competitionCards.filter((c) => c.status !== 'closed'), true))}
  ${panel(
    'Derniers résultats',
    html`<table class="cal tagm"><caption class="vh">Derniers résultats</caption><tbody>${latestResults(6).map((m) => calRow(m, { day: true, info: false }))}</tbody></table>`,
    { extra: html`<span class="faint">toutes compétitions</span>` },
  )}`;
  return page({
    title: viewer ? 'Accueil' : 'Ligo',
    crumbs: [['Ligo', null]],
    main,
    cols: 'three',
    left: viewer ? leftQuick(focusTeam(D.team(viewer.team as string), 'votre équipe')) : leftQuick(),
    right: viewer
      ? html`${rightQuick(focusTeam(D.team(viewer.team as string), 'votre division'))}${orgsPanel()}${recruitmentPanel()}`
      : html`${qLeaders()}${qResults()}${qMercato()}${orgsPanel()}${recruitmentPanel()}`,
    viewer,
    description: 'Ligo : ligues esport à divisions, classements, calendriers, matchs et stats.',
  });
}

export function r6Home(): string {
  const cards = D.competitionCards.filter((c) => c.game === 'r6');
  const g = D.games[0] as D.GameInfo;
  const main = html`
  <div class="head head-game">${gameIcon(g, 32)}<div><h1>Rainbow Six Siege</h1><div class="sub">${cards.filter((c) => c.status !== 'closed').length} compétitions en cours · ${cards.reduce((n, c) => n + c.teams, 0)} équipes · ${cards.reduce((n, c) => n + c.today, 0)} matchs aujourd’hui</div></div></div>
  ${gameTabs('r6')}
  ${panel('Compétitions', competitionsTable(cards, false), { extra: html`<span class="faint">publiques, par activité</span>` })}
  ${panel('Matchs du jour', todayTable('r6'))}
  ${panel(
    'Derniers résultats',
    html`<table class="cal tagm"><caption class="vh">Derniers résultats R6</caption><tbody>${latestResults(5).map((m) => calRow(m, { day: true, info: false }))}
      <tr><td class="t">${D.day(D.otherMatchesToday[0]?.at ?? D.NOW)} <b>20:00</b></td><td class="ma">${teamBadge(D.otherMatchesToday[0]!.a, { size: 16 })} ${D.otherMatchesToday[0]!.a.name}</td><td class="mid"><span class="sc"><span class="w">7</span>–4</span></td><td class="mb">${teamBadge(D.otherMatchesToday[0]!.b, { size: 16 })} ${D.otherMatchesToday[0]!.b.name}</td><td class="stc"><span class="faint">BSL</span></td></tr></tbody></table>`,
  )}
  <p class="note">${icon('alert', 12)} Aucun classement entre ligues : des divisions de niveaux différents ne se comparent pas sur leurs seuls résultats. Le niveau d’équipe (0–10) viendra quand sa formule sera validée.</p>`;
  return page({
    title: 'Rainbow Six Siege',
    crumbs: [['Ligo', '/'], ['Rainbow Six Siege', null]],
    main,
    game: 'r6',
    cols: 'three',
    left: leftQuick(),
    right: html`${qLeaders()}${qResults()}${recruitmentPanel()}${panel(
      'Équipes sans compétition',
      html`<ul class="wl">${D.scrimOnlyTeams.map((s) => html`<li><span class="tm">${teamBadge(s.team, { size: 14 })}<span class="n">${s.team.name}</span></span> <span class="faint">${s.city} · scrims</span></li>`)}</ul><p class="pad faint small">Des clubs utilisent Ligo pour leurs seuls scrims : leur page publique existe, leur espace reste privé.</p>`,
    )}${orgsPanel()}`,
  });
}

export const _u = [raw, kv];
