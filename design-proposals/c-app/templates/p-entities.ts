// Club, team and player pages, all on the same header band and tab bar.

import * as D from '../../_data/index.ts';
import { flag, href, html, icon, natName, raw, rel, teamBadge, teamRoute, textOn, type Raw } from '../../_build/lib.ts';
import { t } from '../../_build/i18n.ts';
import { doc, entityHead, tabs } from './layout.ts';
import { empty, facts, formDots, matchList, pctBar, pill, playerLink, sectionHead, sideLabel, sourceBadge, standingsTable, teamName } from './ui.ts';

const divName = (d: string) => (d === 'ligue-1' ? 'Ligue 1' : d === 'ligue-2' ? 'Ligue 2' : 'Division 1');
const ord = (n: number) => `${n}${n === 1 ? 'er' : 'e'}`;
const rate = (w: number, n: number, min = 10) =>
  n < min ? html`<span class="muted" title="Moins de ${min} rounds : pourcentage masqué">–</span>` : D.pct(w / n);

// ---------------------------------------------------------------------------------------------
// Club.

export function clubPage(slug: string): string {
  const c = D.clubBySlug.get(slug) as D.Club;
  const rosters = D.teams.filter((x) => x.club === slug);
  const byTitle = new Map<string, D.Team[]>();
  for (const r of rosters) {
    const comp = D.competition(r.competition);
    byTitle.set(comp.titleLabel, [...(byTitle.get(comp.titleLabel) ?? []), r]);
  }
  const primary = c.colors[0] as string;
  const socials = Object.entries(c.socials) as [string, string][];
  const NET: Record<string, string> = { x: 'X', twitch: 'Twitch', youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok' };
  const body = html`<div style="--league-primary:${primary};--league-on-primary:${textOn(primary)}">${entityHead({
    crumbs: [
      ['MBL Group', '/o/mbl-group'],
      ['Clubs', null],
      [c.name, null],
    ],
    title: c.name,
    sub: html`Club · ${c.city ?? 'ville non renseignée'} · ${rosters.length} équipe${rosters.length > 1 ? 's' : ''}`,
    visual: teamBadge(rosters[0] as D.Team, { size: 56 }),
    side: c.discordUrl ? html`<a class="btn btn-on" href="${c.discordUrl}">${icon('discord', 18)} Discord du club</a>` : undefined,
  })}</div>
  ${tabs([
    { label: t('overview'), route: `/clubs/${slug}`, current: true },
    { label: 'Équipes', route: `/clubs/${slug}#equipes`, count: rosters.length },
    { label: 'Palmarès', route: `/clubs/${slug}#palmares` },
  ])}
  <div class="page split">
    <div class="col-main">
      <section id="equipes">
        ${[...byTitle.entries()].map(
          ([title, list]) => html`${sectionHead(title)}
          <ul class="list">${list.map((r) => {
            const comp = D.competition(r.competition);
            const row = r.competition === 'lfr' ? D.standings(r.division).find((x) => x.team.slug === r.slug) : null;
            const rl = r.competition === 'lfrl' ? D.rlStandings().find((x) => x.team.slug === r.slug) : null;
            const ownColours = r.colors[0] !== primary;
            return html`<li class="roster-li">${teamName(r, { size: 32, strong: true })}
              <span class="roster-meta">${comp.short} · ${divName(r.division)}${row ? html` · ${row.excluded ? t('excluded') : ord(row.rank)} · ${row.points} pts` : ''}${rl ? html` · ${ord(rl.rank)} · ${rl.points} pts` : ''}${r.competition === 'lfv' ? ' · inscrite pour la Saison 2' : ''}${ownColours ? ' · couleurs propres' : ''}</span>
              ${row ? formDots(row.form) : rl ? formDots(rl.form) : ''}</li>`;
          })}</ul>`,
        )}
        ${slug === 'greed' ? html`<p class="callout">${icon('alert', 16)} Greed a deux équipes en Ligue 1. Quand elles se rencontrent, les responsables du club n’agissent pour aucune des deux : chaque équipe passe par ses propres responsables et son capitaine.</p>` : ''}
      </section>
      <section id="palmares">
        ${sectionHead('Palmarès')}
        ${c.honours.length ? html`<ul class="list">${c.honours.map((h) => html`<li class="hon"><strong>${h.label}</strong><span class="muted sm">${h.season} · ${D.team(h.team).name}</span></li>`)}</ul>` : empty('Pas encore de titre', 'Les titres viennent des saisons terminées sur la plateforme.')}
      </section>
    </div>
    <aside class="col-side">
      <section>${sectionHead('Fiche du club')}
        ${facts([
          ['Ville', c.city ?? '–'],
          ['Statut', c.legalStatus],
          ['Fondé en', c.founded ? String(c.founded) : '–'],
          ['Couleurs', html`${c.colors.map((col) => html`<span class="swatch" style="background:${col}" title="${col}"></span>`)}`],
          ['Réseaux', socials.length ? html`${socials.map(([k, v]) => html`<a href="#${k}">${NET[k]} @${v}</a>`)}` : '–'],
          ['Discord', c.discordUrl ? html`<a href="${c.discordUrl}">${c.discordUrl.replace('https://', '')} ${icon('external', 12)}</a>` : '–'],
        ])}
      </section>
      <section>${sectionHead('Responsables du club')}
        <ul class="list">${c.officials.map((o) => html`<li class="li-team">${playerLink(o.player)}<span class="muted sm">${o.role === 'owner' ? 'Propriétaire' : 'Manager du club'}</span></li>`)}</ul>
        <p class="sm muted">Ils agissent pour toutes les équipes du club. Chaque équipe a aussi ses managers et son coach.</p>
      </section>
    </aside>
  </div>`;
  return doc({ title: c.name, body, nav: 'leagues' });
}

// ---------------------------------------------------------------------------------------------
// Team (roster): header, tabs, and the three built tabs.

function teamHead(team: D.Team): Raw {
  const row = D.standings(team.division).find((r) => r.team.slug === team.slug) as D.StandingRow;
  const club = D.clubBySlug.get(team.club) as D.Club;
  return entityHead({
    crumbs: [
      ['LFR', '/c/lfr/s3'],
      [divName(team.division), `/c/lfr/s3/standings/${team.division}`],
      [team.name, null],
    ],
    title: team.name,
    sub: html`${team.tag} · club <a href="${href(`/clubs/${club.slug}`)}">${club.name}</a> · ${divName(team.division)} · <strong>${ord(row.rank)}</strong> · ${row.wins}–${row.losses} · ${row.points} pts`,
    visual: teamBadge(team, { size: 64 }),
    side: html`<div class="team-side"><span class="form-on">${formDots(row.form)}</span>
      <details class="season-sw"><summary>${t('season')} 3 ${icon('chevronDown', 14)}</summary><ul><li><a aria-current="true" href="${href(teamRoute(team))}">Saison 3 · Ligue 1</a></li><li><a href="#s2">Saison 2 · Ligue 1</a></li><li><a href="#s1">Saison 1 · Ligue 2</a></li></ul></details></div>`,
  });
}

function teamTabs(team: D.Team, current: string): Raw {
  return tabs([
    { label: t('overview'), route: teamRoute(team), current: current === 'overview' },
    { label: t('matches'), route: `/c/lfr/s3/calendar?team=${team.slug}` },
    { label: t('standings'), route: `/c/lfr/s3/standings/${team.division}` },
    { label: t('stats'), route: `${teamRoute(team)}#stats` },
    { label: t('roster'), route: `${teamRoute(team)}#effectif` },
    { label: 'Tendances', route: `${teamRoute(team)}/tendances`, current: current === 'tendances' },
    { label: 'Palmarès', route: `${teamRoute(team)}/palmares`, current: current === 'palmares' },
  ]);
}

