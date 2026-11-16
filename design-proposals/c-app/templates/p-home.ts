// Home (the group's scoreboard), the organisation page and the season hubs (LFR, LFRL, LFV).

import * as D from '../../_data/index.ts';
import { href, html, icon, raw, teamBadge, teamRoute, type Raw } from '../../_build/lib.ts';
import { t } from '../../_build/i18n.ts';
import { latestResults, divisionName } from '../../_build/shared.ts';
import { compTabs, doc, entityHead, tabs, themeVars, type Viewer } from './layout.ts';
import { byDay, empty, formDots, matchList, pill, playerLink, sectionHead, standingsTable, teamName } from './ui.ts';

const STATUS_LABEL: Record<D.SeasonStatus, [string, 'done' | 'info' | 'warn' | 'muted' | 'live']> = {
  registration: ['Inscriptions ouvertes', 'info'],
  active: ['En cours', 'live'],
  cup: ['Coupe', 'warn'],
  closed: ['Terminée', 'muted'],
};

export const seasonStatus = (s: D.SeasonStatus) => pill(STATUS_LABEL[s][1], STATUS_LABEL[s][0]);

/** A competition's header row inside a cross-league list (FotMob groups matches by league). */
function leagueRow(slug: string, label: string, route: string): Raw {
  const c = D.competition(slug);
  return html`<div class="lg-h" style="${themeVars(slug)}"><span class="lg-chip" aria-hidden="true">${c.short}</span><a href="${href(route)}">${label}</a><span class="lg-title">${c.titleLabel}</span></div>`;
}

function otherRow(o: (typeof D.otherTonight)[number]): Raw {
  const a = o.a ? D.team(o.a) : null;
  const b = o.b ? D.team(o.b) : null;
  return html`<ul class="mlist"><li class="mr"><a href="${href(`/c/${o.competition}/s1`)}">
    <span class="mr-when"><span class="mr-t">${D.time(o.at)}</span><span class="mr-s">${D.sameDay(o.at, D.NOW) ? 'Auj.' : D.dateShort(o.at)}</span></span>
    ${
      a && b
        ? html`<span class="mr-teams"><span class="mr-team">${teamBadge(a, { size: 20 })}<span class="tn-long">${a.name}</span><span class="tn-short">${a.tag}</span><span class="mr-score"></span></span><span class="mr-team">${teamBadge(b, { size: 20 })}<span class="tn-long">${b.name}</span><span class="tn-short">${b.tag}</span><span class="mr-score"></span></span></span>`
        : html`<span class="mr-teams"><span class="mr-team mr-lobby">Lobby mixte · 10 joueurs</span><span class="mr-team mr-note">${'note' in o ? o.note : ''}</span></span>`
    }
    <span class="mr-info"><span class="mr-meta"><span>BO${o.bestOf}</span></span></span>
  </a></li></ul>`;
}

function dayStrip(): Raw {
  const days = [-2, -1, 0, 1, 2, 3].map((d) => D.NOW + d * 86_400_000);
  return html`<nav class="days" aria-label="Jours"><ol>${days.map(
    (d) => html`<li><a href="${href('/c/lfr/s3/calendar')}" ${D.sameDay(d, D.NOW) ? raw('aria-current="date"') : ''}><span>${D.sameDay(d, D.NOW) ? 'Auj.' : D.weekday(d).slice(0, 3) + '.'}</span><strong>${new Date(d).getUTCDate()}</strong></a></li>`,
  )}</ol></nav>`;
}

