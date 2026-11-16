// The frame of every page: charcoal top bar (group, competition switcher, language, Discord),
// an optional league strip in the league's colour with its tabs, breadcrumbs, three columns.

import * as D from '../../_data/index.ts';
import { html, raw, rel, href, icon, type Raw } from '../../_build/lib.ts';
import { t, htmlLang } from '../../_build/i18n.ts';
import { matchesOn } from '../../_build/shared.ts';
import { team, matchRow, miniStandings, panel, playerLink, pill, matchHref } from './parts.ts';

export type Viewer = { name: string; role: string; team?: string | null } | null;

export interface LeagueCtx {
  comp: string;
  season?: string;
  /** Active league tab key. */
  tab?: 'hub' | 'standings' | 'calendar' | 'cup' | 'stats' | 'awards' | 'rules' | 'recruitment';
}

export interface Layout {
  title: string;
  crumbs: [string, string | null][];
  main: Raw;
  league?: LeagueCtx;
  /** 'three' (sidebars both sides), 'right' (main + right column), 'wide' (main only). */
  cols?: 'three' | 'right' | 'wide';
  left?: Raw;
  right?: Raw;
  viewer?: Viewer;
  description?: string;
}

/** CSS variables a competition's theme_json sets; the only thing that changes between leagues. */
export function themeVars(comp: string): string {
  const th = D.competition(comp).theme;
  return `--league-primary:${th.primary};--league-secondary:${th.secondary};--league-accent:${th.accent};--league-on-primary:${th.onPrimary}`;
}

function topBar(viewer: Viewer, comp?: string): Raw {
  const comps = [
    { slug: 'lfr', route: '/c/lfr/s3' },
    { slug: 'lfv', route: '/c/lfv/s2' },
    { slug: 'lfrl', route: '/c/lfrl/s1' },
    { slug: 'frfl', route: '/c/frfl/s1/standings' },
  ];
  const lang = htmlLang();
  const langs: [string, string, string][] = [
    ['fr', 'FR', '/c/lfr/s3/standings/ligue-1'],
    ['en', 'EN', '#en'],
    ['de', 'DE', '/c/lfr/s3/standings/ligue-1?lang=de'],
    ['nl', 'NL', '/c/lfr/s3/standings/ligue-1?lang=nl'],
  ];
  return html`<header class="top">
    <div class="top-in">
      <a class="brand" href="${href('/')}">MBL&nbsp;Group</a>
      <nav class="comps" aria-label="${t('competitions')}"><ul>
        ${comps.map((c) => {
          const cc = D.competition(c.slug);
          return html`<li><a href="${href(c.route)}"${comp === c.slug ? raw(' aria-current="true"') : ''} title="${cc.name} · ${cc.titleLabel}"><span class="cdot" style="background:${cc.theme.primary}"></span>${cc.short}<span class="ct">${cc.titleLabel === 'Rainbow Six Siege' ? (cc.mode === 'mixed' ? 'R6 FACEIT' : 'R6') : cc.titleLabel === 'Rocket League' ? 'RL' : 'VAL'}</span></a></li>`;
        })}
        <li class="org"><a href="${href('/o/mbl-group')}">Organisation</a></li>
      </ul></nav>
      <div class="top-r">
        <nav class="langs" aria-label="${t('language')}">${langs.map(([k, l, r]) =>
          k === lang ? html`<span aria-current="true">${l}</span>` : html`<a href="${r.startsWith('#') ? r : href(r)}" lang="${k}">${l}</a>`,
        )}</nav>
        ${viewer
          ? html`<a class="me" href="#me"><span class="av" aria-hidden="true">${viewer.name.slice(0, 1)}</span><span class="me-n">${viewer.name}</span><span class="me-r">${viewer.role}</span></a>`
          : html`<a class="login" href="#auth-login">${icon('discord', 16)}<span>${t('login')}</span></a>`}
      </div>
    </div>
  </header>`;
}

