// Home (the group's match day), the organisation page and the competition hubs.

import * as D from '../../_data/index.ts';
import { html, href, icon, raw, teamRoute, textOn, type Raw } from '../../_build/lib.ts';
import { t } from '../../_build/i18n.ts';
import { latestResults, weekMatches } from '../../_build/shared.ts';
import { page, themeVars } from './layout.ts';
import { badge, divName, matchHero, matchRow, pill, sectionHead, sidesLine, standingsTable, statusPill, teamLink, signedCell } from './parts.ts';


const F = D.featured;

const SEASON_STATUS: Record<D.SeasonStatus, [string, 'done' | 'info' | 'warn' | 'muted' | 'live']> = {
  registration: ['Inscriptions', 'info'],
  active: ['En cours', 'live'],
  cup: ['Coupe', 'warn'],
  closed: ['Terminée', 'muted'],
};

function compCards(): Raw {
  const route: Record<string, string> = { lfr: '/c/lfr/s3', lfrl: '/c/lfrl/s1', lfv: '/c/lfv/s2', frfl: '/c/frfl/s1/standings' };
  return html`<div class="comp-strip">${D.competitions.map((c) => {
    const s = c.seasons[0] as D.Season;
    const [label] = SEASON_STATUS[s.status];
    const line = s.status === 'active' && s.currentWeek ? `${s.name} · ${t('week')} ${s.currentWeek}` : `${s.name}${s.note ? ` · ${s.note.split(' · ')[0]}` : ''}`;
    return html`<a class="comp-card" href="${href(route[c.slug] ?? '/')}" style="${themeVars(c.slug)}">
      <span class="pill">${label}</span>
      <span class="disp">${c.short}</span>
      <p><b>${c.titleLabel}</b></p>
      <p>${line}</p>
    </a>`;
  })}</div>`;
}

function mini(at: number, title: Raw | string, sub: string, right: Raw | string, link: string, below?: Raw): Raw {
  return html`<a class="mini" href="${href(link)}"><span class="t">${D.time(at)}<small>${D.day(at)}</small></span><span class="who">${title}<small>${sub}</small>${below ?? ''}</span><span>${right}</span></a>`;
}

function tonightFields(m: D.Match): Raw {
  const tf = (team: D.Team, side: 'a' | 'b', sub: string) => {
    const [p, s2] = team.colors;
    return html`<a class="tf ${side}" href="${href(teamRoute(team))}" style="--tf-bg:${p};--tf-fg:${textOn(p)};--tf-2:${s2}"><span class="big" aria-hidden="true">${team.tag}</span><span><span class="nm">${team.name}</span><span class="sub" style="display:block">${sub}</span></span></a>`;
  };
  return html`<section class="hero" style="border:0;padding-bottom:var(--s5)">
    <p class="stage">Ce soir · ${divName(m.division)} · ${t('week')} ${m.week}</p><p class="stage">LFR · Rainbow Six Siege · BO1</p>
    <div class="fields">
      ${tf(m.a, 'a', '1er · hôte · côté en prolongation')}
      <div class="mid"><span class="vs">VS</span><a href="${href(`/matches/${m.id}/veto`)}">${pill('Veto en cours · 5/9', 'live')}</a></div>
      ${tf(m.b, 'b', '5e · premier ban · choix du côté')}
    </div>
    <div class="datebox"><div><span>${icon('calendar', 20)} ${D.day(m.scheduledAt as number)}</span><span>${icon('clock', 20)} ${D.timeZ(m.scheduledAt as number)}</span></div></div>
    <div class="hero-facts"><span>${icon('play', 16)} <a href="${m.stream ?? '#'}">twitch.tv/lfr_r6</a></span><span><a href="${href(`/matches/${m.id}`)}">Fiche du match et aperçu ${icon('chevronRight', 14)}</a></span></div>
  </section>`;
}

