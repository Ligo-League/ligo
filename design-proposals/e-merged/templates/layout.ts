// Proposal E frame. Ligo is the platform: its top bar (games, search, matches, recruitment,
// language, login) is on every page, and its name and logo are always in the footer. A
// competition's pages add its own bar (organisation, competition, tabs) in its theme colour.
// Side columns are passed by each page and hold only what belongs to it (no global defaults).

import * as D from '../../_data/index.ts';
import { html, raw, rel, href, icon, type Raw } from '../../_build/lib.ts';
import { t, htmlLang } from '../../_build/i18n.ts';
import { matchesOn } from '../../_build/shared.ts';
import { team, matchRow, panel, pill, matchHref } from './parts.ts';
import { leftQuick, rightQuick } from './quick.ts';

export type Viewer = { name: string; role: string; team?: string | null; player?: string } | null;

export interface LeagueCtx {
  comp: string;
  season?: string;
  tab?: 'hub' | 'standings' | 'calendar' | 'cup' | 'stats' | 'awards' | 'rules' | 'recruitment';
}

export interface Layout {
  title: string;
  crumbs: [string, string | null][];
  main: Raw;
  league?: LeagueCtx;
  /** The game this page belongs to (highlights the switcher). */
  game?: 'r6' | 'valorant' | 'rocket_league';
  /** 'three' (both columns), 'right' (main + right), 'wide' (main only). */
  cols?: 'three' | 'right' | 'wide';
  left?: Raw;
  right?: Raw;
  viewer?: Viewer;
  description?: string;
}

export function themeVars(comp: string): string {
  const th = D.competition(comp).theme;
  return `--league-primary:${th.primary};--league-secondary:${th.secondary};--league-accent:${th.accent};--league-on-primary:${th.onPrimary}`;
}

/** Ligo's mark: a placeholder until the real logo exists. */
export const ligoMark = (size = 22): Raw =>
  raw(`<svg class="ligo-mark" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="4" fill="currentColor"/><path d="M7 5.5v13h10" fill="none" stroke="var(--ligo-mark-ink, #fff)" stroke-width="3" stroke-linecap="square"/></svg>`);

export const gameIcon = (g: D.GameInfo, size = 16): Raw =>
  html`<span class="gico" style="width:${size}px;height:${size}px;background:${g.color};font-size:${Math.round(size * 0.42)}px" aria-hidden="true">${g.short}</span>`;

/** Tonight across every competition on Ligo: the mobile "Ce soir" panel and the home column. */
export function tonightList(): Raw {
  const ours = matchesOn(D.NOW).filter((m) => m.scheduledAt && m.scheduledAt >= D.NOW - 3 * 3_600_000);
  return html`<ul class="mlist">${ours.map((m) => matchRow(m, { division: true }))}</ul>
  <ul class="olist">${D.otherMatchesToday.filter((o) => o.status === 'scheduled').map(
    (o) => html`<li><span class="mr-t">${D.time(o.at)}</span><span class="ol-l">${o.context}</span><span class="ol-m">${o.a.tag} vs ${o.b.tag}</span></li>`,
  )}
  ${D.otherTonight.filter((o) => D.sameDay(o.at, D.NOW)).map(
    (o) => html`<li><span class="mr-t">${D.time(o.at)}</span><span class="ol-l">${o.label}</span><span class="ol-m">${o.a && o.b ? html`${D.team(o.a).tag} vs ${D.team(o.b).tag} · BO${o.bestOf}` : (o as { note?: string }).note ?? ''}</span></li>`,
  )}</ul>`;
}