export function home(viewer: Viewer = null): string {
  const today = D.matches.filter((m) => m.scheduledAt && D.sameDay(m.scheduledAt, D.NOW));
  const tonightL1 = today.filter((m) => m.division === 'ligue-1');
  const tonightL2 = today.filter((m) => m.division === 'ligue-2');
  const rest = D.matches.filter(
    (m) => (m.week === 6 || m.extension) && m.scheduledAt && m.scheduledAt > D.NOW && !D.sameDay(m.scheduledAt, D.NOW) && m.scheduledAt < D.weekRange(6).end,
  );
  const pending = D.matches.filter((m) => m.week === 6 && (m.status === 'proposed' || m.status === 'to_schedule' || m.status === 'disputed'));
  const l1 = D.standings('ligue-1');
  const l2 = D.standings('ligue-2');
  const body = html`
  <div class="page">
    <div class="home-top">
      <h1 class="h-page">Jeudi 26 novembre</h1>
      <p class="muted">${t('week')} 6 de la LFR · 20:40 CET</p>
    </div>
    ${dayStrip()}
    <div class="split">
      <div class="col-main">
        <section aria-labelledby="tonight">
          ${sectionHead(html`<span id="tonight">Ce soir</span>`, ['Calendrier', '/c/lfr/s3/calendar'])}
          ${leagueRow('lfr', 'LFR · Ligue 1', '/c/lfr/s3')}
          ${matchList(tonightL1)}
          ${leagueRow('lfr', 'LFR · Ligue 2', '/c/lfr/s3')}
          ${matchList(tonightL2)}
          ${leagueRow('lfrl', 'LFRL · Division 1', '/c/lfrl/s1')}
          ${otherRow(D.otherTonight[0] as (typeof D.otherTonight)[number])}
          ${leagueRow('frfl', 'FRFL · Lobby #31', '/c/frfl/s1/standings')}
          ${otherRow(D.otherTonight[1] as (typeof D.otherTonight)[number])}
        </section>
        <section aria-labelledby="week">
          ${sectionHead(html`<span id="week">Cette semaine</span>`, ['Semaine 6', '/c/lfr/s3/calendar'])}
          ${byDay(rest, { showDivision: true })}
          <h3 class="sub-h">En attente d’un horaire ou d’une décision</h3>
          ${matchList(pending, { showDivision: true })}
        </section>
        <section aria-labelledby="results">
          ${sectionHead(html`<span id="results">Derniers résultats</span>`, ['Tous les résultats', '/c/lfr/s3/calendar'])}
          ${matchList(latestResults(6), { showDate: true, showDivision: true })}
        </section>
      </div>
      <aside class="col-side">
        <section aria-labelledby="st">
          ${sectionHead(html`<span id="st">Classements</span>`, [t('standings'), '/c/lfr/s3/standings/ligue-1'])}
          <h3 class="sub-h">Ligue 1</h3>
          ${standingsTable(l1, { compact: true, limit: 5 })}
          <h3 class="sub-h">Ligue 2</h3>
          ${standingsTable(l2, { compact: true, limit: 5 })}
        </section>
        <section aria-labelledby="merc">
          ${sectionHead(html`<span id="merc">Mercato</span>`, ['Recrutement', '/c/lfr/recruitment'])}
          <ul class="list">${D.mercatoMoves.map((mv) => {
            const p = D.players.get(mv.player.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
            const to = mv.to ? D.team(mv.to) : null;
            const from = mv.from ? D.team(mv.from) : null;
            return html`<li class="mv"><span class="mv-who">${p ? playerLink(p.slug) : mv.player}</span>
              <span class="mv-path">${from ? html`${teamBadge(from, { size: 16 })} ${from.tag}` : html`<span class="muted">Libre</span>`} ${icon('chevronRight', 12)} ${to ? html`${teamBadge(to, { size: 16 })} ${to.tag}` : html`<span class="muted">Libre</span>`}${mv.kind === 'staff' ? html` <span class="muted">(staff)</span>` : ''}</span>
              <span class="mv-at">${D.competition(mv.competition).short} · ${D.dateShort(mv.at)}</span></li>`;
          })}</ul>
        </section>
        <section aria-labelledby="comps">
          ${sectionHead(html`<span id="comps">Compétitions</span>`, ['MBL Group', '/o/mbl-group'])}
          <ul class="list">${D.competitions.map((c) => {
            const s = c.seasons[0] as D.Season;
            return html`<li class="comp-li" style="${themeVars(c.slug)}"><a href="${href(c.slug === 'lfr' ? '/c/lfr/s3' : `/c/${c.slug}/${s.slug}`)}"><span class="lg-chip" aria-hidden="true">${c.short}</span><span class="comp-li-t"><strong>${c.name}</strong><span class="muted">${c.titleLabel} · ${s.name}${s.currentWeek ? ` · ${t('week')} ${s.currentWeek}` : ''}</span></span>${seasonStatus(s.status)}</a></li>`;
          })}</ul>
        </section>
      </aside>
    </div>
  </div>`;
  return doc({ title: t('home'), body, viewer, nav: 'home', description: 'Matchs du soir, résultats et classements des ligues de MBL Group.' });
}