function homeBody(): Raw {
  const m = F.toPlay;
  const tonight = D.otherTonight.filter((o) => D.sameDay(o.at, D.NOW));
  const coming = [F.proposed, F.extensionAgreed, F.autoScheduled];
  const mercato = D.mercatoMoves.slice(0, 5);
  return html`
  <section class="tonight">
    <div class="wrap tonight-grid">
      <div>
        ${tonightFields(m)}
      </div>
      <aside class="tonight-side" style="padding-top:var(--s6)">
        ${sectionHead('Aussi ce soir', { small: D.day(D.NOW) })}
        <div class="minis">
          ${tonight.map((o) => {
            const title = o.a && o.b ? html`${badge(D.team(o.a), 18)} ${D.team(o.a).tag} – ${D.team(o.b).tag} ${badge(D.team(o.b), 18)}` : html`${o.note ?? ''}`;
            return mini(o.at, title, o.label, html`<span class="pill info">BO${o.bestOf}</span>`, o.competition === 'lfrl' ? '/c/lfrl/s1' : '/c/frfl/s1/standings');
          })}
        </div>
        <div style="margin-top:var(--s5)">${sectionHead('Plus tard cette semaine')}</div>
        <div class="minis">
          ${coming.map((x) => {
            const at = x.scheduledAt ?? x.proposal?.at ?? D.NOW;
            return mini(at, html`${badge(x.a, 18)} ${x.a.tag} – ${x.b.tag} ${badge(x.b, 18)}`, `${divName(x.division)} · S${x.week}`, '', `/matches/${x.id}`, statusPill(x));
          })}
        </div>
      </aside>
    </div>
  </section>

  <div class="wrap">
    <section class="section">${sectionHead('Les ligues du groupe', { small: 'Saisons en cours', link: ['MBL Group', '/o/mbl-group'] })}${compCards()}</section>

    <div class="grid-main section">
      <div class="stack">
        <div>${sectionHead(`${t('week')} 6 · Ligue 1`, { small: '23 – 29 nov.', link: [t('calendar'), '/c/lfr/s3/calendar'] })}
          <div class="matchlist">${[...weekMatches('ligue-1', 6), F.extensionAgreed].map((x) => matchRow(x, { today: x.scheduledAt ? D.sameDay(x.scheduledAt, D.NOW) : false }))}</div></div>
        <div>${sectionHead(`${t('week')} 6 · Ligue 2`, { small: '23 – 29 nov.' })}
          <div class="matchlist">${[...weekMatches('ligue-2', 6), F.disputed, F.autoScheduled].map((x) => matchRow(x))}</div></div>
      </div>
      <aside class="stack">
        <div>${sectionHead(`${t('standings')} Ligue 1`, { link: ['Complet', '/c/lfr/s3/standings/ligue-1'] })}${standingsTable('ligue-1', { compact: true })}</div>
        <div>${sectionHead(`${t('standings')} Ligue 2`, { link: ['Complet', '/c/lfr/s3/standings/ligue-2'] })}${standingsTable('ligue-2', { compact: true, limit: 6 })}<p class="note"><a href="${href('/c/lfr/s3/standings/ligue-2')}">Places 7 à 12 ${icon('chevronRight', 12)}</a></p></div>
      </aside>
    </div>

    <div class="grid-2 section">
      <div>${sectionHead('Derniers résultats', { small: 'validés' })}
        <div class="matchlist">${latestResults(6).map((x) => matchRow(x, { showDiv: true }))}</div></div>
      <div>${sectionHead('Mercato', { small: `${D.mercatoWindow.name}, fermé le ${D.dateShort(D.mercatoWindow.closes)}` })}
        <table class="tbl"><thead><tr><th scope="col">Date</th><th scope="col">Joueur</th><th scope="col">Mouvement</th></tr></thead><tbody>
        ${mercato.map((mv) => {
          const from = mv.from ? D.team(mv.from) : null;
          const to = mv.to ? D.team(mv.to) : null;
          const kind = { transfer: 'Transfert', arrival: 'Arrivée', departure: 'Départ', staff: 'Staff' }[mv.kind];
          return html`<tr><td class="nowrap muted">${D.dateShort(mv.at)}</td><th scope="row" style="font-weight:600">${mv.player}<br><span class="kicker" style="letter-spacing:.08em">${kind} · ${D.competition(mv.competition).short}</span></th>
            <td>${from ? html`${badge(from, 18)} ${from.tag}` : html`<span class="dim">Libre</span>`} ${icon('chevronRight', 14)} ${to ? html`${badge(to, 18)} ${to.tag}` : html`<span class="dim">Libre</span>`}</td></tr>`;
        })}
        </tbody></table></div>
    </div>
  </div>`;
}

export const home = () =>
  page({ title: `${t('home')}`, comp: null, body: homeBody(), description: 'Les matchs de ce soir et de la semaine dans les ligues de MBL Group.' });

// ---------------------------------------------------------------------------------------------

