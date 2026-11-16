// The page frame: neutral chrome (header, footer, mobile bottom bar) around league-themed content.
// In production this is apps/server/src/web/layout.ts with Hono's `html` tag.

import * as D from '../../_data/index.ts';
import { html, href, icon, raw, rel, type Raw } from '../../_build/lib.ts';
import { currentLang, t } from '../../_build/i18n.ts';

export type Viewer = { name: string; role: string; team?: string | null } | null;

export interface DocOpts {
  title: string;
  /** The competition whose theme the content wears; null keeps the neutral defaults. */
  comp?: string | null;
  viewer?: Viewer;
  /** Which bottom-bar item is current. */
  nav?: 'home' | 'matches' | 'standings' | 'stats' | 'leagues' | null;
  body: Raw;
  /** Path of this page in the other languages (standings only in the mock). */
  langPaths?: Partial<Record<'fr' | 'de' | 'nl' | 'en', string>>;
  description?: string;
}

/** The four variables a competition's theme_json sets: the only thing that changes per league. */
export function themeVars(slug: string | null | undefined): string {
  if (!slug) return '';
  const th = D.competition(slug).theme;
  return `--league-primary:${th.primary};--league-secondary:${th.secondary};--league-accent:${th.accent};--league-on-primary:${th.onPrimary}`;
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function header(o: DocOpts): Raw {
  const comps = D.competitions;
  const active = o.comp ?? null;
  const v = o.viewer;
  const lang = currentLang();
  const langs: ['fr' | 'en' | 'de' | 'nl', string][] = [
    ['fr', 'Français'],
    ['en', 'English'],
    ['de', 'Deutsch'],
    ['nl', 'Nederlands'],
  ];
  return html`<header class="top">
    <div class="top-in">
      <a class="org" href="${href('/o/mbl-group')}"><span class="org-mark" aria-hidden="true">MBL</span><span class="org-name">MBL Group</span></a>
      <nav class="comps" aria-label="${t('competitions')}">
        ${comps.map(
          (c) => html`<a href="${href(c.slug === 'lfr' ? '/c/lfr/s3' : `/c/${c.slug}/${c.seasons[0]?.slug}`)}" ${c.slug === active ? raw('aria-current="true"') : ''} style="--chip:${c.theme.primary}"><span class="chip-dot" aria-hidden="true"></span>${c.short}</a>`,
        )}
      </nav>
      <div class="top-tools">
        <details class="lang">
          <summary aria-label="${t('language')}">${icon('globe', 16)}<span>${lang.toUpperCase()}</span></summary>
          <ul>
            ${langs.map(([code, name]) => html`<li><a href="${o.langPaths?.[code] ? rel(o.langPaths[code] as string) : '#lang-' + code}" lang="${code}" ${code === lang ? raw('aria-current="true"') : ''}>${name}</a></li>`)}
          </ul>
        </details>
        ${
          v
            ? html`<a class="me" href="#me" title="${v.role}"><span class="avatar" aria-hidden="true">${initials(v.name)}</span><span class="me-name">${v.name}</span></a>`
            : html`<a class="login" href="#auth-login">${icon('discord', 18)}<span class="login-long">${t('login')}</span><span class="login-short">Connexion</span></a>`
        }
      </div>
    </div>
  </header>`;
}

function bottomBar(o: DocOpts): Raw {
  const items: [NonNullable<DocOpts['nav']>, string, string][] = [
    ['home', t('home'), '/'],
    ['matches', t('matches'), '/c/lfr/s3/calendar'],
    ['standings', t('standings'), '/c/lfr/s3/standings/ligue-1'],
    ['stats', t('stats'), '/c/lfr/s3/leaders'],
    ['leagues', 'Ligues', '/o/mbl-group'],
  ];
  return html`<nav class="bottom" aria-label="Navigation principale">
    ${items.map(([k, label, route]) => html`<a href="${href(route)}" ${o.nav === k ? raw('aria-current="page"') : ''}>${label}</a>`)}
  </nav>`;
}

function footer(): Raw {
  return html`<footer class="foot">
    <div class="foot-in">
      <p><strong>MBL Group</strong> organise LFR, LFV, LFRL et FRFL. Les heures sont à l’heure de Paris.</p>
      <p class="foot-links"><a href="${href('/c/lfr/rules')}">${t('rules')}</a><a href="${href('/o/mbl-group')}">Discord des ligues</a><a href="#privacy">Données et consentement</a><a href="#status">État du service</a></p>
      <p class="ligo">${t('poweredBy')}</p>
    </div>
  </footer>`;
}

export function doc(o: DocOpts): string {
  return html`<!doctype html>
<html lang="${currentLang()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title} · MBL Group</title>
${o.description ? html`<meta name="description" content="${o.description}">` : ''}
<link rel="stylesheet" href="${rel('tokens.css')}">
<link rel="stylesheet" href="${rel('styles.css')}">
</head>
<body style="${themeVars(o.comp)}">
<a class="skip" href="#main">Aller au contenu</a>
${header(o)}
<main id="main">${o.body}</main>
${footer()}
</body>
</html>`.value;
}

// ---------------------------------------------------------------------------------------------
// Entity header band and the shared tab bar (competition, team, player, club).

export interface Tab {
  label: string;
  route: string;
  current?: boolean;
  /** Small count after the label. */
  count?: number | string;
}

export function tabs(list: Tab[], label = 'Sections'): Raw {
  // On a phone the bar keeps four tabs (the current one always among them); the rest go in
  // "Plus", so the bar never wraps or scrolls sideways.
  const cur = list.findIndex((tb) => tb.current);
  const keep = new Set([0, 1, 2, cur >= 3 ? cur : 3]);
  const extras = list.filter((_, i) => !keep.has(i));
  const link = (tb: Tab, cls = '') =>
    html`<a class="${cls}" href="${href(tb.route)}" ${tb.current ? raw('aria-current="page"') : ''}>${tb.label}${tb.count !== undefined ? html`<span class="tab-count">${tb.count}</span>` : ''}</a>`;
  return html`<nav class="tabs" aria-label="${label}"><div class="tabs-in">
    ${list.map((tb, i) => link(tb, keep.has(i) ? '' : 't-extra'))}
    ${extras.length ? html`<details class="tabs-more"><summary>Plus ${icon('chevronDown', 14)}</summary><ul>${extras.map((tb) => html`<li>${link(tb)}</li>`)}</ul></details>` : ''}
  </div></nav>`;
}

export interface EntityHead {
  crumbs: [string, string | null][];
  title: Raw | string;
  sub?: Raw | string;
  visual?: Raw;
  side?: Raw;
}

export function entityHead(e: EntityHead): Raw {
  return html`<section class="ent">
    <div class="ent-in">
      <nav class="crumbs" aria-label="Fil d’Ariane"><ol>${e.crumbs.map(([l, r]) => html`<li>${r ? html`<a href="${href(r)}">${l}</a>` : html`<span aria-current="page">${l}</span>`}</li>`)}</ol></nav>
      <div class="ent-main">
        ${e.visual ? html`<div class="ent-visual">${e.visual}</div>` : ''}
        <div class="ent-text"><h1>${e.title}</h1>${e.sub ? html`<p class="ent-sub">${e.sub}</p>` : ''}</div>
        ${e.side ? html`<div class="ent-side">${e.side}</div>` : ''}
      </div>
    </div>
  </section>`;
}

/** The competition tab bar: the same five tabs as every entity, then the league's own pages. */
export function compTabs(current: string, comp = 'lfr'): Raw {
  if (comp !== 'lfr') {
    const base = `/c/${comp}/${D.competition(comp).seasons[0]?.slug}`;
    return tabs([
      { label: t('overview'), route: base, current: current === 'overview' },
      { label: t('matches'), route: `${base}/calendar` },
      { label: t('standings'), route: `${base}/standings` },
      { label: t('stats'), route: `${base}/leaders` },
      { label: t('rules'), route: `/c/${comp}/rules` },
    ]);
  }
  return tabs([
    { label: t('overview'), route: '/c/lfr/s3', current: current === 'overview' },
    { label: t('matches'), route: '/c/lfr/s3/calendar', current: current === 'matches' },
    { label: t('standings'), route: '/c/lfr/s3/standings/ligue-1', current: current === 'standings' },
    { label: t('stats'), route: '/c/lfr/s3/leaders', current: current === 'stats' },
    { label: t('cup'), route: '/c/lfr/s3/bracket', current: current === 'cup' },
    { label: t('awards'), route: '/c/lfr/s3/awards', current: current === 'awards' },
    { label: t('rules'), route: '/c/lfr/rules', current: current === 'rules' },
    { label: t('recruitment'), route: '/c/lfr/recruitment', current: current === 'recruitment' },
  ]);
}

export function lfrHead(sub?: string): Raw {
  const c = D.competition('lfr');
  return entityHead({
    crumbs: [
      ['MBL Group', '/o/mbl-group'],
      ['LFR', '/c/lfr/s3'],
      ['Saison 3', null],
    ],
    title: html`${c.name}`,
    sub: sub ?? html`Rainbow Six Siege · Saison 3 · ${t('week')} 6 sur 9 · ${D.dateShort(D.weekRange(6).start)}–${D.dateShort(D.weekRange(6).end)}`,
    visual: html`<span class="comp-mark" aria-hidden="true">LFR</span>`,
    side: html`<a class="btn btn-on" href="${c.discordInvite}">${icon('discord', 18)} ${t('joinDiscord')}</a>`,
  });
}