// ---------------------------------------------------------------------------------------------

export function org(): string {
  const byTitle = new Map<string, D.Competition[]>();
  for (const c of D.competitions) byTitle.set(c.titleLabel, [...(byTitle.get(c.titleLabel) ?? []), c]);
  const body = html`${entityHead({
    crumbs: [['MBL Group', null]],
    title: 'MBL Group',
    sub: D.org.about,
    visual: html`<span class="comp-mark comp-mark-neutral" aria-hidden="true">MBL</span>`,
  })}
  ${tabs([
    { label: t('overview'), route: '/o/mbl-group', current: true },
    { label: t('competitions'), route: '/o/mbl-group', count: 4 },
    { label: 'Bannissements', route: '/o/mbl-group#bans', count: D.orgBans.length },
  ])}
  <div class="page split">
    <div class="col-main">
      ${[...byTitle.entries()].map(
        ([title, comps]) => html`<section>
        ${sectionHead(title)}
        ${comps.map(
          (c) => html`<div class="org-comp" style="${themeVars(c.slug)}">
            <div class="org-comp-h"><span class="lg-chip" aria-hidden="true">${c.short}</span><div><h3><a href="${href(c.slug === 'lfr' ? '/c/lfr/s3' : `/c/${c.slug}/${c.seasons[0]?.slug}`)}">${c.name}</a></h3><p class="muted">${c.platform} · ${c.mode === 'mixed' ? 'équipes mixtes, classement individuel' : 'équipes'} · ${D.int(c.discordMembers)} membres sur Discord</p></div>
            <a class="btn btn-ghost" href="${c.discordInvite}">${icon('discord', 16)} Discord</a></div>
            <table class="tbl">
              <caption class="sr">Saisons de ${c.name}</caption>
              <thead><tr><th scope="col">Saison</th><th scope="col">Dates</th><th scope="col">Divisions</th><th scope="col">Statut</th></tr></thead>
              <tbody>${c.seasons.map(
                (s) => html`<tr><th scope="row"><a href="${href(`/c/${c.slug}/${s.slug}`)}">${s.name}</a></th><td>${D.dateShort(s.startsOn)} – ${D.dateYear(s.endsOn)}</td><td>${s.divisions.map((d) => d.name).join(', ')}</td><td>${seasonStatus(s.status)}${s.note ? html`<div class="muted sm">${s.note}</div>` : ''}</td></tr>`,
              )}</tbody>
            </table>
          </div>`,
        )}
      </section>`,
      )}
    </div>
    <aside class="col-side">
      <section id="bans">
        ${sectionHead('Bannissements pour triche')}
        <p class="sm">Un joueur banni pour triche l’est dans toutes les ligues du groupe : LFR, LFV et LFRL. La raison publiée est celle que le staff rend publique ; les preuves restent au staff.</p>
        <table class="tbl">
          <thead><tr><th scope="col">Compte</th><th scope="col">Depuis</th><th scope="col">Motif</th></tr></thead>
          <tbody>${D.orgBans.map((b) => html`<tr><th scope="row">${b.account}</th><td class="num-l">${D.dateYear(b.since)}</td><td>${b.reason}<div class="muted sm">${b.leagues.join(', ')}</div></td></tr>`)}</tbody>
        </table>
      </section>
      <section>
        ${sectionHead('Les serveurs Discord')}
        <ul class="list">${D.competitions.map((c) => html`<li class="disc"><span>${c.short}</span><a href="${c.discordInvite}">${c.discordInvite.replace('https://', '')} ${icon('external', 12)}</a></li>`)}</ul>
      </section>
    </aside>
  </div>`;
  return doc({ title: 'MBL Group', body, nav: 'leagues' });
}

// ---------------------------------------------------------------------------------------------
// Season hub: one template, themed by four variables. LFR (rounds) and LFRL (goals in series).