function rosterBlock(team: D.Team): Raw {
  const entries = D.rosters.get(team.slug) ?? [];
  const club = D.clubBySlug.get(team.club) as D.Club;
  return html`<section id="effectif">${sectionHead(t('roster'))}
    <ul class="list">${entries.map((e) => {
      const p = D.player(e.player);
      return html`<li class="ros"><span class="ros-p">${playerLink(e.player)}${e.captain ? html`<abbr class="cap" title="Capitaine">C</abbr>` : ''}</span><span class="ros-r">${e.role === 'sub' ? 'Remplaçant' : e.position}</span><span class="muted sm ros-n">${natName(p.nat)}</span></li>`;
    })}</ul>
    <h3 class="sub-h">Staff</h3>
    <ul class="list">
      ${club.officials.map((o) => html`<li class="ros"><span class="ros-p">${playerLink(o.player, { flag: false })}</span><span class="ros-r">${o.role === 'owner' ? 'Propriétaire (club)' : 'Manager (club)'}</span></li>`)}
      ${team.staff.map((s) => html`<li class="ros"><span class="ros-p">${playerLink(s.player, { flag: false })}</span><span class="ros-r">${s.role === 'coach' ? 'Coach' : 'Manager'}</span></li>`)}
    </ul>
  </section>`;
}