export function org(): Raw {
  const byTitle: [string, D.Competition[]][] = [
    ['Rainbow Six Siege', D.competitions.filter((c) => c.title === 'r6')],
    ['Valorant', D.competitions.filter((c) => c.title === 'valorant')],
    ['Rocket League', D.competitions.filter((c) => c.title === 'rocket_league')],
  ];
  const route: Record<string, string> = { lfr: '/c/lfr/s3', lfrl: '/c/lfrl/s1', lfv: '/c/lfv/s2', frfl: '/c/frfl/s1/standings' };
  const body = html`<div class="wrap">
    <header class="page-title"><p class="kicker">Organisation</p><h1>MBL Group</h1><p>${D.org.about}</p></header>
    ${byTitle.map(
      ([title, comps]) => html`<section class="section">${sectionHead(title, { small: `${comps.length} compétition${comps.length > 1 ? 's' : ''}` })}
      ${comps.map(
        (c) => html`<div class="grid-main" style="${themeVars(c.slug)};margin-bottom:var(--s5);gap:var(--s5)">
          <div style="display:grid;grid-template-columns:160px minmax(0,1fr);gap:var(--s4)">
            <a class="comp-card" href="${href(route[c.slug] ?? '/')}" style="min-height:120px"><span class="disp">${c.short}</span><p>${c.mode === 'mixed' ? 'Équipes mixtes' : 'Équipes'}</p></a>
            <div>
              <h3 style="font-size:var(--fs-l)">${c.name}</h3>
              <p class="muted" style="font-size:var(--fs-s)">${c.titleLabel}${c.platform ? ` · ${c.platform}` : ''} · score en ${c.scoreUnit === 'goals' ? 'buts' : 'manches'}</p>
              <table class="tbl" style="margin-top:var(--s2)"><thead><tr><th scope="col">Saison</th><th scope="col">Statut</th><th scope="col">Dates</th><th scope="col" class="hide-m">Note</th></tr></thead><tbody>
                ${c.seasons.map((s) => {
                  const [label, tone] = SEASON_STATUS[s.status];
                  return html`<tr><th scope="row" style="font-weight:600">${s.name}</th><td>${pill(label, tone === 'live' ? 'done' : tone)}</td><td class="nowrap muted">${D.dateShort(s.startsOn)} – ${D.dateYear(s.endsOn)}</td><td class="hide-m muted">${s.note ?? (s.status === 'active' && s.currentWeek ? `${t('week')} ${s.currentWeek} · ${s.divisions.map((d) => d.name).join(', ')}` : s.divisions.map((d) => d.name).join(', '))}</td></tr>`;
                })}
              </tbody></table>
            </div>
          </div>
          <div class="panel"><p class="kicker">Serveur Discord</p><p style="margin:6px 0 var(--s3)"><b>${D.int(c.discordMembers)}</b> membres · un serveur par ligue</p><a class="btn btn-league" href="${c.discordInvite}">${icon('discord', 18)} ${t('joinDiscord')} ${c.short} ${icon('external', 14)}</a></div>
        </div>`,
      )}</section>`,
    )}
    <section class="section">${sectionHead('Bannissements pour triche', { small: 'valables dans toutes les ligues du groupe' })}
      <p class="note" style="margin-bottom:var(--s3)">Un joueur banni pour triche dans une ligue l’est dans toutes : LFR, LFV, LFRL et FRFL. Le motif affiché est le motif public.</p>
      <table class="tbl"><thead><tr><th scope="col">Compte</th><th scope="col">Depuis</th><th scope="col">Motif</th><th scope="col" class="hide-m">Ligues</th></tr></thead><tbody>
      ${D.orgBans.map((b) => html`<tr><th scope="row" style="font-weight:600">${b.account}</th><td class="nowrap">${D.dateYear(b.since)}</td><td>${b.reason}</td><td class="hide-m">${b.leagues.join(', ')}</td></tr>`)}
      </tbody></table>
    </section>
  </div>`;
  return page({ title: 'MBL Group', comp: null, crumbs: [[t('home'), '/'], ['MBL Group', null]], body });
}

// ---------------------------------------------------------------------------------------------
// Competition hubs: one template, the league's theme from variables only.

