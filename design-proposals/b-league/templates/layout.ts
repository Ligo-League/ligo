// The page frame: neutral header (group, competition switcher, language, Discord login), the
// league band and its sticky tabs on competition pages, breadcrumbs, the footer.

import * as D from '../../_data/index.ts';
import { html, icon, rel, href, raw, type Raw } from '../../_build/lib.ts';
import { t, htmlLang } from '../../_build/i18n.ts';

export type Viewer = (typeof D.viewers)[keyof typeof D.viewers];

export interface Frame {
  title: string;
  /** Competition whose theme the page wears; null for group pages (neutral chrome). */
  comp?: string | null;
  /** Active tab of the league band. */
  tab?: 'hub' | 'standings' | 'calendar' | 'cup' | 'stats' | 'awards' | 'rules' | 'recruitment' | null;
  /** Show the league band (competition pages). */
  band?: boolean;
  seasonSlug?: string;
  crumbs?: [string, string | null][];
  viewer?: Viewer;
  body: Raw;
  description?: string;
}

export function themeVars(slug: string | null | undefined): string {
  if (!slug) return '';
  const th = D.competition(slug).theme;
  const stripe = th.stripe ?? [th.secondary, th.secondary, th.secondary];
  return `--league-primary:${th.primary};--league-secondary:${th.secondary};--league-accent:${th.accent};--league-on-primary:${th.onPrimary};--stripe-1:${stripe[0]};--stripe-2:${stripe[1]};--stripe-3:${stripe[2]}`;
}

const COMP_ROUTES: Record<string, string> = { lfr: '/c/lfr/s3', lfrl: '/c/lfrl/s1', lfv: '/c/lfv/s2', frfl: '/c/frfl/s1/standings' };

function header(f: Frame): Raw {
  const v = f.viewer ?? null;
  const langs: [string, string][] = [['fr', 'FR'], ['en', 'EN'], ['de', 'DE'], ['nl', 'NL']];
  const langHref = (l: string) => (l === 'de' ? href('/c/lfr/s3/standings/ligue-1?lang=de') : l === 'nl' ? href('/c/lfr/s3/standings/ligue-1?lang=nl') : l === 'fr' ? href('/c/lfr/s3/standings/ligue-1') : '#lang-en');
  return html`<header class="site-head">
    <div class="wrap">
      <a class="brand" href="${href('/')}"><b>MBL Group</b><span>${t('competitions')}</span></a>
      <nav class="comp-switch" aria-label="${t('competitions')}">
        ${D.competitions.map(
          (c) => html`<a href="${href(COMP_ROUTES[c.slug] ?? '/')}" ${f.comp === c.slug ? raw('aria-current="page"') : ''}><i style="background:${c.theme.primary};box-shadow:inset 0 -3px 0 ${c.theme.secondary}"></i>${c.short}</a>`,
        )}
      </nav>
      <div class="head-tools">
        <nav class="lang" aria-label="${t('language')}">
          ${langs.map(([code, label]) => html`<a href="${langHref(code)}" hreflang="${code}" lang="${code}" ${htmlLang() === code ? raw('aria-current="true"') : ''}>${label}</a>`)}
        </nav>
        ${
          v
            ? html`<a class="user" href="#me"><span class="avatar" aria-hidden="true">${v.name.slice(0, 2).toUpperCase()}</span><span>${v.name}<small>${v.role}</small></span></a>`
            : html`<a class="btn btn-primary btn-login" href="#login">${icon('discord', 18)}<span>${t('login')}</span></a>`
        }
      </div>
    </div>
  </header>`;
}