export function lfrHub(): string {
  const l1 = D.standings('ligue-1');
  const l2 = D.standings('ligue-2');
  const wk = (div: string) => D.matches.filter((m) => m.division === div && (m.week === 6 || (m.extension && m.week === 5)));
  const body = html`${hubHead('lfr')}
  ${compTabs('overview')}
  <div class="page split">
    <div class="col-main">
      <section>
        ${sectionHead(`${t('week')} 6 · ${D.dateShort(D.weekRange(6).start)}–${D.dateShort(D.weekRange(6).end)}`, ['Calendrier complet', '/c/lfr/s3/calendar'])}
        <h3 class="sub-h">Ligue 1</h3>
        ${byDay(wk('ligue-1'))}
        <h3 class="sub-h">Ligue 2</h3>
        ${byDay(wk('ligue-2'))}
      </section>
      <section>
        ${sectionHead('Derniers résultats')}
        ${matchList(latestResults(5), { showDate: true, showDivision: true })}
      </section>
    </div>
    <aside class="col-side">
      <section>
        ${sectionHead('Ligue 1', [t('standings'), '/c/lfr/s3/standings/ligue-1'])}
        ${standingsTable(l1, { compact: true })}
      </section>
      <section>
        ${sectionHead('Ligue 2', [t('standings'), '/c/lfr/s3/standings/ligue-2'])}
        ${standingsTable(l2, { compact: true, limit: 6 })}
      </section>
      ${hubDiscord('lfr')}
    </aside>
  </div>`;
  return doc({ title: 'LFR Saison 3', comp: 'lfr', body, nav: 'leagues' });
}

function hubHead(slug: string): Raw {
  const c = D.competition(slug);
  const s = c.seasons[0] as D.Season;
  return entityHead({
    crumbs: [
      ['MBL Group', '/o/mbl-group'],
      [c.short, `/c/${slug}/${s.slug}`],
      [s.name, null],
    ],
    title: c.name,
    sub: html`${c.titleLabel} · ${s.name}${s.currentWeek ? html` · ${t('week')} ${s.currentWeek} sur ${s.divisions[0]?.weeks}` : ''} · ${s.divisions.map((d) => d.name).join(', ')}`,
    visual: html`<span class="comp-mark" aria-hidden="true">${c.short}</span>`,
    side: html`<a class="btn btn-on" href="${c.discordInvite}">${icon('discord', 18)} ${t('joinDiscord')}</a>`,
  });
}

function hubDiscord(slug: string): Raw {
  const c = D.competition(slug);
  return html`<section class="discord-box">
    <h2 class="h-sm">${icon('discord', 18)} Le Discord de la ${c.short}</h2>
    <p class="sm">Salons de match, résultats et annonces. ${D.int(c.discordMembers)} membres.</p>
    <a class="btn" href="${c.discordInvite}">${t('joinDiscord')} ${icon('external', 14)}</a>
  </section>`;
}