export function teamPage(tab: 'overview' | 'tendances' | 'palmares'): string {
  const team = D.team(D.featured.team);
  const content = tab === 'overview' ? teamOverview(team) : tab === 'tendances' ? teamTendances(team) : teamPalmares(team);
  const body = html`${teamHead(team)}${teamTabs(team, tab)}${content}`;
  return doc({ title: `${team.name}${tab === 'overview' ? '' : tab === 'tendances' ? ' · Tendances' : ' · Palmarès'}`, comp: 'lfr', body, nav: 'leagues' });
}

function teamOverview(team: D.Team): Raw {
  const ms = D.matches.filter((m) => m.a.slug === team.slug || m.b.slug === team.slug).sort((x, y) => x.week - y.week);
  const next = ms.find((m) => m.status === 'scheduled' || m.status === 'proposed' || m.status === 'to_schedule');
  const s = D.teamSeason(team.slug);
  const rows = D.standings(team.division);
  const idx = rows.findIndex((r) => r.team.slug === team.slug);
  return html`<div class="page split">
    <div class="col-main">
      ${next ? html`<section>${sectionHead('Prochain match')}${matchList([next], { highlight: team.slug })}</section>` : ''}
      <section>${sectionHead('Matchs de la saison', ['Calendrier', `/c/lfr/s3/calendar?team=${team.slug}`])}${matchList(ms, { showDate: true, highlight: team.slug })}</section>
      <section id="stats">
        ${sectionHead("Stats d'équipe")}
        <div class="tiles">
          <div class="tile"><span class="tile-v">${s.record.wins}–${s.record.losses}</span><span class="tile-k">Cartes jouées (V–D)</span></div>
          <div class="tile"><span class="tile-v">${rate(s.attack.won, s.attack.rounds)}</span><span class="tile-k">Rounds gagnés en attaque · ${s.attack.rounds} r.</span></div>
          <div class="tile"><span class="tile-v">${rate(s.defence.won, s.defence.rounds)}</span><span class="tile-k">Rounds gagnés en défense · ${s.defence.rounds} r.</span></div>
        </div>
        <p class="sm muted">Couverture : ${s.replayCoverage.replay}/${s.replayCoverage.maps} cartes avec replay. Les forfaits ne comptent pas comme cartes jouées.</p>
        <h3 class="sub-h">Cartes</h3>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th scope="col">Carte</th><th scope="col" class="num">Jouées</th><th scope="col" class="num">V–D</th><th scope="col" class="num">% V</th><th scope="col" class="num hide-s">Manches</th></tr></thead>
          <tbody>${s.maps.map((m) => html`<tr><th scope="row">${m.map}</th><td class="num">${m.played}</td><td class="num">${m.wins}–${m.played - m.wins}</td><td class="num">${D.pct(m.wins / m.played)}</td><td class="num hide-s">${m.roundsWon}–${m.roundsLost}</td></tr>`)}</tbody>
        </table></div>
        <h3 class="sub-h">Meilleurs joueurs</h3>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th scope="col">Joueur</th><th scope="col" class="num">Cartes</th><th scope="col" class="num">K/D</th><th scope="col" class="num">KPR</th><th scope="col" class="num">KOST</th></tr></thead>
          <tbody>${s.topPlayers.map((p) => {
            const d = D.derived(p.totals);
            return html`<tr><th scope="row">${playerLink(p.player)}</th><td class="num">${p.totals.maps}</td><td class="num">${D.ratio(d.kd)}</td><td class="num">${D.ratio(d.kpr)}</td><td class="num">${D.pct(d.kost)}</td></tr>`;
          })}</tbody>
        </table></div>
        <p class="sm muted">Pyrø n’apparaît pas : il n’a pas donné son accord pour publier ses statistiques.</p>
      </section>
    </div>
    <aside class="col-side">
      ${rosterBlock(team)}
      <section>${sectionHead(divName(team.division), [t('standings'), `/c/lfr/s3/standings/${team.division}`])}
        ${standingsTable(rows.slice(Math.max(0, idx - 2), idx + 3), { compact: true, highlight: [team.slug] })}
      </section>
    </aside>
  </div>`;
}