function band(f: Frame): Raw {
  const c = D.competition(f.comp as string);
  const season = c.seasons.find((s) => s.slug === (f.seasonSlug ?? c.seasons[0]?.slug)) ?? c.seasons[0];
  const base = `/c/${c.slug}/${season?.slug}`;
  const isLfr = c.slug === 'lfr';
  const tabs: [NonNullable<Frame['tab']>, string, string][] = [
    ['hub', t('overview'), base],
    ['standings', t('standings'), isLfr ? `${base}/standings/ligue-1` : `${base}#classement`],
    ['calendar', t('calendar'), isLfr ? `${base}/calendar` : `${base}#calendrier`],
    ['cup', t('cup'), isLfr ? `${base}/bracket` : `${base}#coupe`],
    ['stats', t('stats'), isLfr ? `${base}/leaders` : `${base}#stats`],
    ['awards', t('awards'), isLfr ? `${base}/awards` : `${base}#recompenses`],
    ['rules', t('rules'), `/c/${c.slug}/rules`],
    ['recruitment', t('recruitment'), `/c/${c.slug}/recruitment`],
  ];
  const statusLabel = { registration: 'Inscriptions', active: `${t('week')} ${season?.currentWeek ?? ''}`, cup: 'Coupe', closed: 'Terminée' }[season?.status ?? 'active'];
  return html`<div class="band">
      <div class="wrap">
        <div class="mark" aria-hidden="true">${c.short}</div>
        <div class="title">
          <p class="kicker">${c.titleLabel}${c.platform ? ` · ${c.platform}` : ''}</p>
          <h1>${c.name} · ${season?.name}</h1>
          <p>${statusLabel}${season ? ` · ${D.dateShort(season.startsOn)} – ${D.dateYear(season.endsOn)}` : ''}</p>
        </div>
        <div class="actions"><a class="btn" href="${c.discordInvite}">${icon('discord', 18)} ${t('joinDiscord')} ${icon('external', 14)}</a></div>
      </div>
    </div>
    <nav class="tabs" aria-label="${c.short}"><div class="wrap">
      ${tabs.map(([key, label, route]) => html`<a href="${href(route)}" ${f.tab === key ? raw('aria-current="page"') : ''}>${label}</a>`)}
    </div></nav>`;
}

function crumbs(list: [string, string | null][]): Raw {
  return html`<nav class="crumbs wrap" aria-label="Fil d’Ariane">${list.map(
    ([label, route], i) => html`${i > 0 ? html`<span aria-hidden="true">/</span>` : ''}${route ? html`<a href="${href(route)}">${label}</a>` : html`<span aria-current="page">${label}</span>`}`,
  )}</nav>`;
}

function footer(): Raw {
  return html`<footer class="site-foot">
    <div class="stripe" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="wrap">
      <div>
        <p><b>MBL Group</b> · LFR, LFV, LFRL, FRFL · ${t('updated')} ${D.when(D.NOW)}</p>
        <p class="dim">Heures en Europe/Paris. Ligues communautaires, sans lien avec Ubisoft, Riot Games ou Psyonix.</p>
      </div>
      <nav aria-label="Pied de page"><a href="${href('/c/lfr/rules')}">${t('rules')}</a><a href="${href('/o/mbl-group')}">MBL Group</a><a href="#privacy">Confidentialité</a><a href="#contact">Contact</a></nav>
      <p class="ligo">${t('poweredBy').replace('Ligo', '')}<b>Ligo</b></p>
    </div>
  </footer>`;
}

export function page(f: Frame): Raw {
  return html`<!doctype html>
<html lang="${htmlLang()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${f.title} · ${f.comp ? D.competition(f.comp).short : 'MBL Group'}</title>
${f.description ? html`<meta name="description" content="${f.description}">` : ''}
<link rel="stylesheet" href="${rel('tokens.css')}">
<link rel="stylesheet" href="${rel('styles.css')}">
</head>
<body style="${themeVars(f.comp)}">
<a class="sr" href="#main">Aller au contenu</a>
${f.comp ? html`<div class="stripe" aria-hidden="true"><i></i><i></i><i></i></div>` : ''}
${header(f)}
${f.band && f.comp ? band(f) : ''}
<main id="main">
${f.crumbs ? crumbs(f.crumbs) : ''}
${f.body}
</main>
${footer()}
</body>
</html>`;
}