export function lfrlHub(): string {
  const rows = D.rlStandings();
  const week = D.rlSeries.filter((s) => s.week === 4);
  const last = D.rlSeries.filter((s) => s.status === 'validated').sort((a, b) => b.at - a.at).slice(0, 5);
  const seriesRow = (s: D.RlSeries) => {
    const wa = s.games.filter((g) => g[0] > g[1]).length;
    const wb = s.games.length - wa;
    const done = s.status === 'validated';
    const line = (team: D.Team, w: number, won: boolean) =>
      html`<span class="mr-team ${done && won ? 'won' : ''} ${done && !won ? 'lost' : ''}">${teamBadge(team, { size: 20 })}<span class="tn-long">${team.name}</span><span class="tn-short">${team.tag}</span><span class="mr-score">${done ? w : ''}</span></span>`;
    return html`<li class="mr"><a href="#series-${s.id}">
      <span class="mr-when"><span class="mr-t">${done ? D.dateShort(s.at) : D.time(s.at)}</span><span class="mr-s">${done ? 'Fin' : D.sameDay(s.at, D.NOW) ? 'Auj.' : D.dateShort(s.at)}</span></span>
      <span class="mr-teams">${line(s.a, wa, wa > wb)}${line(s.b, wb, wb > wa)}</span>
      <span class="mr-info"><span class="mr-meta"><span>BO5</span>${done ? html`<span>${s.games.map((g) => `${g[0]}–${g[1]}`).join(' · ')} buts</span>` : ''}</span></span>
    </a></li>`;
  };
  const body = html`${hubHead('lfrl')}
  ${compTabs('overview', 'lfrl')}
  <div class="page split">
    <div class="col-main">
      <section>
        ${sectionHead(`${t('week')} 4 · séries en BO5`)}
        <ul class="mlist">${week.map(seriesRow)}</ul>
      </section>
      <section>
        ${sectionHead('Derniers résultats')}
        <ul class="mlist">${last.map(seriesRow)}</ul>
      </section>
    </div>
    <aside class="col-side">
      <section>
        ${sectionHead('Division 1')}
        <div class="tbl-wrap"><table class="st st-compact">
          <thead><tr><th scope="col" class="c-rank">#</th><th scope="col" class="c-team">${t('colTeam')}</th><th scope="col" class="num"><abbr title="Séries jouées">MJ</abbr></th><th scope="col" class="num"><abbr title="Séries gagnées">W</abbr></th><th scope="col" class="num"><abbr title="Séries perdues">L</abbr></th><th scope="col" class="num"><abbr title="Buts pour">GF</abbr></th><th scope="col" class="num"><abbr title="Buts contre">GA</abbr></th><th scope="col" class="num"><abbr title="Différence de buts">Diff</abbr></th><th scope="col" class="num c-pts">PTS</th></tr></thead>
          <tbody>${rows.map(
            (r) => html`<tr class="${r.zone ? 'z z-champion' : ''}"><td class="c-rank">${r.rank}${r.zone ? html`<span class="zl">C</span>` : ''}</td><th scope="row" class="c-team">${teamName(r.team, { size: 22 })}</th><td class="num">${r.played}</td><td class="num">${r.wins}</td><td class="num">${r.losses}</td><td class="num">${r.gf}</td><td class="num">${r.ga}</td><td class="num diff ${r.diff > 0 ? 'pos' : r.diff < 0 ? 'neg' : ''}">${D.signed(r.diff)}</td><td class="num c-pts">${r.points}</td></tr>`,
          )}</tbody>
        </table></div>
        <p class="sm muted">Le score du classement compte les buts : GF buts marqués, GA buts encaissés, sur toutes les manches des séries.</p>
      </section>
      ${hubDiscord('lfrl')}
    </aside>
  </div>`;
  return doc({ title: 'LFRL Saison 1', comp: 'lfrl', body, nav: 'leagues' });
}

export function lfvHub(): string {
  const c = D.competition('lfv');
  const filed = D.teams.filter((x) => x.competition === 'lfv');
  const body = html`${hubHead('lfv')}
  ${compTabs('overview', 'lfv')}
  <div class="page split">
    <div class="col-main">
      <section>
        ${sectionHead('Saison 2 · inscriptions')}
        ${empty('Pas encore de classement ni de calendrier', html`Le calendrier est tiré après la clôture des inscriptions, le 20 décembre. Premier match le ${D.dateLong(c.seasons[0]?.startsOn as number)}.`)}
        <h3 class="sub-h">Équipes inscrites (${filed.length} sur 12)</h3>
        <ul class="list">${filed.map((x) => html`<li class="li-team">${teamName(x, { size: 24 })}<span class="muted sm">${D.clubBySlug.get(x.club)?.city ?? ''}</span>${x.slug === 'kori-esport' ? pill('pending', 'En attente du staff') : pill('done', 'Validée')}</li>`)}</ul>
        <p><a class="btn" href="#register">${icon('file', 16)} Inscrire une équipe</a></p>
      </section>
    </div>
    <aside class="col-side">
      <section>
        ${sectionHead('Saison 1')}
        <p class="sm">${seasonStatus('cup')} Coupe LFV : demi-finales le 3 déc.</p>
        ${otherRow(D.otherTonight[2] as (typeof D.otherTonight)[number])}
      </section>
      ${hubDiscord('lfv')}
    </aside>
  </div>`;
  return doc({ title: 'LFV Saison 2', comp: 'lfv', body, nav: 'leagues' });
}

export { formDots, divisionName, teamRoute };
