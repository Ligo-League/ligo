// League pages: leaders, awards, the rulebook (long-form), recruitment.

import * as D from '../../_data/index.ts';
import { html, href, icon, raw, flag, type Raw } from '../../_build/lib.ts';
import { divisionName } from '../../_build/shared.ts';
import { page, rightSidebar } from './layout.ts';
import { team, panel, pill, kv, playerLink, empty } from './parts.ts';

const fmtMetric = (def: D.MetricDef, v: number) =>
  def.format === 'ratio' ? D.ratio(v) : def.format === 'percent' ? D.pct(v) : def.format === 'signed' ? D.signed(v) : D.int(v);

function leaders(): string {
  const div = 'ligue-1';
  const board = (key: D.MetricDef['key'], limit: number) => {
    const def = D.METRICS.find((m) => m.key === key) as D.MetricDef;
    const { rows, hidden } = D.leaders(div, key, limit);
    return panel(
      def.label,
      html`<table class="data tagm dense"><caption class="vh">${def.label}</caption><thead><tr><th scope="col" class="num">#</th><th scope="col">Joueur</th><th scope="col">Équipe</th><th scope="col" class="num">${def.short}</th><th scope="col" class="num opt"><abbr title="Manches jouées">Man.</abbr></th>${def.replayOnly ? html`<th scope="col" class="num opt"><abbr title="Cartes avec replay / cartes jouées">Couv.</abbr></th>` : ''}</tr></thead><tbody>
      ${rows.map((r, i) => html`<tr><td class="num">${i + 1}</td><td>${playerLink(r.player)}</td><td>${team(r.team, { size: 14, tagOnly: true })}</td><td class="num"><b>${fmtMetric(def, r.value)}</b></td><td class="num opt">${def.replayOnly ? r.totals.replayRounds : r.totals.rounds}</td>${def.replayOnly ? html`<td class="num opt">${r.coverage.replay}/${r.coverage.maps}</td>` : ''}</tr>`)}
      </tbody></table><p class="pad faint" style="font-size:11px;margin:0">${hidden} joueurs sous le seuil${def.replayOnly ? ' (échantillon ou couverture)' : ''}.</p>`,
      { extra: def.replayOnly ? html`<span class="faint">replays</span>` : '' },
    );
  };
  const main = html`
  <div class="head" style="display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center"><h1 style="flex:1">Leaders · ${divisionName(div)}</h1>
    <nav class="seg" aria-label="Division"><a aria-current="page" href="${href('/c/lfr/s3/leaders')}">Ligue 1</a><a href="#ligue-2">Ligue 2</a></nav>
    <nav class="seg" aria-label="Portée"><span aria-current="true">Saison 3</span><a href="#cup">Coupe</a></nav></div>
  <p class="note info">Les totaux sont additionnés puis divisés à la fin, jamais en moyennant des ratios de match. Pour apparaître : au moins <b>30 % des manches</b> de son équipe ; pour les stats tirées des replays (KOST, survie, entry, clutchs, plants), des replays sur au moins <b>60 % de ses cartes</b>. Les joueurs sans consentement n’apparaissent pas.</p>
  ${board('kd', 10)}
  <div class="grid2">${board('kpr', 5)}${board('hs', 5)}</div>
  <div class="grid2">${board('kost', 5)}${board('entry', 5)}</div>
  <div class="grid2">${board('srv', 5)}${board('plants', 5)}</div>`;
  return page({ title: 'Leaders', crumbs: [['Accueil', '/'], ['LFR', '/c/lfr/s3'], ['Saison 3', '/c/lfr/s3'], ['Stats', null]], main, league: { comp: 'lfr', season: 's3', tab: 'stats' }, cols: 'right' });
}