function leagueStrip(ctx: LeagueCtx): Raw {
  const c = D.competition(ctx.comp);
  const s = ctx.season ? c.seasons.find((x) => x.slug === ctx.season) : c.seasons[0];
  const base = `/c/${c.slug}/${s?.slug ?? 's1'}`;
  const items: [LeagueCtx['tab'], string, string][] = [
    ['hub', t('overview'), base],
    ['standings', t('standings'), `${base}/standings/ligue-1`],
    ['calendar', t('calendar'), `${base}/calendar`],
    ['cup', t('cup'), `${base}/bracket`],
    ['stats', t('stats'), `${base}/leaders`],
    ['awards', t('awards'), `${base}/awards`],
    ['rules', t('rules'), `/c/${c.slug}/rules`],
    ['recruitment', t('recruitment'), `/c/${c.slug}/recruitment`],
  ];
  const statusLabel = { registration: 'Inscriptions', active: 'En cours', cup: 'Coupe', closed: 'Terminée' }[s?.status ?? 'active'];
  return html`<div class="lstrip">
    <div class="ls-in">
      <div class="ls-id"><span class="ls-short">${c.short}</span><span class="ls-name">${c.name}</span><span class="ls-s">${s?.name ?? ''} · ${statusLabel}${s?.currentWeek ? html` · ${t('week')} ${s.currentWeek}` : ''}</span></div>
      <a class="ls-dc" href="${c.discordInvite}" rel="noopener">${icon('discord', 14)}${t('joinDiscord')}${icon('external', 11)}</a>
    </div>
    <nav class="ls-tabs" aria-label="${c.short}"><ul>${items.map(
      ([k, label, route]) => html`<li><a href="${href(route)}"${ctx.tab === k ? raw(' aria-current="page"') : ''}>${label}</a></li>`,
    )}</ul></nav>
  </div>`;
}

/** Left sidebar: tonight across competitions, this week's LFR matches, the live veto. */
export function leftSidebar(): Raw {
  const tonight = matchesOn(D.NOW).filter((m) => m.scheduledAt && m.scheduledAt >= D.NOW - 3 * 3_600_000);
  const toPlay = D.featured.toPlay;
  const later = D.matches
    .filter((m) => m.scheduledAt && m.scheduledAt > D.NOW && !D.sameDay(m.scheduledAt, D.NOW) && (m.status === 'scheduled' || m.status === 'proposed'))
    .sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0))
    .slice(0, 6);
  const others = D.otherTonight.filter((o) => D.sameDay(o.at, D.NOW));
  return html`
  ${panel(
    'Ce soir · jeu. 26 nov.',
    html`<div class="live-veto">
        <div class="lv-h">${pill('live', 'Veto en cours', 'timer')}<span class="faint">LFR · L1 · 21:00</span></div>
        <a class="lv-m" href="${href(`/matches/${toPlay.id}/veto`)}">${team(toPlay.a, { size: 16, link: false, tagOnly: true })}<span class="vs">vs</span>${team(toPlay.b, { size: 16, link: false, tagOnly: true })}</a>
        <div class="lv-s faint">Étape 5/9 · ${toPlay.b.tag} bannit · 2:37</div>
      </div>
      <ul class="mlist">${tonight.filter((m) => m.id !== toPlay.id).map((m) => matchRow(m, { division: true }))}</ul>
      <ul class="olist">${others.map(
        (o) => html`<li><span class="mr-t">${D.time(o.at)}</span><span class="ol-l">${o.label}</span><span class="ol-m">${o.a && o.b ? html`${D.team(o.a).tag} vs ${D.team(o.b).tag} · BO${o.bestOf}` : (o as { note?: string }).note ?? ''}</span></li>`,
      )}</ul>`,
  )}
  ${panel('À venir', html`<ul class="mlist">${later.map((m) => matchRow(m, { date: true }))}</ul>`, { extra: html`<a href="${href('/c/lfr/s3/calendar')}">${t('calendar')}</a>` })}
  ${panel(
    'En attente',
    html`<ul class="wl">
      <li>${pill('pending', 'Déclaré')} <a href="${matchHref(D.featured.reported)}">${D.featured.reported.a.tag}–${D.featured.reported.b.tag}</a> <span class="faint">5–7 · attend ${D.featured.reported.a.tag}</span></li>
      <li>${pill('danger', 'Contesté', 'alert')} <a href="${matchHref(D.featured.disputed)}">${D.featured.disputed.a.tag}–${D.featured.disputed.b.tag}</a> <span class="faint">staff</span></li>
      <li>${pill('info', 'Proposé')} <a href="${matchHref(D.featured.proposed)}">${D.featured.proposed.a.tag}–${D.featured.proposed.b.tag}</a> <span class="faint">ven. 21:30 ?</span></li>
    </ul>`,
  )}`;
}