function rlStandingsTable(): Raw {
  const rows = D.rlStandings();
  return html`<table class="tbl standings compact"><caption class="sr">Classement Division 1</caption>
    <thead><tr><th class="zone-cell"><span class="sr">Zone</span></th><th scope="col">#</th><th scope="col">${t('colTeam')}</th><th scope="col" class="r"><abbr title="Séries jouées">MJ</abbr></th><th scope="col" class="r">W</th><th scope="col" class="r">L</th><th scope="col" class="r hide-m"><abbr title="Buts marqués">GF</abbr></th><th scope="col" class="r hide-m"><abbr title="Buts encaissés">GA</abbr></th><th scope="col" class="r">Diff</th><th scope="col" class="r">PTS</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr><td class="zone-cell">${r.zone ? html`<span class="zbar z-champion" title="Champion">C</span>` : html`<span class="zbar none"></span>`}</td><th scope="row" class="rank">${r.rank}</th><td>${teamLink(r.team, 22)}</td><td class="r">${r.played}</td><td class="r">${r.wins}</td><td class="r">${r.losses}</td><td class="r hide-m">${r.gf}</td><td class="r hide-m">${r.ga}</td><td class="r">${signedCell(r.diff)}</td><td class="r pts">${r.points}</td></tr>`)}</tbody>
  </table><p class="abbr"><b>MJ</b> séries jouées (BO5) · <b>GF</b> buts marqués · <b>GA</b> buts encaissés · <b>Diff</b> différence de buts · <b>PTS</b> 3 par série gagnée</p>`;
}

function rlRow(s: D.RlSeries): Raw {
  const wa = s.games.filter((g) => g[0] > g[1]).length;
  const wb = s.games.length - wa;
  const done = s.status === 'validated';
  return html`<div class="mrow">
    <div class="when"><b>${D.day(s.at)}</b>${D.timeZ(s.at)}</div>
    <div class="side a${done && wa < wb ? ' loser' : ''}"><span class="name">${s.a.name}</span><span class="tag">${s.a.tag}</span>${badge(s.a, 28)}</div>
    <div class="mid${done ? '' : ' vs'}">${done ? `${wa}–${wb}` : 'VS'}${done ? html`<small>${s.games.map((g) => `${g[0]}-${g[1]}`).join(' ')}</small>` : ''}</div>
    <div class="side b${done && wb < wa ? ' loser' : ''}">${badge(s.b, 28)}<span class="name">${s.b.name}</span><span class="tag">${s.b.tag}</span></div>
    <div class="meta">${done ? pill(t('stValidated'), 'done', 'check') : pill(s.status === 'scheduled' ? t('stScheduled') : t('stToSchedule'), s.status === 'scheduled' ? 'info' : 'muted')}<span class="sub">BO5 · score en buts</span></div>
  </div>`;
}

export function hub(slug: 'lfr' | 'lfrl' | 'lfv'): Raw {
  const c = D.competition(slug);
  const s = c.seasons[0] as D.Season;
  const crumbs: [string, string | null][] = [[t('home'), '/'], [c.short, null], [s.name, null]];
  let body: Raw;
  if (slug === 'lfr') {
    body = html`<div class="wrap grid-main" style="margin-top:var(--s4)">
      <div class="stack">
        <div class="figures">
          <div class="figure"><b>6<span class="dim">/9</span></b><span>Semaine en cours (Ligue 1)</span><small>23 – 29 nov.</small></div>
          <div class="figure"><b>2</b><span>Divisions</span><small>Ligue 1 · 10 équipes, Ligue 2 · 12</small></div>
          <div class="figure"><b>36</b><span>Matchs validés</span><small>+ 33 forfaits</small></div>
          <div class="figure"><b>3</b><span>Équipes exclues</span><small>règle des 50 %</small></div>
        </div>
        <div>${sectionHead(`${t('week')} 6 · Ligue 1`, { small: '23 – 29 nov.', link: [t('calendar'), '/c/lfr/s3/calendar'] })}<div class="matchlist">${[...weekMatches('ligue-1', 6), D.featured.extensionAgreed].map((x) => matchRow(x, { today: !!x.scheduledAt && D.sameDay(x.scheduledAt, D.NOW) }))}</div></div>
        <div>${sectionHead(`${t('week')} 6 · Ligue 2`, { small: '23 – 29 nov.' })}<div class="matchlist">${[...weekMatches('ligue-2', 6), D.featured.disputed, D.featured.autoScheduled].map((x) => matchRow(x))}</div></div>
        <div>${sectionHead('Derniers résultats')}<div class="matchlist">${latestResults(5).map((x) => matchRow(x, { showDiv: true }))}</div></div>
      </div>
      <aside class="stack">
        <div>${sectionHead('Ligue 1', { small: 'Classement', link: ['Complet', '/c/lfr/s3/standings/ligue-1'] })}${standingsTable('ligue-1', { compact: true, limit: 8 })}</div>
        <div>${sectionHead('Ligue 2', { small: 'Classement', link: ['Complet', '/c/lfr/s3/standings/ligue-2'] })}${standingsTable('ligue-2', { compact: true, limit: 6 })}</div>
        <div class="panel"><p class="kicker">Discord de la LFR</p><p style="margin:6px 0 var(--s3)">Salons de match, annonces de résultats, staff. <b>${D.int(c.discordMembers)}</b> membres.</p><a class="btn btn-league" href="${c.discordInvite}">${icon('discord', 18)} ${t('joinDiscord')} ${icon('external', 14)}</a></div>
        <div class="panel"><p class="kicker">Coupe de France</p><p style="margin-top:6px">Après la saison régulière, toutes les équipes : BO1, puis BO3 en huitièmes et quarts, BO5 en demies et finale.</p><p style="margin-top:var(--s2)"><a href="${href('/c/lfr/s3/bracket')}">Tableau ${icon('chevronRight', 12)}</a></p></div>
      </aside>
    </div>`;
  } else if (slug === 'lfrl') {
    const week = D.rlSeries.filter((x) => x.week === 4);
    const past = D.rlSeries.filter((x) => x.status === 'validated').sort((x, y) => y.at - x.at).slice(0, 4);
    body = html`<div class="wrap grid-main" style="margin-top:var(--s4)">
      <div class="stack">
        <div class="figures">
          <div class="figure"><b>4<span class="dim">/7</span></b><span>Semaine en cours</span><small>23 – 29 nov.</small></div>
          <div class="figure"><b>1</b><span>Division</span><small>8 équipes, séries BO5</small></div>
          <div class="figure"><b>${D.rlSeries.filter((x) => x.status === 'validated').length}</b><span>Séries validées</span><small>classement en buts</small></div>
        </div>
        <div>${sectionHead(`${t('week')} 4 · Division 1`, { small: '23 – 29 nov.', id: 'calendrier' })}<div class="matchlist">${week.map(rlRow)}</div></div>
        <div>${sectionHead('Derniers résultats')}<div class="matchlist">${past.map(rlRow)}</div></div>
      </div>
      <aside class="stack">
        <div>${sectionHead('Division 1', { small: 'Classement', id: 'classement' })}${rlStandingsTable()}</div>
        <div class="panel"><p class="kicker">Discord de la LFRL</p><p style="margin:6px 0 var(--s3)"><b>${D.int(c.discordMembers)}</b> membres.</p><a class="btn btn-league" href="${c.discordInvite}">${icon('discord', 18)} ${t('joinDiscord')} ${icon('external', 14)}</a></div>
        <div class="panel"><p class="kicker">Stats</p><p style="margin-top:6px">Replays <code>.replay</code> analysés dans le navigateur pour les joueurs PC ; grille manuelle pour les joueurs console.</p></div>
      </aside>
    </div>`;
  } else {
    const registered = D.teams.filter((x) => x.competition === 'lfv');
    body = html`<div class="wrap grid-main" style="margin-top:var(--s4)">
      <div class="stack">
        <div class="empty"><strong>Pas encore de classement ni de calendrier</strong>La Saison 2 commence le ${D.dateLong(s.startsOn)} ; le calendrier est publié à la clôture des inscriptions, le 20 décembre.</div>
        <div>${sectionHead('Équipes inscrites', { small: `${registered.length} sur 12 places` })}
          <table class="tbl"><thead><tr><th scope="col">${t('colTeam')}</th><th scope="col">Club</th><th scope="col">Statut</th></tr></thead><tbody>
          ${registered.map((x, i) => html`<tr><td>${teamLink(x, 24)}</td><td class="muted">${D.clubBySlug.get(x.club)?.name}</td><td>${i === 2 ? pill('En attente du staff', 'pending') : pill('Validée', 'done', 'check')}</td></tr>`)}
          </tbody></table></div>
        <div>${sectionHead('Saison 1 · Coupe LFV', { small: 'en cours' })}<p class="muted">Demi-finales le jeudi 3 décembre : Kōri Esport contre Not Scam Valkyr, 21:00 CET.</p></div>
      </div>
      <aside class="stack">
        <div class="panel"><p class="kicker">Inscriptions</p><p style="margin:6px 0 var(--s3)">Ouvertes jusqu’au <b>20 décembre</b>. Club et équipe d’abord, puis 5 joueurs et 2 remplaçants maximum, chacun avec son compte Riot.</p><a class="btn btn-league" href="#register">Inscrire une équipe</a></div>
        <div class="panel"><p class="kicker">Discord de la LFV</p><p style="margin:6px 0 var(--s3)"><b>${D.int(c.discordMembers)}</b> membres.</p><a class="btn btn-league" href="${c.discordInvite}">${icon('discord', 18)} ${t('joinDiscord')} ${icon('external', 14)}</a></div>
      </aside>
    </div>`;
  }
  return page({ title: `${c.short} ${s.name}`, comp: slug, band: true, tab: 'hub', seasonSlug: s.slug, crumbs, body });
}

export { statusPill, sidesLine, teamRoute, raw };