function awards(): string {
  const weeks = [1, 2, 3, 4, 5, 6];
  const potw = (div: string) =>
    html`<table class="data tagm dense"><caption class="vh">Joueur de la semaine ${divisionName(div)}</caption><thead><tr><th scope="col">Sem.</th><th scope="col">Joueur</th><th scope="col">Équipe</th><th scope="col" class="num">K/D</th><th scope="col" class="num opt">K–D</th><th scope="col" class="num opt">Manches</th></tr></thead><tbody>
    ${weeks.map((w) => {
      if (w === 6) return html`<tr><td>S6</td><td colspan="5" class="faint wrapcell">Semaine en cours : désigné quand le dernier match de la semaine est validé</td></tr>`;
      const a = D.playerOfWeek(div, w);
      return a
        ? html`<tr><td>S${w}</td><td>${playerLink(a.player)}</td><td>${team(a.team, { size: 14, tagOnly: true })}</td><td class="num"><b>${D.ratio(a.kd)}</b></td><td class="num opt">${a.kills}–${a.deaths}</td><td class="num opt">${a.rounds}</td></tr>`
        : html`<tr><td>S${w}</td><td colspan="5" class="faint wrapcell">Pas de lauréat : aucun match de la semaine avec replay</td></tr>`;
    })}</tbody></table>`;
  const main = html`
  <div class="head"><h1>Récompenses · Saison 3</h1><div class="sub">Joueur de la semaine par division : meilleur ${D.AWARD_RULE.metric} des matchs de la semaine avec replay, au moins ${D.AWARD_RULE.minRounds} manches, joueurs avec stats publiques. Réglage <code>awards_json</code>.</div></div>
  <div class="grid2">${panel('Joueur de la semaine · Ligue 1', potw('ligue-1'))}${panel('Joueur de la semaine · Ligue 2', potw('ligue-2'))}</div>
  ${panel(
    'Récompenses de la saison 3',
    html`<table class="data dense"><caption class="vh">Récompenses de saison</caption><tbody>${D.seasonAwardsS3.map((a) => html`<tr><th scope="row">${a}</th><td class="faint">attribuée à la clôture de la saison, le 20 déc.</td></tr>`)}</tbody></table>`,
  )}
  ${panel(
    'Saison 2 · lauréats',
    html`<table class="data dense"><caption class="vh">Lauréats saison 2</caption><thead><tr><th scope="col">Récompense</th><th scope="col">Division</th><th scope="col">Joueur</th><th scope="col">Équipe</th><th scope="col" class="opt">Valeur</th></tr></thead><tbody>
    ${D.seasonAwardsS2.map((a) => html`<tr><th scope="row">${a.award}</th><td>${a.division}</td><td>${playerLink(a.player)}</td><td>${team(D.team(a.team), { size: 14, tagOnly: true })}</td><td class="opt">${a.value}</td></tr>`)}</tbody></table>`,
  )}`;
  return page({ title: 'Récompenses', crumbs: [['Accueil', '/'], ['LFR', '/c/lfr/s3'], ['Saison 3', '/c/lfr/s3'], ['Récompenses', null]], main, league: { comp: 'lfr', season: 's3', tab: 'awards' }, cols: 'right' });
}

function rules(): string {
  const sections = D.rulebook();
  const cur = D.rulesVersions[0] as (typeof D.rulesVersions)[number];
  const toc = html`<section class="panel toc"><div class="ph"><h2>Sommaire</h2></div><ol>
    ${sections.map((s) => html`<li><a href="#${s.id}">${s.title}</a>${s.subsections.length ? html`<ol>${s.subsections.map((x) => html`<li><a href="#${x.id}">${x.number} ${x.title}</a></li>`)}</ol>` : ''}</li>`)}
  </ol></section>`;
  const doc = html`<section class="panel">
    <div class="ph"><h2>Règlement LFR · version ${cur.version}</h2><div class="ph-x"><span class="faint">en vigueur depuis le ${D.dateYear(cur.effective)}</span></div></div>
    <article class="rules-doc">
      ${sections.map((s) => html`<h2 id="${s.id}">${s.number}. ${s.title}</h2>${s.blocks.map((b) =>
        b.kind === 'h3' ? html`<h3 id="${b.id}">${b.text}</h3>` : b.kind === 'p' ? html`<p>${raw(b.text)}</p>` : html`<ul>${b.items.map((i) => html`<li>${raw(i)}</li>`)}</ul>`,
      )}`)}
    </article></section>`;
  const right = html`${panel(
    'Version en vigueur',
    kv([
      ['Version', html`<b>${cur.version}</b>`],
      ['En vigueur', D.dateYear(cur.effective)],
      ['Publiée', `${D.dateYear(cur.published)} par ${cur.by}`],
      ['Changement', cur.summary],
    ]),
  )}
  ${panel(
    'Historique',
    html`<table class="data dense"><caption class="vh">Versions</caption><tbody>${D.rulesVersions.map((v, i) => html`<tr><td><a href="#v${v.version}">v${v.version}</a></td><td class="faint">${D.dateShort(v.effective)}${i === 0 ? ' · actuelle' : ''}</td></tr><tr><td colspan="2" class="wrapcell faint" style="font-size:11px;height:auto;padding-bottom:4px">${v.summary}</td></tr>`)}</tbody></table>`,
  )}`;
  return page({ title: 'Règlement LFR', crumbs: [['Accueil', '/'], ['LFR', '/c/lfr/s3'], ['Règlement', null]], main: doc, league: { comp: 'lfr', season: 's3', tab: 'rules' }, cols: 'three', left: toc, right });
}