/** Right sidebar: both mini tables, latest results, mercato. */
export function rightSidebar(opts: { standings?: boolean } = {}): Raw {
  const latest = D.matches
    .filter((m) => (m.status === 'validated' || (m.status === 'forfeit' && m.forfeit?.reason === 'no_show')) && (m.validatedAt ?? 0) <= D.NOW)
    .sort((a, b) => (b.validatedAt ?? 0) - (a.validatedAt ?? 0))
    .slice(0, 7);
  return html`
  ${opts.standings === false
    ? ''
    : html`${panel('Ligue 1', miniStandings('ligue-1'), { extra: html`<a href="${href('/c/lfr/s3/standings/ligue-1')}">Complet</a>` })}
      ${panel('Ligue 2', miniStandings('ligue-2'), { extra: html`<a href="${href('/c/lfr/s3/standings/ligue-2')}">Complet</a>` })}`}
  ${panel('Derniers résultats', html`<ul class="mlist">${latest.map((m) => matchRow(m, { date: true }))}</ul>`)}
  ${panel(
    'Mercato',
    html`<ul class="merc">${D.mercatoMoves.slice(0, 4).map((mv) => {
      const slug = mv.player.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const from = mv.from ? D.team(mv.from) : null;
      const to = mv.to ? D.team(mv.to) : null;
      return html`<li><span class="faint">${D.dateShort(mv.at)}</span> ${playerLink(slug)} <span class="mvm">${from ? from.tag : 'libre'} ${icon('chevronRight', 10)} ${to ? to.tag : 'libre'}</span></li>`;
    })}</ul>`,
    { extra: html`<span class="faint">fenêtre close le 15 nov.</span>` },
  )}`;
}

export function page(l: Layout): string {
  const cols = l.cols ?? 'three';
  const theme = l.league ? themeVars(l.league.comp) : themeVars('lfr');
  return html`<!doctype html>
<html lang="${htmlLang()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${l.title} · MBL Group</title>
<meta name="description" content="${l.description ?? l.title}">
<link rel="stylesheet" href="${rel('tokens.css')}">
<link rel="stylesheet" href="${rel('styles.css')}">
</head>
<body style="${theme}">
<a class="skip" href="#main">Aller au contenu</a>
${topBar(l.viewer ?? null, l.league?.comp)}
${l.league ? leagueStrip(l.league) : ''}
<div class="wrap">
  <nav class="crumbs" aria-label="Fil d’Ariane"><ol>${l.crumbs.map(([label, route], i) =>
    route && i < l.crumbs.length - 1 ? html`<li><a href="${href(route)}">${label}</a></li>` : html`<li aria-current="page">${label}</li>`,
  )}</ol><span class="now">${icon('clock', 12)} ${D.when(D.NOW)}</span></nav>
  <div class="cols cols-${cols}">
    ${cols === 'three' ? html`<aside class="side-l" aria-label="Matchs">${l.left ?? leftSidebar()}</aside>` : ''}
    <main id="main" class="main">${l.main}</main>
    ${cols !== 'wide' ? html`<aside class="side-r" aria-label="Classements et résultats">${l.right ?? rightSidebar()}</aside>` : ''}
  </div>
</div>
<footer class="foot">
  <div class="foot-in">
    <div><strong>MBL Group</strong> · LFR · LFV · LFRL · FRFL · ligues communautaires francophones</div>
    <nav aria-label="Pied de page"><a href="${href('/c/lfr/rules')}">Règlement LFR</a><a href="${href('/o/mbl-group')}">Organisation</a><a href="#privacy">Données personnelles</a><a href="#contact">Contact</a></nav>
    <div class="ligo">Heures en Europe/Paris · <a href="#ligo">propulsé par Ligo</a></div>
  </div>
</footer>
</body>
</html>`.value;
}
