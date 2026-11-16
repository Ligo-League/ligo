// Clubs, teams (Aperçu, Tendances, Palmarès) and players, with a Liquipedia-style infobox.

import * as D from '../../_data/index.ts';
import { html, href, icon, raw, teamBadge, flag, natName, type Raw } from '../../_build/lib.ts';
import { scoreOf, divisionName } from '../../_build/shared.ts';
import { page, rightSidebar } from './layout.ts';
import { team, panel, pill, kv, mapThumb, playerLink, tabs, form, signedCell, status, matchHref, empty } from './parts.ts';

const ordinal = (n: number) => (n === 1 ? '1er' : `${n}e`);
const compName = (c: string) => D.competition(c).short;
const rowOf = (tm: D.Team) => (tm.competition === 'lfr' ? D.standings(tm.division).find((r) => r.team.slug === tm.slug) : undefined);
const socialsList = (s: D.Club['socials']) =>
  html`${Object.entries(s).map(([k, v]) => html`<a href="#${k}" style="margin-right:8px">${({ x: 'X', twitch: 'Twitch', youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok' } as Record<string, string>)[k]} <span class="faint">${v}</span></a>`)}`;
const colorSwatches = (cs: string[]) => html`<span class="colors">${cs.map((c) => html`<span style="background:${c}" title="${c}"></span>`)}</span> <span class="faint" style="font-family:var(--mono);font-size:11px">${cs.join(' ')}</span>`;

// ---------------------------------------------------------------------------------------------
// Club

function club(slug: string): string {
  const c = D.clubBySlug.get(slug) as D.Club;
  const rosters = D.teams.filter((x) => x.club === slug);
  const pseudo = { ...rosters[0], name: c.name, tag: rosters[0]?.tag ?? c.name.slice(0, 3).toUpperCase(), colors: [c.colors[0], c.colors[1]] } as D.Team;
  const main = html`
  <div class="head"><h1>${c.name}</h1><div class="sub">Club · ${c.city ?? ''} · ${rosters.length} équipes dans ${new Set(rosters.map((r) => r.competition)).size} compétitions</div></div>
  ${panel(
    'Équipes du club',
    html`<table class="data"><caption class="vh">Équipes</caption><thead><tr><th scope="col">Équipe</th><th scope="col">Jeu</th><th scope="col">Compétition</th><th scope="col" class="opt">Division</th><th scope="col" class="num">Rang</th><th scope="col" class="num opt">Bilan</th><th scope="col" class="opt2">Forme</th></tr></thead><tbody>
    ${rosters.map((r) => {
      const row = rowOf(r);
      const rl = r.competition === 'lfrl' ? D.rlStandings().find((x) => x.team.slug === r.slug) : undefined;
      return html`<tr><th scope="row">${team(r, { size: 18 })} <span class="faint">${r.tag}</span></th><td>${r.title === 'r6' ? 'Rainbow Six Siege' : r.title === 'rocket_league' ? 'Rocket League' : 'Valorant'}</td><td>${compName(r.competition)}</td><td class="opt">${divisionName(r.division)}</td>
        <td class="num">${row ? (row.excluded ? 'EX' : `${ordinal(row.rank)}${row.shared ? '=' : ''}`) : rl ? ordinal(rl.rank) : html`<span class="faint">inscrite</span>`}</td>
        <td class="num opt">${row ? `${row.wins}–${row.losses}` : rl ? `${rl.wins}–${rl.losses}` : '–'}</td><td class="opt2">${row ? form(row.form) : ''}</td></tr>`;
    })}</tbody></table>
    ${rosters.filter((r) => r.competition === 'lfr' && r.division === rosters[0]?.division).length > 1 ? html`<p class="note info">Deux équipes du club dans la même division : quand elles se rencontrent, les responsables du club n’agissent pour aucune des deux ; chaque équipe passe par ses propres responsables et son capitaine.</p>` : ''}`,
  )}
  ${panel(
    'Responsables',
    html`<table class="data dense"><caption class="vh">Responsables</caption><thead><tr><th scope="col">Nom</th><th scope="col">Rôle</th><th scope="col">Portée</th></tr></thead><tbody>
    ${c.officials.map((o) => html`<tr><td>${playerLink(o.player)}</td><td>${o.role === 'owner' ? 'Propriétaire' : 'Manager du club'}</td><td class="faint">toutes les équipes du club</td></tr>`)}
    ${rosters.flatMap((r) => r.staff.map((s) => html`<tr><td>${playerLink(s.player)}</td><td>${s.role === 'manager' ? 'Manager' : 'Coach'}</td><td>${team(r, { size: 14 })}</td></tr>`))}
    </tbody></table>`,
  )}
  ${panel(
    'Palmarès',
    c.honours.length
      ? html`<table class="data dense"><caption class="vh">Palmarès</caption><tbody>${c.honours.map((h) => html`<tr><td>${h.season}</td><td><b>${h.label}</b></td><td>${team(D.team(h.team), { size: 14 })}</td></tr>`)}</tbody></table>`
      : empty('Pas encore de titre', 'Les titres viennent des saisons closes et des coupes jouées sur la plateforme.'),
  )}`;
  const right = html`<section class="panel infobox">
    <div class="ib-title">${c.name}</div>
    <div class="ib-logo">${teamBadge(pseudo, { size: 96 })}</div>
    ${kv([
      ['Ville', c.city],
      ['Statut', c.legalStatus],
      ['Fondé', c.founded ? String(c.founded) : null],
      ['Couleurs', colorSwatches(c.colors)],
      ['Réseaux', Object.keys(c.socials).length ? socialsList(c.socials) : null],
      ['Discord', c.discordUrl ? html`<a href="${c.discordUrl}">${icon('discord', 12)} ${c.discordUrl.replace('https://', '')}</a>` : html`<span class="faint">non renseigné</span>`],
    ])}
  </section>${rightSidebar({ standings: false })}`;
  return page({ title: c.name, crumbs: [['Accueil', '/'], ['Clubs', null], [c.name, null]], main, cols: 'right', right });
}

// ---------------------------------------------------------------------------------------------
// Team

const TEAM = 'greed-esport';

function teamInfobox(tm: D.Team): Raw {
  const row = rowOf(tm);
  const c = D.clubBySlug.get(tm.club) as D.Club;
  const cap = (D.rosters.get(tm.slug) ?? []).find((e) => e.captain);
  return html`<section class="panel infobox">
    <div class="ib-title">${tm.name}</div>
    <div class="ib-logo">${teamBadge(tm, { size: 96 })}</div>
    ${kv([
      ['Tag', html`<b>${tm.tag}</b>`],
      ['Club', html`<a href="${href(`/clubs/${c.slug}`)}">${c.name}</a>`],
      ['Ville', c.city],
      ['Division', `LFR ${divisionName(tm.division)}`],
      ['Rang', row ? html`<b>${ordinal(row.rank)}</b> · ${row.points} pts` : null],
      ['Bilan', row ? `${row.wins} V – ${row.losses} D · Diff ${D.signed(row.diff)}` : null],
      ['Forme', row ? form(row.form) : null],
      ['Capitaine', cap ? playerLink(cap.player) : null],
      ['Couleurs', colorSwatches(tm.colors)],
      ['Stream', tm.canStream ? 'diffuse ses matchs' : 'non'],
      ['Réseaux', socialsList(c.socials)],
    ])}
  </section>`;
}

function teamHead(tm: D.Team, active: 'apercu' | 'tendances' | 'palmares'): Raw {
  return html`<div class="head" style="display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center">
    ${teamBadge(tm, { size: 40 })}<div style="flex:1;min-width:180px"><h1>${tm.name}</h1><div class="sub">${tm.tag} · LFR ${divisionName(tm.division)} · club <a href="${href(`/clubs/${tm.club}`)}">${D.clubBySlug.get(tm.club)?.name}</a></div></div>
    <label class="f">Saison<select><option selected>Saison 3 (en cours)</option><option>Saison 2</option><option>Saison 1</option></select></label>
  </div>
  ${tabs([
    { label: 'Aperçu', route: `/teams/${tm.slug}`, active: active === 'apercu' },
    { label: 'Tendances', route: `/teams/${tm.slug}/tendances`, active: active === 'tendances' },
    { label: 'Palmarès', route: `/teams/${tm.slug}/palmares`, active: active === 'palmares' },
    { label: 'Calendrier', route: `/c/lfr/s3/calendar?team=${tm.slug}` },
  ], 'boxed')}`;
}

const pctOf = (w: number, n: number) => (n ? D.pct(w / n) : '–');

function teamOverview(): string {
  const tm = D.team(TEAM);
  const roster = D.rosters.get(tm.slug) ?? [];
  const c = D.clubBySlug.get(tm.club) as D.Club;
  const ts = D.teamSeason(tm.slug);
  const ms = D.matches.filter((m) => m.a.slug === tm.slug || m.b.slug === tm.slug).sort((a, b) => a.week - b.week);
  const main = html`
  ${teamHead(tm, 'apercu')}
  ${panel(
    'Effectif · Saison 3',
    html`<table class="data"><caption class="vh">Effectif</caption><thead><tr><th scope="col">Joueur</th><th scope="col">Rôle</th><th scope="col" class="opt">Nationalité</th><th scope="col">Statut</th><th scope="col" class="opt">Rang R6</th></tr></thead><tbody>
    ${roster.map((e) => {
      const p = D.player(e.player);
      return html`<tr><th scope="row">${playerLink(e.player)}${e.captain ? html` <abbr class="pill pill-info" title="Capitaine">C</abbr>` : ''}</th><td>${e.position}</td><td class="opt">${natName(p.nat)}</td><td>${e.role === 'sub' ? html`<span class="faint">Remplaçant</span>` : 'Titulaire'}</td><td class="opt">${p.rank}</td></tr>`;
    })}</tbody></table>`,
    { extra: html`<span class="faint">mercato : fenêtre close le 15 nov.</span>` },
  )}
  ${panel(
    'Staff',
    html`<table class="data dense"><caption class="vh">Staff</caption><tbody>
    ${c.officials.map((o) => html`<tr><td>${playerLink(o.player)}</td><td>${o.role === 'owner' ? 'Propriétaire (club)' : 'Manager (club)'}</td></tr>`)}
    ${tm.staff.map((s) => html`<tr><td>${playerLink(s.player)}</td><td>${s.role === 'manager' ? 'Manager' : 'Coach'}</td></tr>`)}
    </tbody></table>`,
  )}
  ${panel(
    'Matchs de la saison',
    html`<table class="data tagm dense"><caption class="vh">Matchs</caption><thead><tr><th scope="col">Sem.</th><th scope="col" class="opt">Date</th><th scope="col">Adversaire</th><th scope="col" class="num">Score</th><th scope="col" class="opt">Carte</th><th scope="col">Statut</th></tr></thead><tbody>
    ${ms.map((m) => {
      const me = m.a.slug === tm.slug ? 'a' : 'b';
      const opp = me === 'a' ? m.b : m.a;
      const sc = scoreOf(m);
      const mine = sc ? (me === 'a' ? [sc.a, sc.b] : [sc.b, sc.a]) : null;
      const won = mine ? mine[0] > (mine[1] as number) : null;
      return html`<tr><td>S${m.week}</td><td class="opt faint">${m.scheduledAt ? D.day(m.scheduledAt) : '—'}</td><td>${team(opp, { size: 14 })}</td>
        <td class="num">${mine ? html`<a href="${matchHref(m)}" class="${won ? 'pos' : 'neg'}"><b>${won ? 'V' : 'D'}</b> ${mine[0]}–${mine[1]}${sc?.forfeit ? ' W.O.' : ''}</a>` : '–'}</td>
        <td class="opt">${m.map ?? ''}</td><td>${status(m)}</td></tr>`;
    })}</tbody></table>`,
  )}
  <div class="grid2">
    ${panel(
      'Cartes',
      html`<table class="data dense"><caption class="vh">Bilan par carte</caption><thead><tr><th scope="col">Carte</th><th scope="col" class="num">J</th><th scope="col" class="num">V–D</th><th scope="col" class="num">Win %</th><th scope="col" class="num opt">Manches</th></tr></thead><tbody>
      ${ts.maps.map((x) => html`<tr><th scope="row">${mapThumb(x.map, 26)} ${x.map}</th><td class="num">${x.played}</td><td class="num">${x.wins}–${x.played - x.wins}</td><td class="num">${pctOf(x.wins, x.played)}</td><td class="num opt">${x.roundsWon}–${x.roundsLost}</td></tr>`)}
      </tbody></table>`,
    )}
    ${panel(
      'Côtés et joueurs',
      html`${kv([
        ['Attaque', html`<b>${pctOf(ts.attack.won, ts.attack.rounds)}</b> <span class="faint">${ts.attack.won}/${ts.attack.rounds} manches</span>`],
        ['Défense', html`<b>${pctOf(ts.defence.won, ts.defence.rounds)}</b> <span class="faint">${ts.defence.won}/${ts.defence.rounds} manches</span>`],
        ['Couverture', `${ts.replayCoverage.replay}/${ts.replayCoverage.maps} cartes avec replays`],
      ])}
      <table class="data dense"><caption class="vh">Meilleurs joueurs</caption><thead><tr><th scope="col">Joueur</th><th scope="col" class="num">K/D</th><th scope="col" class="num">KPR</th><th scope="col" class="num">KOST</th></tr></thead><tbody>
      ${ts.topPlayers.map((x) => {
        const d = D.derived(x.totals);
        return html`<tr><td>${playerLink(x.player)}</td><td class="num">${D.ratio(d.kd)}</td><td class="num">${D.ratio(d.kpr)}</td><td class="num">${D.pct(d.kost)}</td></tr>`;
      })}</tbody></table>
      <p class="pad faint" style="font-size:11px;margin:0">Pyrø n’apparaît pas : pas de consentement aux stats publiques.</p>`,
    )}
  </div>`;
  return page({ title: tm.name, crumbs: [['Accueil', '/'], ['LFR', '/c/lfr/s3'], [divisionName(tm.division), `/c/lfr/s3/standings/${tm.division}`], [tm.name, null]], main, cols: 'right', right: html`${teamInfobox(tm)}${rightSidebar({ standings: false })}` });
}

function teamTendances(): string {
  const tm = D.team(TEAM);
  const td = D.tendencies(tm.slug);
  const main = html`
  ${teamHead(tm, 'tendances')}
  <p class="note info">Tendances tirées des matchs officiels validés uniquement (jamais des entraînements). Couverture : <b>${td.coverage.replay}/${td.coverage.maps} cartes avec replays</b>. Visible de tous (réglage <code>scouting: public</code>).</p>
  ${panel(
    'Historique des vetos',
    html`<table class="data tagm dense"><caption class="vh">Vetos</caption><thead><tr><th scope="col">Sem.</th><th scope="col">Adversaire</th><th scope="col">Bans de ${tm.tag}, dans l’ordre</th><th scope="col">Carte jouée</th><th scope="col">Résultat</th></tr></thead><tbody>
    ${td.vetoes.map((v) => html`<tr><td>S${v.match.week}</td><td>${team(v.opponent, { size: 14 })}</td><td class="wrapcell">${v.bans.map((b, i) => html`<span style="white-space:nowrap">${i + 1}. ${b}</span>${i < v.bans.length - 1 ? ' · ' : ''}`)}</td><td>${v.played}</td><td>${v.won ? html`<b class="pos">V</b>` : html`<b class="neg">D</b>`}</td></tr>`)}
    </tbody></table>`,
  )}
  <div class="grid2">
    ${panel(
      'Bans',
      html`<table class="data dense"><caption class="vh">Bans</caption><thead><tr><th scope="col">Carte</th><th scope="col" class="num">Bannie</th><th scope="col" class="num">1er ban</th></tr></thead><tbody>
      ${td.banCounts.map(([mp, n]) => html`<tr><th scope="row">${mapThumb(mp, 24)} ${mp}</th><td class="num">${n}×</td><td class="num">${td.firstBans.find((f) => f[0] === mp)?.[1] ?? 0}×</td></tr>`)}
      </tbody></table><p class="pad faint" style="font-size:11px;margin:0">Jamais bannies : ${td.neverBanned.join(', ')}.</p>`,
    )}
    ${panel(
      'Cartes jouées',
      html`<table class="data dense"><caption class="vh">Cartes</caption><thead><tr><th scope="col">Carte</th><th scope="col" class="num">V–D</th><th scope="col" class="num">Attaque</th><th scope="col" class="num">Défense</th></tr></thead><tbody>
      ${td.perMap.map((x) => html`<tr><th scope="row">${x.map}</th><td class="num">${x.wins}–${x.played - x.wins}</td><td class="num">${x.atkR ? `${pctOf(x.atkW, x.atkR)} (${x.atkR})` : '–'}</td><td class="num">${x.defR ? `${pctOf(x.defW, x.defR)} (${x.defR})` : '–'}</td></tr>`)}
      </tbody></table>`,
    )}
  </div>
  <div class="grid2">
    ${panel(
      'Sites défendus',
      html`<table class="data dense"><caption class="vh">Sites</caption><thead><tr><th scope="col">Carte</th><th scope="col">Site</th><th scope="col" class="num">Choisi</th><th scope="col" class="num">Gagnées</th></tr></thead><tbody>
      ${td.sites.map((s) => html`<tr><td>${s.map}</td><td>${s.site}</td><td class="num">${s.picked}×</td><td class="num">${s.picked >= 3 ? pctOf(s.won, s.picked) : html`<span class="faint" title="moins de 3 manches">${s.won}/${s.picked}</span>`}</td></tr>`)}
      </tbody></table>`,
    )}
    ${panel(
      'Opérateurs',
      html`<table class="data dense"><caption class="vh">Opérateurs</caption><thead><tr><th scope="col">Opérateur</th><th scope="col">Carte</th><th scope="col">Côté</th><th scope="col" class="num">Manches</th></tr></thead><tbody>
      ${td.operators.slice(0, 14).map((o) => html`<tr><td>${o.operator}</td><td>${o.map}</td><td>${o.side === 'atk' ? 'Attaque' : 'Défense'}</td><td class="num">${o.picks}</td></tr>`)}
      </tbody></table>`,
    )}
  </div>`;
  return page({ title: `${tm.name} · Tendances`, crumbs: [['Accueil', '/'], ['LFR', '/c/lfr/s3'], [tm.name, `/teams/${tm.slug}`], ['Tendances', null]], main, cols: 'right', right: html`${teamInfobox(tm)}` });
}

const TIER_LABEL: Record<string, string> = { A: 'A', B: 'B', C: 'C', D: 'D' };

function teamPalmares(): string {
  const tm = D.team(TEAM);
  const ext = D.externalResults[tm.slug] ?? [];
  const plat = D.platformResults[tm.slug] ?? [];
  const main = html`
  ${teamHead(tm, 'palmares')}
  ${panel(
    'Sur la plateforme',
    html`<table class="data"><caption class="vh">Résultats de la plateforme</caption><thead><tr><th scope="col">Saison</th><th scope="col">Compétition</th><th scope="col">Phase</th><th scope="col">Place</th><th scope="col" class="num">Bilan</th></tr></thead><tbody>
    ${plat.map((r) => html`<tr><td>${r.season}</td><td>${r.competition}</td><td>${r.stage}</td><td><b>${r.placement}</b></td><td class="num">${r.record}</td></tr>`)}
    </tbody></table><p class="pad faint" style="font-size:11px;margin:0">Calculés à partir des saisons closes et des tableaux, jamais saisis.</p>`,
  )}
  ${panel(
    'Résultats externes',
    html`<table class="data"><caption class="vh">Résultats externes</caption><thead><tr><th scope="col">Date</th><th scope="col">Place</th><th scope="col"><abbr title="Niveau fixé par le staff : A le plus haut">Tier</abbr></th><th scope="col">Événement</th><th scope="col" class="num opt">Équipes</th><th scope="col" class="opt">Gain</th><th scope="col" class="opt2">Joueurs</th></tr></thead><tbody>
    ${ext.map((r) => html`<tr><td>${D.dateYear(r.date)}</td><td><b>${r.placement}</b></td><td><span class="tier tier-${r.tier}">${TIER_LABEL[r.tier]}</span></td><td class="wrapcell"><a href="#proof">${r.event}</a> <span class="faint">${r.organiser}</span></td><td class="num opt">${r.teams}</td><td class="opt">${r.prize ?? '–'}</td><td class="opt2">${r.roster.map((p) => D.players.get(p)?.tag ?? p).join(', ')}</td></tr>`)}
    </tbody></table>
    <p class="pad faint" style="font-size:11px;margin:0">Déclarés par le manager avec un lien de preuve, approuvés par le staff. Affichés, jamais comptés : ni points, ni tête de série, ni montée.</p>`,
    { extra: html`<span class="faint">${ext.length} approuvés · 1 en attente</span>` },
  )}`;
  return page({ title: `${tm.name} · Palmarès`, crumbs: [['Accueil', '/'], ['LFR', '/c/lfr/s3'], [tm.name, `/teams/${tm.slug}`], ['Palmarès', null]], main, cols: 'right', right: teamInfobox(tm) });
}

// ---------------------------------------------------------------------------------------------
// Player

function playerInfobox(p: D.Player): Raw {
  const tm = D.teamOf(p.slug);
  const e = tm ? (D.rosters.get(tm.slug) ?? []).find((x) => x.player === p.slug) : undefined;
  return html`<section class="panel infobox">
    <div class="ib-title">${p.tag}</div>
    ${kv([
      ['Nationalité', html`${flag(p.nat)} ${natName(p.nat)}`],
      ['Équipe', tm ? team(tm, { size: 16 }) : 'sans équipe'],
      ['Rôle', e ? `${e.position}${e.captain ? ' · capitaine' : ''}${e.role === 'sub' ? ' · remplaçant' : ''}` : null],
      ['Rang R6', `${p.rank} (déclaré)`],
      ['Stats publiques', p.consent ? 'oui' : 'non'],
    ])}
  </section>`;
}

function player(slug: string): string {
  const p = D.player(slug);
  const tm = D.teamOf(slug) as D.Team;
  const div = tm.division;
  const tot = D.totalsFor(slug, (m) => m.division === div);
  const d = D.derived(tot);
  const log = D.gameLog(slug);
  const sp = D.splits(slug);
  const career = D.careers[slug] ?? [];
  const metrics: [D.MetricDef['key'], string, string][] = [
    ['kd', 'K/D', D.ratio(d.kd)],
    ['kpr', 'Kills par manche', D.ratio(d.kpr)],
    ['hs', 'Headshots', D.pct(d.hs)],
    ['kost', 'KOST', D.pct(d.kost)],
    ['srv', 'Survie', D.pct(d.srv)],
    ['entry', 'Entry', d.entry === null ? '–' : D.signed(d.entry)],
    ['clutch', 'Clutchs', `${tot.clutchWins}/${tot.clutchAttempts}`],
    ['plants', 'Désamorceurs posés', String(tot.plants)],
  ];
  const sideRow = (label: string, t: D.Totals) => {
    const x = D.derived(t);
    return html`<tr><th scope="row">${label}</th><td class="num">${t.rounds}</td><td class="num">${t.kills}–${t.deaths}</td><td class="num">${D.ratio(x.kd)}</td><td class="num">${D.pct(x.kost)}</td><td class="num">${x.entry === null ? '–' : D.signed(x.entry)}</td></tr>`;
  };
  const main = html`
  <div class="head" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">${flag(p.nat, 20)}<div style="flex:1"><h1>${p.tag}</h1><div class="sub">${team(tm, { size: 14 })} · LFR ${divisionName(div)} · ${(D.rosters.get(tm.slug) ?? []).find((e) => e.player === slug)?.position}</div></div>
    <label class="f">Saison<select><option selected>Saison 3</option><option>Saison 2</option><option>Toutes</option></select></label></div>
  ${panel(
    'Saison 3 · par rapport à la Ligue 1',
    html`<table class="data pct"><caption class="vh">Stats et percentiles</caption><thead><tr><th scope="col">Stat</th><th scope="col" class="num">Valeur</th><th scope="col" style="width:45%">Percentile en ${divisionName(div)}</th><th scope="col" class="num">Pct.</th></tr></thead><tbody>
    ${metrics.map(([k, label, v]) => {
      const pc = D.percentile(div, k, D.metricValue(tot, k));
      return html`<tr><th scope="row">${label}</th><td class="num"><b>${v}</b></td><td>${pc === null ? html`<span class="faint">échantillon trop petit</span>` : html`<span class="pctbar ${pc < 50 ? 'lo' : ''}"><span style="width:${pc}%"></span></span>`}</td><td class="num">${pc === null ? '–' : pc}</td></tr>`;
    })}</tbody></table>
    <p class="pad faint" style="font-size:11px;margin:0">${tot.maps} cartes, ${tot.rounds} manches · <b>KOST : ${tot.replayMaps}/${tot.maps} cartes</b> (KOST, survie, entry, clutchs et plants viennent des replays) · percentiles parmi les joueurs de Ligue 1 avec au moins 30 % des manches de leur équipe et des stats publiques.</p>`,
  )}
  <div class="grid2">
    ${panel(
      'Par carte',
      html`<table class="data dense"><caption class="vh">Par carte</caption><thead><tr><th scope="col">Carte</th><th scope="col" class="num">Manches</th><th scope="col" class="num">K–D</th><th scope="col" class="num">K/D</th><th scope="col" class="num">KOST</th></tr></thead><tbody>
      ${sp.maps.map((x) => {
        const y = D.derived(x.totals);
        return html`<tr><th scope="row">${x.map}</th><td class="num">${x.totals.rounds}</td><td class="num">${x.totals.kills}–${x.totals.deaths}</td><td class="num">${D.ratio(y.kd)}</td><td class="num">${D.pct(y.kost)}</td></tr>`;
      })}</tbody></table>`,
    )}
    ${panel(
      'Par côté (replays)',
      html`<table class="data dense"><caption class="vh">Par côté</caption><thead><tr><th scope="col">Côté</th><th scope="col" class="num">Manches</th><th scope="col" class="num">K–D</th><th scope="col" class="num">K/D</th><th scope="col" class="num">KOST</th><th scope="col" class="num">Entry</th></tr></thead><tbody>
      ${sideRow('Attaque', sp.sides.atk)}${sideRow('Défense', sp.sides.def)}</tbody></table>
      <table class="data dense"><caption class="vh">Par opérateur</caption><thead><tr><th scope="col">Opérateur</th><th scope="col" class="num">Manches</th><th scope="col" class="num">K–D</th><th scope="col" class="num">Gagnées</th></tr></thead><tbody>
      ${sp.operators.map((o) => html`<tr><th scope="row">${o.operator} <span class="faint">${o.side === 'atk' ? 'att.' : 'déf.'}</span></th><td class="num">${o.rounds}</td><td class="num">${o.kills}–${o.deaths}</td><td class="num">${pctOf(o.won, o.rounds)}</td></tr>`)}
      </tbody></table>`,
    )}
  </div>
  ${panel(
    'Journal des matchs',
    html`<table class="data tagm dense"><caption class="vh">Journal</caption><thead><tr><th scope="col">Date</th><th scope="col">Adversaire</th><th scope="col" class="opt">Carte</th><th scope="col" class="num">Score</th><th scope="col" class="num">K–D–A</th><th scope="col" class="num">KOST</th><th scope="col" class="opt">Source</th></tr></thead><tbody>
    ${log.map((r) => {
      const y = D.derived(r.totals);
      return html`<tr><td class="faint">${r.match.scheduledAt ? D.dateShort(r.match.scheduledAt) : ''}</td><td>${team(r.opponent, { size: 14 })}</td><td class="opt">${r.map}</td><td class="num"><a href="${matchHref(r.match)}" class="${r.won ? 'pos' : 'neg'}">${r.won ? 'V' : 'D'} ${r.score[0]}–${r.score[1]}</a></td>
        <td class="num">${r.source === 'none' ? html`<span class="faint">–</span>` : `${r.totals.kills}–${r.totals.deaths}–${r.totals.assists}`}</td><td class="num">${r.totals.replayRounds ? D.pct(y.kost) : html`<span class="faint">–</span>`}</td><td class="opt">${r.source === 'replay_verified' ? 'replay' : r.source === 'replay_unverified' ? 'replay (non vérifié)' : r.source === 'manual' ? 'manuel' : 'aucune'}</td></tr>`;
    })}</tbody></table>`,
  )}
  ${panel(
    'Carrière',
    html`<table class="data"><caption class="vh">Carrière</caption><thead><tr><th scope="col">Saison</th><th scope="col">Équipe</th><th scope="col">Division</th><th scope="col">Classement</th><th scope="col" class="num opt">Cartes</th><th scope="col" class="num opt">K/D</th><th scope="col">Récompenses</th></tr></thead><tbody>
    ${career.map((c) => html`<tr><td>${c.competition} ${c.season}</td><td>${team(D.team(c.team), { size: 14 })}</td><td>${c.division}</td><td>${c.rank}</td><td class="num opt">${c.maps || tot.maps}</td><td class="num opt">${c.kd || D.ratio(d.kd)}</td><td class="wrapcell">${c.awards.join(', ') || html`<span class="faint">—</span>`}</td></tr>`)}
    </tbody></table>
    <table class="data dense"><caption class="vh">Résultats externes avec l’équipe</caption><tbody>${(D.externalResults[tm.slug] ?? []).filter((r) => r.roster.includes(slug)).map((r) => html`<tr><td class="faint">${D.dateYear(r.date)}</td><td><b>${r.placement}</b> <span class="tier tier-${r.tier}">${r.tier}</span></td><td>${r.event} <span class="faint">avec ${tm.tag}</span></td></tr>`)}</tbody></table>`,
  )}`;
  return page({ title: p.tag, crumbs: [['Accueil', '/'], ['Joueurs', null], [p.tag, null]], main, cols: 'right', right: html`${playerInfobox(p)}${rightSidebar({ standings: false })}` });
}

function playerNoConsent(): string {
  const slug = D.featured.noConsent;
  const p = D.player(slug);
  const tm = D.teamOf(slug) as D.Team;
  const log = D.gameLog(slug).filter(() => true);
  const main = html`
  <div class="head" style="display:flex;gap:12px;align-items:center">${flag(p.nat, 20)}<div><h1>${p.tag}</h1><div class="sub">${team(tm, { size: 14 })} · LFR ${divisionName(tm.division)} · Ancre</div></div></div>
  ${panel('Statistiques', empty('Statistiques non publiées', `${p.tag} n’a pas accepté la publication de ses statistiques. Il apparaît dans les effectifs et les résultats, mais pas dans les pages de stats ni les classements de joueurs.`))}
  ${panel(
    'Matchs joués',
    html`<table class="data tagm dense"><caption class="vh">Matchs</caption><thead><tr><th scope="col">Date</th><th scope="col">Adversaire</th><th scope="col">Carte</th><th scope="col" class="num">Résultat de l’équipe</th></tr></thead><tbody>
    ${log.map((r) => html`<tr><td class="faint">${r.match.scheduledAt ? D.dateShort(r.match.scheduledAt) : ''}</td><td>${team(r.opponent, { size: 14 })}</td><td>${r.map}</td><td class="num"><a href="${matchHref(r.match)}" class="${r.won ? 'pos' : 'neg'}">${r.won ? 'V' : 'D'} ${r.score[0]}–${r.score[1]}</a></td></tr>`)}
    </tbody></table>`,
  )}
  ${panel('Carrière', html`<table class="data dense"><caption class="vh">Carrière</caption><tbody><tr><td>LFR Saison 3</td><td>${team(tm, { size: 14 })}</td><td>Ligue 1</td><td>en cours</td></tr><tr><td>LFR Saison 2</td><td>${team(tm, { size: 14 })}</td><td>Ligue 1</td><td>3e · finaliste de la Coupe</td></tr></tbody></table>`)}`;
  return page({ title: p.tag, crumbs: [['Accueil', '/'], ['Joueurs', null], [p.tag, null]], main, cols: 'right', right: html`${playerInfobox(p)}${rightSidebar({ standings: false })}` });
}

export const RENDER: Record<string, () => string> = {
  'club.html': () => club('w-mates'),
  'club-greed.html': () => club('greed'),
  'team.html': teamOverview,
  'team-tendances.html': teamTendances,
  'team-palmares.html': teamPalmares,
  'player.html': () => player(D.featured.player),
  'player-noconsent.html': playerNoConsent,
};
export const _u = [raw, signedCell, pill];