function recruitment(): string {
  const L = D.listings;
  const main = html`
  <div class="head"><h1>Recrutement</h1><div class="sub">Joueurs sans équipe et équipes qui cherchent, sur toutes les compétitions de Ligo. Une annonce expire après 30 jours ; un transfert passe toujours par le mercato de la ligue et son staff.</div></div>
  <section class="panel">
    <form class="filters" action="#" method="get">
      <label class="f">Jeu<select><option>Rainbow Six Siege</option><option>Valorant</option><option>Rocket League</option></select></label>
      <label class="f">Compétition<select><option selected>LFR</option><option>Toutes</option><option>BSL</option><option>FRFL</option><option>LR6</option></select></label>
      <label class="f">Rôle<select><option>Tous</option><option>IGL</option><option>Entry</option><option>Support</option><option>Flex</option><option>Ancre</option><option>Coach</option></select></label>
      <label class="f">Langue<select><option>Toutes</option><option>FR</option><option>NL</option><option>EN</option><option>DE</option></select></label>
      <label class="f">Rang minimum<select><option>Tous</option><option>Platine</option><option>Émeraude</option><option>Diamant</option><option>Champion</option></select></label>
      <a class="btn btn-p" href="#new" style="margin-left:auto">Publier une annonce</a>
    </form>
  </section>
  ${panel(
    `Joueurs · ${L.players.length}`,
    html`<table class="data dense"><caption class="vh">Annonces de joueurs</caption><thead><tr><th scope="col">Joueur</th><th scope="col">Rôles</th><th scope="col" class="opt">Rang</th><th scope="col" class="opt">Langues</th><th scope="col" class="opt2">Disponibilités</th><th scope="col">Expire</th></tr></thead><tbody>
    ${L.players.map((l) => html`<tr><th scope="row">${playerLink(l.player.toLowerCase())}</th><td>${l.roles.join(', ')}</td><td class="opt">${l.rank}</td><td class="opt">${l.languages.join(' · ')}</td><td class="opt2 wrapcell">${l.availability}</td><td class="${l.expires - D.NOW < 7 * 86_400_000 ? 'neg' : 'faint'}">${D.dateShort(l.expires)}</td></tr>
      ${l.note ? html`<tr><td colspan="6" class="wrapcell faint" style="height:auto;padding:0 8px 6px;font-size:11.5px">${l.note}</td></tr>` : ''}`)}
    </tbody></table>`,
  )}
  ${panel(
    `Équipes · ${L.teams.length}`,
    html`<table class="data dense"><caption class="vh">Annonces d’équipes</caption><thead><tr><th scope="col">Équipe</th><th scope="col">Cherche</th><th scope="col" class="opt">Division</th><th scope="col">Expire</th></tr></thead><tbody>
    ${L.teams.map((l) => {
      const tm = D.team(l.team);
      return html`<tr><th scope="row">${team(tm, { size: 16 })}</th><td><b>${l.role}</b></td><td class="opt">${divisionName(tm.division)}</td><td class="${l.expires - D.NOW < 3 * 86_400_000 ? 'neg' : 'faint'}">${D.dateShort(l.expires)}</td></tr><tr><td colspan="4" class="wrapcell faint" style="height:auto;padding:0 8px 6px;font-size:11.5px">${l.note}</td></tr>`;
    })}</tbody></table>`,
  )}
  ${panel('Coachs disponibles', empty('Aucune annonce', 'Aucun coach ne cherche d’équipe en ce moment.'))}`;
  return page({ title: 'Recrutement', crumbs: [['Ligo', '/'], ['Recrutement', null]], main, game: 'r6', cols: 'three' });
}

export const RENDER: Record<string, () => string> = {
  'leaders.html': leaders,
  'awards.html': awards,
  'rules.html': rules,
  'recruitment.html': recruitment,
};
export const _u = [icon, flag, pill];