function teamTendances(team: D.Team): Raw {
  const td = D.tendencies(team.slug);
  return html`<div class="page split">
    <div class="col-main">
      <p class="callout">${icon('alert', 16)} Matchs officiels validés seulement, jamais d’entraînement. Couverture : ${td.coverage.replay}/${td.coverage.maps} cartes avec replay ; un seul envoi couvre les deux équipes.</p>
      <section>${sectionHead('Historique des veto')}
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th scope="col">Sem.</th><th scope="col">Adversaire</th><th scope="col">Bans de ${team.tag}, dans l’ordre</th><th scope="col">Jouée</th><th scope="col" class="num">Rés.</th></tr></thead>
          <tbody>${td.vetoes.map((v) => html`<tr><td class="num">S${v.match.week}</td><td>${teamBadge(v.opponent, { size: 16 })} ${v.opponent.tag}</td><td class="sm">${v.bans.join(' · ')}</td><td>${v.played}</td><td class="num">${v.won ? html`<span class="pos">V</span>` : html`<span class="neg">D</span>`}</td></tr>`)}</tbody>
        </table></div>
        <p class="sm">Bannie le plus souvent : ${td.banCounts.slice(0, 3).map(([mp, n]) => `${mp} (${n})`).join(', ')}. Jamais bannie : ${td.neverBanned.join(', ') || 'aucune'}.</p>
      </section>
      <section>${sectionHead('Par carte')}
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th scope="col">Carte</th><th scope="col" class="num">V–D</th><th scope="col" class="num">Attaque</th><th scope="col" class="num">Défense</th></tr></thead>
          <tbody>${td.perMap.map((p) => html`<tr><th scope="row">${p.map}</th><td class="num">${p.wins}–${p.played - p.wins}</td><td class="num">${rate(p.atkW, p.atkR)} <span class="muted sm">${p.atkR} r.</span></td><td class="num">${rate(p.defW, p.defR)} <span class="muted sm">${p.defR} r.</span></td></tr>`)}</tbody>
        </table></div>
        <p class="sm muted">Un pourcentage est masqué sous 10 rounds.</p>
      </section>
    </div>
    <aside class="col-side">
      <section>${sectionHead('Sites défendus')}
        <ul class="list">${td.sites.map((st) => html`<li class="kv"><span>${st.site} <span class="muted sm">${st.map}</span></span><span class="num">${st.picked} r. · ${rate(st.won, st.picked, 5)}</span></li>`)}</ul>
      </section>
      <section>${sectionHead('Opérateurs')}
        <ul class="list">${td.operators.slice(0, 10).map((o) => html`<li class="kv"><span>${o.operator} <span class="muted sm">${o.map} · ${sideLabel(o.side).toLowerCase()}</span></span><span class="num">${o.picks}</span></li>`)}</ul>
      </section>
    </aside>
  </div>`;
}