function topBar(l: Layout): Raw {
  const viewer = l.viewer ?? null;
  const lang = htmlLang();
  const langs: [string, string, string][] = [
    ['fr', 'FR', '/mbl-group/lfr/s3/standings/ligue-1'],
    ['en', 'EN', '#en'],
    ['de', 'DE', '#de'],
    ['nl', 'NL', '#nl'],
  ];
  const tonightCount = matchesOn(D.NOW).filter((m) => m.scheduledAt && m.scheduledAt >= D.NOW - 3 * 3_600_000).length + D.otherMatchesToday.filter((o) => o.status === 'scheduled').length;
  return html`<header class="top">
    <div class="top-in">
      <a class="brand" href="${href('/')}">${ligoMark(20)}<span>Ligo</span></a>
      <nav class="games" aria-label="Jeux"><ul>${D.games.map(
        (g) => html`<li><a href="${href(`/${g.key === 'rocket_league' ? 'rocket-league' : g.key}`)}"${l.game === g.key ? raw(' aria-current="true"') : ''}>${gameIcon(g, 16)}<span class="gn">${g.name}</span></a></li>`,
      )}</ul></nav>
      <form class="search" role="search" action="#search"><label class="vh" for="q">Rechercher</label>${icon('search', 14)}<input id="q" name="q" type="search" placeholder="Équipe, joueur, ligue…"></form>
      <nav class="topnav" aria-label="Ligo"><a href="${href('/matches')}">Matchs</a><a href="${href('/recruitment')}">Recrutement</a></nav>
      <div class="top-r">
        <details class="tonight"><summary>${icon('clock', 14)}<span>Ce soir</span><span class="cnt">${tonightCount}</span></summary><div class="tonight-p">${tonightList()}</div></details>
        <nav class="langs" aria-label="${t('language')}">${langs.map(([k, label, r]) =>
          k === lang ? html`<span aria-current="true">${label}</span>` : html`<a href="${r.startsWith('#') ? r : href(r)}" lang="${k}">${label}</a>`,
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
  const org = D.orgOf(c.slug);
  const s = ctx.season ? c.seasons.find((x) => x.slug === ctx.season) : c.seasons[0];
  const base = D.compRoute(c.slug, s?.slug ?? 's1');
  const items: [LeagueCtx['tab'], string, string][] = [
    ['hub', t('overview'), base],
    ['standings', t('standings'), `${base}/standings/ligue-1`],
    ['calendar', t('calendar'), `${base}/calendar`],
    ['cup', t('cup'), `${base}/bracket`],
    ['stats', t('stats'), `${base}/leaders`],
    ['awards', t('awards'), `${base}/awards`],
    ['rules', t('rules'), D.compRoute(c.slug, undefined, '/rules')],
  ];
  const statusLabel = { registration: 'Inscriptions', active: 'En cours', cup: 'Coupe', closed: 'Terminée' }[s?.status ?? 'active'];
  return html`<div class="lstrip">
    <div class="ls-in">
      <div class="ls-id"><a class="ls-short" href="${href(base)}">${c.short}</a><span class="ls-name">${c.name}</span><span class="ls-s">${s?.name ?? ''} · ${statusLabel}${s?.currentWeek ? html` · ${t('week')} ${s.currentWeek}` : ''}</span></div>
      <span class="ls-org">par <a href="${href(`/${org.slug}`)}">${org.name}</a></span>
      <a class="ls-dc" href="${c.discordInvite}" rel="noopener">${icon('discord', 14)}<span>${t('joinDiscord')}</span>${icon('external', 11)}</a>
    </div>
    <nav class="ls-tabs" aria-label="${c.short}"><ul>${items.map(
      ([k, label, route]) => html`<li><a href="${href(route)}"${ctx.tab === k ? raw(' aria-current="page"') : ''}>${label}</a></li>`,
    )}</ul></nav>
  </div>`;
}

/** The quick-access columns of the home, game home and competition hub. */
export function hubLeft(): Raw {
  const toPlay = D.featured.toPlay;
  return html`${panel(
    'Ce soir · jeu. 26 nov.',
    html`<div class="live-veto">
      <div class="lv-h">${pill('live', 'Veto en cours', 'timer')}<span class="faint">LFR · L1 · 21:00</span></div>
      <a class="lv-m" href="${href(`/matches/${toPlay.id}/veto`)}">${team(toPlay.a, { size: 16, link: false, tagOnly: true })}<span class="vs">vs</span>${team(toPlay.b, { size: 16, link: false, tagOnly: true })}</a>
      <div class="lv-s faint">Étape 5/9 · ${toPlay.b.tag} bannit · 2:37</div>
    </div>${tonightList()}`,
  )}`;
}

export function pendingPanel(): Raw {
  return panel(
    'En attente',
    html`<ul class="wl">
      <li>${pill('pending', 'Déclaré')} <a href="${matchHref(D.featured.reported)}">${D.featured.reported.a.tag}–${D.featured.reported.b.tag}</a> <span class="faint">5–7 · attend ${D.featured.reported.a.tag}</span></li>
      <li>${pill('danger', 'Contesté', 'alert')} <a href="${matchHref(D.featured.disputed)}">${D.featured.disputed.a.tag}–${D.featured.disputed.b.tag}</a> <span class="faint">staff</span></li>
      <li>${pill('info', 'Proposé')} <a href="${matchHref(D.featured.proposed)}">${D.featured.proposed.a.tag}–${D.featured.proposed.b.tag}</a> <span class="faint">ven. 21:30 ?</span></li>
    </ul>`,
  );
}

/** Crumbs always start at Ligo and name the organisation before a competition. */
function crumbsOf(list: [string, string | null][]): [string, string | null][] {
  const out = list.map(([l, r]) => [l === 'Accueil' ? 'Ligo' : l, r] as [string, string | null]);
  if (out[0]?.[0] !== 'Ligo') out.unshift(['Ligo', '/']);
  const compIdx = out.findIndex(([l]) => ['LFR', 'LFRL', 'LFV', 'FRFL'].includes(l));
  if (compIdx > 0 && out[compIdx - 1]?.[0] !== 'MBL Group') out.splice(compIdx, 0, ['MBL Group', '/mbl-group']);
  return out;
}

export function page(l: Layout): string {
  const cols = l.cols ?? 'wide';
  // Older templates (from A) leave the side columns to the frame: give them quick access.
  if (cols === 'three' && !l.left) l = { ...l, left: leftQuick() };
  if (cols !== 'wide' && !l.right) l = { ...l, right: rightQuick() };
  const theme = l.league ? themeVars(l.league.comp) : themeVars('lfr');
  const crumbs = crumbsOf(l.crumbs);
  const org = l.league ? D.orgOf(l.league.comp) : null;
  return html`<!doctype html>
<html lang="${htmlLang()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${l.title} · Ligo</title>
<meta name="description" content="${l.description ?? l.title}">
<link rel="stylesheet" href="${rel('tokens.css')}">
<link rel="stylesheet" href="${rel('styles.css')}">
</head>
<body style="${theme}">
<a class="skip" href="#main">Aller au contenu</a>
${topBar(l)}
${l.league ? leagueStrip(l.league) : ''}
<div class="wrap">
  <nav class="crumbs" aria-label="Fil d’Ariane"><ol>${crumbs.map(([label, route], i) =>
    route && i < crumbs.length - 1 ? html`<li><a href="${href(route)}">${label}</a></li>` : html`<li aria-current="page">${label}</li>`,
  )}</ol><span class="now">${icon('clock', 12)} ${D.when(D.NOW)}</span></nav>
  <div class="cols cols-${cols}">
    ${cols === 'three' ? html`<aside class="side-l" aria-label="Matchs">${l.left ?? ''}</aside>` : ''}
    <main id="main" class="main">${l.main}</main>
    ${cols !== 'wide' ? html`<aside class="side-r" aria-label="Classements et résultats">${l.right ?? ''}</aside>` : ''}
  </div>
</div>
<footer class="foot">
  <div class="foot-in">
    ${org ? html`<div class="foot-org">${org.name} · ${org.competitions.map((c) => D.competition(c).short).join(' · ')} · <a href="${href(`/${org.slug}`)}">page de l’organisation</a></div>` : ''}
    <div class="foot-ligo"><a class="brand-f" href="${href('/')}">${ligoMark(18)}<strong>Ligo</strong></a><span>La plateforme des ligues esport à divisions. Gratuite, sans but lucratif.</span></div>
    <nav aria-label="Pied de page"><a href="#privacy">Politique de confidentialité</a><a href="#terms">Conditions d’utilisation</a><a href="#report">Signaler un contenu</a><a href="#create">Créer une ligue</a><a href="#contact">Contact</a></nav>
    <div class="faint">Heures en Europe/Paris</div>
  </div>
</footer>
<script>/* Quick-access panels: open on desktop; folded on phones (CSS keeps them visible without JS). */if(matchMedia('(min-width: 901px)').matches)for(const d of document.querySelectorAll('details.qa'))d.open=true</script>
</body>
</html>`.value;
}

/** Right column of hubs and the org page: latest results and mercato (never on match pages). */
export function rightSidebar(_opts: { standings?: boolean } = {}): Raw {
  const latest = D.matches
    .filter((m) => (m.status === 'validated' || (m.status === 'forfeit' && m.forfeit?.reason === 'no_show')) && (m.validatedAt ?? 0) <= D.NOW)
    .sort((a, b) => (b.validatedAt ?? 0) - (a.validatedAt ?? 0))
    .slice(0, 7);
  return html`${panel('Derniers résultats', html`<ul class="mlist">${latest.map((m) => matchRow(m, { date: true }))}</ul>`)}
  ${panel(
    'Mercato',
    html`<ul class="merc">${D.mercatoMoves.slice(0, 4).map((mv) => {
      const from = mv.from ? D.team(mv.from) : null;
      const to = mv.to ? D.team(mv.to) : null;
      return html`<li><span class="faint">${D.dateShort(mv.at)}</span> ${mv.player} <span class="mvm">${from ? from.tag : 'libre'} ${icon('chevronRight', 10)} ${to ? to.tag : 'libre'}</span></li>`;
    })}</ul>`,
    { extra: html`<span class="faint">fenêtre close le 15 nov.</span>` },
  )}`;
}
export const leftSidebar = hubLeft;