function teamPalmares(team: D.Team): Raw {
  const ext = D.externalResults[team.slug] ?? [];
  const plat = D.platformResults[team.slug] ?? [];
  const rosterTags = (slugs: string[]) => slugs.map((s) => D.players.get(s)?.tag ?? s).join(', ');
  return html`<div class="page">
    <section>${sectionHead('Sur la plateforme')}
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th scope="col">Saison</th><th scope="col">Compétition</th><th scope="col">Classement</th><th scope="col" class="num">Bilan</th></tr></thead>
        <tbody>${plat.map((p) => html`<tr><td>${p.season}</td><td>${p.competition} · ${p.stage}</td><td><strong>${p.placement}</strong></td><td class="num">${p.record}</td></tr>`)}</tbody>
      </table></div>
      <p class="sm muted">Calculé à partir des saisons et des tableaux terminés, jamais saisi à la main.</p>
    </section>
    <section>${sectionHead('Hors de la ligue')}
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th scope="col">Date</th><th scope="col">Tier</th><th scope="col">Résultat</th><th scope="col">Événement</th><th scope="col" class="hide-s">Joueurs</th><th scope="col" class="num hide-s">Gain</th></tr></thead>
        <tbody>${ext.map((e) => html`<tr><td class="num-l">${D.dateYear(e.date)}</td><td>${pill('muted', `Tier ${e.tier}`)}</td><td><strong>${e.placement}</strong> <span class="muted sm">/ ${e.teams}</span></td><td>${e.event}<div class="muted sm">${e.organiser} · <a href="#proof">résultats ${icon('external', 11)}</a></div></td><td class="hide-s sm">${rosterTags(e.roster)}</td><td class="num hide-s">${e.prize ?? '–'}</td></tr>`)}</tbody>
      </table></div>
      <p class="sm muted">Déclarés par les managers, approuvés par le staff, qui fixe le tier. Montrés ici, ils ne comptent jamais pour les points, les têtes de série ou la montée.</p>
    </section>
  </div>`;
}

// ---------------------------------------------------------------------------------------------
// Player.

const STAT_KEYS: D.MetricDef['key'][] = ['kd', 'kpr', 'hs', 'kost', 'srv', 'entry', 'clutch'];

function fmtMetric(def: D.MetricDef, v: number | null): string {
  if (v === null) return '–';
  return def.format === 'ratio' ? D.ratio(v) : def.format === 'percent' ? D.pct(v) : def.format === 'signed' ? D.signed(v) : D.int(v);
}

export function playerPage(slug: string): string {
  const p = D.player(slug);
  const team = D.teamOf(slug) as D.Team;
  const entry = (D.rosters.get(team.slug) ?? []).find((e) => e.player === slug) as D.RosterEntry;
  const head = entityHead({
    crumbs: [
      ['LFR', '/c/lfr/s3'],
      [team.name, teamRoute(team)],
      [p.tag, null],
    ],
    title: html`${p.tag}`,
    sub: html`${flag(p.nat, 12)} ${natName(p.nat)} · <a href="${href(teamRoute(team))}">${team.name}</a> · ${entry.role === 'sub' ? 'Remplaçant' : entry.position}${entry.captain ? ' · capitaine' : ''} · rang ${p.rank}`,
    visual: html`<span class="pl-mark" aria-hidden="true">${p.tag.slice(0, 2).toUpperCase()}</span>`,
    side: teamName(team, { size: 28 }),
  });
  const ptabs = tabs([
    { label: t('overview'), route: `/players/${slug}`, current: true },
    { label: t('matches'), route: `/players/${slug}#journal` },
    { label: t('stats'), route: `/players/${slug}#stats` },
    { label: 'Carrière', route: `/players/${slug}#carriere` },
  ]);
  const log = D.gameLog(slug);
  if (!p.consent) {
    const ms = D.matches.filter((m) => (m.a.slug === team.slug || m.b.slug === team.slug) && (m.status === 'validated' || m.status === 'forfeit')).sort((x, y) => y.week - x.week);
    const body = html`${head}${ptabs}<div class="page split">
      <div class="col-main">
        ${empty('Statistiques non publiées', html`${p.tag} n’a pas donné son accord pour publier ses statistiques. Il apparaît dans les effectifs et les résultats, jamais dans les classements de stats ni sur les pages de stats.`)}
        <section id="journal">${sectionHead('Matchs de son équipe')}${matchList(ms, { showDate: true, highlight: team.slug })}</section>
      </div>
      <aside class="col-side"><section id="carriere">${sectionHead('Carrière')}
        <ul class="list"><li class="car"><span class="muted sm">LFR · Saison 3</span>${teamName(team, { size: 18 })}<span class="sm">${divName(team.division)} · en cours</span></li><li class="car"><span class="muted sm">LFR · Saison 2</span>${teamName(team, { size: 18 })}<span class="sm">Ligue 1 · 3e · finaliste de la Coupe</span></li></ul>
      </section></aside>
    </div>`;
    return doc({ title: p.tag, comp: 'lfr', body, nav: 'stats' });
  }
  const tot = D.totalsFor(slug, (m) => m.division === team.division);
  const sp = D.splits(slug);
  const career = D.careers[slug] ?? [];
  const body = html`${head}${ptabs}<div class="page split">
    <div class="col-main">
      <section id="stats">${sectionHead(`${t('season')} 3 · ${divName(team.division)}`)}
        <p class="sm muted">${tot.maps} cartes · ${tot.rounds} rounds · KOST, survie, entry et clutchs : ${tot.replayMaps}/${tot.maps} cartes avec replay. Percentiles parmi les joueurs de ${divName(team.division)} avec au moins 30 % des rounds de leur équipe.</p>
        <table class="tbl pct-t">
          <caption class="sr">Statistiques de la saison et percentiles</caption>
          <thead><tr><th scope="col">Stat</th><th scope="col" class="num">Valeur</th><th scope="col">Percentile</th></tr></thead>
          <tbody>${STAT_KEYS.map((k) => {
            const def = D.METRICS.find((x) => x.key === k) as D.MetricDef;
            const v = D.metricValue(tot, k);
            const pc = D.percentile(team.division, k, v);
            return html`<tr><th scope="row">${def.label}${def.replayOnly ? html` <span class="muted sm">(replay)</span>` : ''}</th><td class="num"><strong>${fmtMetric(def, v)}</strong></td><td class="pct-c">${pctBar(pc)}<span class="num sm">${pc ?? '–'}</span></td></tr>`;
          })}</tbody>
        </table>
        <p class="sm muted">Totaux : ${tot.kills} kills, ${tot.deaths} morts, ${tot.assists} assistances, ${tot.openingKills} ouvertures gagnées, ${tot.clutchWins}/${tot.clutchAttempts} clutchs.</p>
      </section>
      <section>${sectionHead('Par carte')}
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Carte</th><th scope="col" class="num">Rounds</th><th scope="col" class="num">K/D</th><th scope="col" class="num">KPR</th><th scope="col" class="num">KOST</th></tr></thead>
        <tbody>${sp.maps.map((m) => {
          const d = D.derived(m.totals);
          return html`<tr><th scope="row">${m.map}</th><td class="num">${m.totals.rounds}</td><td class="num">${D.ratio(d.kd)}</td><td class="num">${D.ratio(d.kpr)}</td><td class="num">${D.pct(d.kost)}</td></tr>`;
        })}</tbody></table></div>
      </section>
      <section>${sectionHead('Par côté')}
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Côté</th><th scope="col" class="num">Rounds</th><th scope="col" class="num">K/D</th><th scope="col" class="num">KOST</th><th scope="col" class="num">Ouvertures</th></tr></thead>
        <tbody>${(['atk', 'def'] as const).map((s) => {
          const x = sp.sides[s];
          const d = D.derived(x);
          return html`<tr><th scope="row">${sideLabel(s)}</th><td class="num">${x.rounds}</td><td class="num">${D.ratio(d.kd)}</td><td class="num">${D.pct(d.kost)}</td><td class="num">${x.openingKills}–${x.openingDeaths}</td></tr>`;
        })}</tbody></table></div>
      </section>
      <section id="journal">${sectionHead('Journal des matchs')}
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th scope="col">Date</th><th scope="col">Adversaire</th><th scope="col" class="hide-s">Carte</th><th scope="col" class="num">Score</th><th scope="col" class="num">K–D–A</th><th scope="col" class="num">KOST</th><th scope="col" class="hide-m">Source</th></tr></thead>
          <tbody>${log.map((g) => {
            const d = D.derived(g.totals);
            const none = g.source === 'none';
            return html`<tr><td class="num-l"><a href="${href(`/matches/${g.match.id}`)}">${D.dateShort(g.match.scheduledAt as number)}</a></td><td>${teamBadge(g.opponent, { size: 16 })} ${g.opponent.tag}</td><td class="hide-s">${g.map}</td><td class="num ${g.won ? 'pos' : 'neg'}">${g.won ? 'V' : 'D'} ${g.score[0]}–${g.score[1]}</td><td class="num">${none ? '–' : `${g.totals.kills}–${g.totals.deaths}–${g.totals.assists}`}</td><td class="num">${g.totals.replayRounds ? D.pct(d.kost) : '–'}</td><td class="hide-m">${sourceBadge(g.source)}</td></tr>`;
          })}</tbody>
        </table></div>
      </section>
    </div>
    <aside class="col-side">
      <section>${sectionHead('Opérateurs')}
        <ul class="list">${sp.operators.slice(0, 8).map((o) => html`<li class="kv"><span>${o.operator} <span class="muted sm">${sideLabel(o.side).toLowerCase()}</span></span><span class="num sm">${o.rounds} r. · ${o.kills}–${o.deaths} · ${D.pct(o.won / o.rounds)} V</span></li>`)}</ul>
      </section>
      <section id="carriere">${sectionHead('Carrière')}
        <ol class="list cv">${career.map((c) => html`<li class="car"><span class="muted sm">${c.competition} · ${c.season}</span>${teamName(D.team(c.team), { size: 18 })}<span class="sm">${c.division} · ${c.rank}${c.maps ? ` · ${c.maps} cartes · K/D ${c.kd}` : ''}</span>${c.awards.map((a) => html`<span class="award">${a}</span>`)}</li>`)}</ol>
        <h3 class="sub-h">Résultats hors ligue (avec ${team.name})</h3>
        <ul class="list">${(D.externalResults[team.slug] ?? []).filter((e) => e.roster.includes(slug)).map((e) => html`<li class="kv"><span>${e.event} <span class="muted sm">Tier ${e.tier}</span></span><span class="num sm">${e.placement} / ${e.teams}</span></li>`)}</ul>
      </section>
    </aside>
  </div>`;
  return doc({ title: p.tag, comp: 'lfr', body, nav: 'stats' });
}

export { raw, rel };
