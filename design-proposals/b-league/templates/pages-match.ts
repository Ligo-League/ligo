// Match pages (to play, played, forfeit, disputed, cup BO3), the veto and the replay upload.

import * as D from '../../_data/index.ts';
import { html, href, icon, raw, flag, teamRoute, type Raw } from '../../_build/lib.ts';
import { t } from '../../_build/i18n.ts';
import { scoreOf, statusOf } from '../../_build/shared.ts';
import { page, type Viewer } from './layout.ts';
import { badge, divName, mapChip, mapTone, matchHero, pill, playerLink, roundTimeline, scoreboard, sectionHead, sourceBadge, statusPill, teamColor, vetoSteps, signedCell } from './parts.ts';

const F = D.featured;
const sideTeam = (m: D.Match, s: 'a' | 'b' | null) => (s === 'a' ? m.a : s === 'b' ? m.b : null);
const rankOf = (team: D.Team) => D.standings(team.division).find((r) => r.team.slug === team.slug);
const rankText = (team: D.Team) => {
  const r = rankOf(team);
  return r ? (r.excluded ? t('excluded') : `${r.rank}${r.rank === 1 ? 'er' : 'e'}${r.shared ? ' ex æquo' : ''} de ${divName(team.division)}`) : '';
};

function crumbsFor(m: D.Match): [string, string | null][] {
  return [[t('home'), '/'], ['LFR', '/c/lfr/s3'], ['Saison 3', '/c/lfr/s3'], [divName(m.division), `/c/lfr/s3/standings/${m.division}`], [`${t('week')} ${m.week}`, '/c/lfr/s3/calendar'], [`${m.a.tag} – ${m.b.tag}`, null]];
}

function subnav(items: [string, string][]): Raw {
  return html`<nav class="subtabs" aria-label="Sections du match"><div class="wrap">${items.map(([label, id], i) => html`<a href="#${id}" ${i === 0 ? raw('aria-current="true"') : ''}>${label}</a>`)}</div></nav>`;
}

function lineups(m: D.Match): Raw {
  const side = (team: D.Team) => {
    const entries = D.rosters.get(team.slug) ?? [];
    const staff = team.staff;
    return html`<div><div class="sb-head" style="--team:${teamColor(team)}">${badge(team, 28)}<h3>${team.name}</h3><span class="res" style="font-size:var(--fs-s);font-stretch:100%;font-weight:600" >5 + ${entries.filter((e) => e.role === 'sub').length}</span></div>
      <table class="tbl"><thead><tr><th scope="col">Joueur</th><th scope="col">Rôle</th><th scope="col" class="r">Statut</th></tr></thead><tbody>
      ${entries.map((e) => html`<tr><th scope="row" style="font-weight:600">${playerLink(e.player)}${e.captain ? html` <abbr title="Capitaine" class="pill solid" style="padding:0 5px">C</abbr>` : ''}</th><td class="muted">${e.position}</td><td class="r">${e.role === 'sub' ? html`<span class="muted">Remplaçant</span>` : 'Titulaire'}</td></tr>`)}
      ${staff.map((s) => html`<tr><th scope="row" style="font-weight:500" class="muted">${D.player(s.player).tag}</th><td class="muted">${s.role === 'coach' ? 'Coach' : 'Manager'}</td><td class="r dim">Staff</td></tr>`)}
      </tbody></table></div>`;
  };
  return html`<div class="grid-2">${side(m.a)}${side(m.b)}</div>`;
}

function preview(m: D.Match): Raw {
  const col = (team: D.Team) => {
    const td = D.tendencies(team.slug);
    const ts = D.teamSeason(team.slug);
    const atk = ts.attack.rounds ? ts.attack.won / ts.attack.rounds : null;
    const def = ts.defence.rounds ? ts.defence.won / ts.defence.rounds : null;
    return html`<div>
      <div class="sb-head" style="--team:${teamColor(team)}">${badge(team, 26)}<h3>${team.tag}</h3><span class="res" style="font-size:var(--fs-s);font-stretch:100%;font-weight:600">${ts.record.wins}–${ts.record.losses} sur le terrain</span></div>
      <div class="figures" style="margin-top:var(--s3)">
        <div class="figure"><b>${D.pct(atk)}</b><span>Rounds gagnés en attaque</span><small>${ts.attack.rounds} rounds</small></div>
        <div class="figure"><b>${D.pct(def)}</b><span>Rounds gagnés en défense</span><small>${ts.defence.rounds} rounds</small></div>
      </div>
      <p class="kicker" style="margin-top:var(--s4)">Premier ban habituel</p>
      <p style="margin-top:4px">${td.firstBans.length ? td.firstBans.slice(0, 3).map(([map, n], i) => html`${i ? ' · ' : ''}${mapChip(map)} <span class="dim">×${n}</span>`) : html`<span class="dim">Aucun veto enregistré</span>`}</p>
      <p class="kicker" style="margin-top:var(--s3)">Jamais bannies</p>
      <p style="margin-top:4px;font-size:var(--fs-s)">${td.neverBanned.join(', ') || '—'}</p>
      <table class="tbl" style="margin-top:var(--s3)"><thead><tr><th scope="col">Carte</th><th scope="col" class="r">Bilan</th><th scope="col" class="r">Att.</th><th scope="col" class="r">Déf.</th></tr></thead><tbody>
      ${td.perMap.map((r) => html`<tr><th scope="row" style="font-weight:500">${mapChip(r.map)}</th><td class="r">${r.wins}–${r.played - r.wins}</td><td class="r">${r.atkR ? D.pct(r.atkW / r.atkR) : html`<span class="dim">–</span>`}</td><td class="r">${r.defR ? D.pct(r.defW / r.defR) : html`<span class="dim">–</span>`}</td></tr>`)}
      </tbody></table>
      <p class="note">Couverture : ${td.coverage.replay}/${td.coverage.maps} cartes avec replay. Matchs officiels validés uniquement.</p>
    </div>`;
  };
  const meetings = D.pastMeetings[`${m.a.slug}|${m.b.slug}`] ?? D.pastMeetings[`${m.b.slug}|${m.a.slug}`] ?? [];
  return html`<div class="grid-2">${col(m.a)}${col(m.b)}</div>
  <div class="section">${sectionHead('Confrontations précédentes')}
    ${
      meetings.length
        ? html`<table class="tbl"><thead><tr><th scope="col">Date</th><th scope="col">Compétition</th><th scope="col">Match</th><th scope="col" class="r">Score</th><th scope="col" class="hide-m">Cartes</th></tr></thead><tbody>
      ${meetings.map((x) => html`<tr><td class="nowrap muted">${D.dateYear(x.at)}</td><td>${x.season} · ${x.stage}</td><td>${D.team(x.a).tag} – ${D.team(x.b).tag}</td><td class="r strong">${x.score}</td><td class="hide-m muted">${x.maps}</td></tr>`)}
      </tbody></table>`
        : html`<p class="muted">Première rencontre entre ces deux équipes sur la plateforme.</p>`
    }</div>`;
}

function keyFacts(m: D.Match): Raw {
  const w = D.weekRange(m.week + (m.extension ? 1 : 0));
  const hostT = sideTeam(m, m.host);
  const sideT = sideTeam(m, m.sideChooser);
  const otT = sideTeam(m, m.otSideChooser);
  const row = (k: string, v: Raw | string) => html`<tr><th scope="row" style="font-weight:500;color:var(--text-2);width:44%">${k}</th><td>${v}</td></tr>`;
  return html`<table class="tbl"><tbody>
    ${row('Compétition', `LFR Saison 3 · ${divName(m.division)} · BO${m.bestOf}`)}
    ${row('Fenêtre de jeu', `${t('week')} ${m.week}${m.extension ? ' (prolongation)' : ''} · ${D.dateShort(w.start)} – ${D.dateShort(w.end)}`)}
    ${row('Date limite', D.when(w.end))}
    ${row('Horaire', m.scheduledAt ? html`<b>${D.when(m.scheduledAt)}</b>${m.autoScheduled ? html` ${pill(t('stAuto'), 'info')}` : ''}` : m.proposal ? html`Proposé : <b>${D.when(m.proposal.at)}</b>` : 'Pas encore convenu')}
    ${m.coinToss ? row('Tirage au sort', `${sideTeam(m, m.coinToss.winner)?.tag} gagne et choisit ${m.coinToss.chose === 'side' ? 'le choix du côté' : 'le premier ban'}`) : ''}
    ${row('Hôte', hostT ? html`${badge(hostT, 18)} ${hostT.name} <span class="dim">(mieux classé)</span>` : 'À convenir entre les équipes')}
    ${row('Choix du côté et premier ban', sideT ? html`${badge(sideT, 18)} ${sideT.name} <span class="dim">(moins bien classé)</span>` : '—')}
    ${row('Côté en prolongation', otT ? html`${badge(otT, 18)} ${otT.name}` : '—')}
    ${row('Stream', m.stream ? html`<a href="${m.stream}">${m.stream.replace('https://', '')} ${icon('external', 12)}</a>` : html`<span class="dim">Aucun annoncé</span>`)}
  </tbody></table>`;
}

function actions(m: D.Match, viewer: Viewer): Raw {
  if (!viewer) return html``;
  const items: [string, string, string, 'primary' | 'normal' | 'off', string][] = [
    ['Proposer un horaire', 'calendar', 'Un horaire est déjà convenu ; une nouvelle proposition le remplace si GREED Academy et W Mates l’acceptent.', 'normal', '#propose'],
    ['Rejoindre le veto', 'timer', 'Le veto a commencé à 20:31. À vous de bannir : étape 5 sur 9.', 'primary', href(`/matches/${m.id}/veto`)],
    ['Déclarer le résultat', 'check', 'Possible après le match, avec la capture du tableau final. L’adversaire confirme, le résultat compte.', 'off', '#report'],
    ['Envoyer replays et MOSS', 'upload', 'Le dossier MatchReplay et le fichier MOSS, juste après le match : le jeu efface les replays au-delà de 12.', 'normal', href(`/matches/${D.featured.reported.id}/upload`)],
  ];
  return html`<section class="section" id="actions">${sectionHead('Vos actions', { small: `${viewer.name} · ${viewer.role}` })}
    <div class="grid-2" style="gap:2px">
    ${items.map(([label, ic, help, kind, link]) => html`<div class="panel" style="display:flex;gap:var(--s4);align-items:flex-start;border-radius:0">
      <div style="flex:1"><p style="font-weight:700">${label}</p><p class="note" style="margin-top:2px">${help}</p></div>
      ${kind === 'off' ? html`<span class="btn" aria-disabled="true" style="opacity:.55">${icon(ic as 'check', 16)} Après le match</span>` : html`<a class="btn ${kind === 'primary' ? 'btn-primary' : ''}" href="${link}">${icon(ic as 'check', 16)} ${label}</a>`}
    </div>`)}
    </div>
    <p class="note">Le capitaine et les responsables de l’équipe agissent ici ou dans le salon du match sur Discord ; chaque action est annoncée dans le salon de la ligue.</p>
  </section>`;
}

export function matchToPlay(m: D.Match, viewer: Viewer = null): Raw {
  const s = statusOf(m);
  const pending = m.status === 'proposed' && m.proposal;
  const body = html`
  ${matchHero({
    stage: `${divName(m.division)} · ${t('week')} ${m.week}`,
    sub: `LFR · Saison 3 · BO${m.bestOf}`,
    a: m.a,
    b: m.b,
    aSub: rankText(m.a),
    bSub: rankText(m.b),
    centrePill: m.vetoState === 'in_progress' ? html`<a href="${href(`/matches/${m.id}/veto`)}">${pill('Veto en cours · étape 5/9', 'live')}</a>` : statusPill(m),
    at: m.scheduledAt,
    facts: m.scheduledAt && D.sameDay(m.scheduledAt, D.NOW) ? html`<span>Dans <b>${Math.round((m.scheduledAt - D.NOW) / 60000)} min</b></span>${m.stream ? html`<span>${icon('play', 16)} <a href="${m.stream}">${m.stream.replace('https://', '')}</a></span>` : ''}` : undefined,
  })}
  ${subnav([['Infos', 'infos'], ['Équipes', 'equipes'], ['Aperçu du match', 'apercu']])}
  <div class="wrap">
    ${viewer ? actions(m, viewer) : ''}
    ${
      pending && m.proposal
        ? html`<div class="callout" style="margin-top:var(--s5)"><strong>${icon('clock', 14)} Horaire proposé, pas encore accepté</strong>${sideTeam(m, m.proposal.by)?.name} propose <b>${D.when(m.proposal.at)}</b> (le ${D.when(m.proposal.madeAt)}). En attente de ${sideTeam(m, m.proposal.by === 'a' ? 'b' : 'a')?.name}, qui accepte ou refuse dans le salon du match ou ici. Sans accord à la fin de la semaine, prolongation d’une semaine puis horaire automatique le dimanche à 21:00.</div>`
        : ''
    }
    <div class="grid-main section" id="infos">
      <div>${sectionHead('Le match', { small: s.label })}${keyFacts(m)}</div>
      <aside class="stack">
        <div class="panel"><p class="kicker">Veto des cartes</p>
          ${m.vetoState === 'in_progress' ? html`<p style="margin:6px 0 var(--s3)">4 bans faits sur 8. À ${sideTeam(m, m.sideChooser)?.tag} de bannir, 4 min par étape.</p><a class="btn btn-primary" href="${href(`/matches/${m.id}/veto`)}">${icon('timer', 16)} Suivre le veto</a>` : html`<p style="margin-top:6px">Pas encore lancé. ${sideTeam(m, m.sideChooser)?.tag ?? ''} bannira en premier.</p>`}
        </div>
        <div class="panel"><p class="kicker">Capture du score</p><p style="margin-top:6px">${icon('lock', 14)} Jamais publique : réservée au staff et aux deux équipes.</p></div>
      </aside>
    </div>
    <section class="section" id="equipes">${sectionHead('Équipes', { small: '5 titulaires, 2 remplaçants au plus' })}${lineups(m)}</section>
    <section class="section" id="apercu">${sectionHead('Aperçu du match', { small: 'Tendances de la saison' })}${preview(m)}</section>
  </div>`;
  return page({ title: `${m.a.name} – ${m.b.name}`, comp: 'lfr', crumbs: crumbsFor(m), viewer, body });
}

// ---------------------------------------------------------------------------------------------

function vetoSummary(m: D.Match): Raw {
  if (!m.veto.length) return html`<p class="muted">Pas de veto enregistré.</p>`;
  const side = m.veto.find((v) => v.action === 'side');
  const ot = m.veto.find((v) => v.action === 'ot_side');
  return html`<div class="veto-line">${m.veto.filter((v) => v.action === 'ban' || v.action === 'decider').map((v) => (v.action === 'ban' ? html`<span class="ban" title="Ban ${v.seq}">${sideTeam(m, v.team)?.tag} ${v.map}${v.timedOut ? ' (temps)' : ''}</span>` : html`<span class="dec">Jouée : ${v.map}</span>`))}</div>
  <p class="note">${side ? `${sideTeam(m, side.team)?.tag} commence en ${side.side === 'atk' ? 'attaque' : 'défense'}` : ''}${ot ? ` · ${sideTeam(m, ot.team)?.tag} choisit ${ot.side === 'atk' ? 'l’attaque' : 'la défense'} en prolongation` : ''}.</p>`;
}

function lobbyLine(g: D.GameSim, m: D.Match): string {
  const parts: string[] = [];
  for (let l = 1; l <= g.lobbies; l++) {
    const rs = g.rounds.filter((r) => r.lobby === l && r.kind === 'replay');
    const a = rs.filter((r) => r.winner === 'a').length;
    const b = rs.filter((r) => r.winner === 'b').length;
    const crash = g.rounds.some((r) => r.lobby === l && r.kind === 'void');
    parts.push(`Lobby ${l} : ${m.a.tag} ${a}–${b} ${m.b.tag}${crash ? ', puis crash (round annulé)' : ''}.`);
  }
  return parts.join(' ');
}

export function matchPlayed(m: D.Match): Raw {
  const sc = scoreOf(m);
  const g = m.game as D.GameSim;
  const replay = m.stats === 'replay_verified' || m.stats === 'replay_unverified';
  const counted = g.rounds.filter((r) => r.kind === 'replay').length;
  const unknown = D.staffQueue.unknownPlayers.find((u) => u.match.id === m.id);
  const reportAt = (m.scheduledAt ?? 0) + 58 * 60_000;
  const winner = sc && sc.winner === 'a' ? m.a : m.b;
  const loser = winner === m.a ? m.b : m.a;
  const body = html`
  ${matchHero({
    stage: `${divName(m.division)} · ${t('week')} ${m.week}`,
    sub: `LFR · Saison 3 · BO1 · ${g.map}`,
    a: m.a,
    b: m.b,
    aSub: rankText(m.a),
    bSub: rankText(m.b),
    score: sc ? [sc.a, sc.b] : null,
    centrePill: html`${statusPill(m)}${g.overtime ? html` ${pill('Prolongation', 'info')}` : ''}`,
    at: m.scheduledAt,
    facts: html`<span>Carte <b>${g.map}</b></span>${g.lobbies > 1 ? html`<span>Re-host : <b>${g.lobbies} lobbys</b></span>` : ''}<span>Stats : <b>${{ replay_verified: 'replay vérifié', replay_unverified: 'replay non vérifié', manual: 'saisie manuelle', none: 'aucune' }[m.stats]}</b></span>${m.stream ? html`<span>${icon('play', 16)} <a href="${m.stream}">VOD</a></span>` : ''}`,
  })}
  ${subnav([['Résumé', 'resume'], ['Veto', 'veto'], ['Tableau', 'tableau'], ...(replay ? ([['Rounds', 'rounds']] as [string, string][]) : [])])}
  <div class="wrap">
    <div class="grid-main section" id="resume">
      <div>${sectionHead('Score par carte')}
        <table class="tbl"><thead><tr><th scope="col">Carte</th><th scope="col" class="r">${m.a.tag}</th><th scope="col" class="r">${m.b.tag}</th><th scope="col" class="hide-m">Détail</th></tr></thead><tbody>
          <tr><th scope="row" style="font-weight:600">${mapChip(g.map)}</th><td class="r strong" style="font-size:var(--fs-l)">${g.scoreA}</td><td class="r strong" style="font-size:var(--fs-l)">${g.scoreB}</td><td class="hide-m muted">${g.overtime ? 'Prolongation, ' : ''}${g.lobbies > 1 ? `${g.lobbies} lobbys, 1 round annulé (crash)` : '1 lobby'}</td></tr>
        </tbody></table>
        ${
          g.lobbies > 1
            ? html`<div class="callout" style="margin-top:var(--s3)"><strong>Re-host détecté et recousu automatiquement</strong>${lobbyLine(g, m)} Total ${g.scoreA}–${g.scoreB}, conforme au score déclaré ; ${m.a.tag} avait demandé le re-host.</div>`
            : ''
        }
      </div>
      <aside class="stack">
        <div class="panel"><p class="kicker">Validation</p>
          <ol style="margin-top:var(--s2);font-size:var(--fs-s)">
            <li style="padding:4px 0;border-bottom:var(--rule)"><b>${D.time(reportAt)}</b> · déclaré par ${winner.tag} (capitaine)</li>
            <li style="padding:4px 0;border-bottom:var(--rule)"><b>${D.time(m.validatedAt ?? reportAt)}</b> · confirmé par ${loser.tag} : validé</li>
            <li style="padding:4px 0"><span class="muted">${icon('lock', 12)} Capture du score : staff et équipes uniquement</span></li>
          </ol></div>
      </aside>
    </div>
    <section class="section" id="veto">${sectionHead('Veto', { small: 'BO1 · 8 bans, la carte restante est jouée' })}${vetoSummary(m)}</section>
    <section class="section" id="tableau">${sectionHead('Tableau des joueurs')}
      ${sourceBadge(m.stats, replay ? `${counted}/${counted} rounds couverts${m.stats === 'replay_verified' ? ', replays des deux équipes' : ''}` : undefined)}
      ${unknown ? html`<div class="callout warn" style="margin-top:2px"><strong>${icon('alert', 14)} Joueur inconnu dans le replay</strong>Le compte « ${unknown.account} » (côté ${unknown.side}) n’est dans aucun effectif ; le staff a été prévenu. Ses rounds restent comptés, ses stats ne sont attribuées à personne.</div>` : ''}
      <div class="stack" style="margin-top:var(--s4)">
        ${scoreboard(g.rounds, 'a', m.a, m.stats, sc ? sc.winner === 'a' : null, g.scoreA)}
        ${scoreboard(g.rounds, 'b', m.b, m.stats, sc ? sc.winner === 'b' : null, g.scoreB)}
      </div>
      <p class="note">K kills · D morts (chutes comprises) · A assistances · KOST rounds avec kill, objectif, survie ou trade · Entry ouvertures gagnées moins perdues. ${replay ? '' : 'KOST, entry, clutchs, plants et opérateurs demandent un replay.'}</p>
    </section>
    ${replay ? html`<section class="section" id="rounds">${sectionHead('Rounds', { small: `${counted} comptés${g.lobbies > 1 ? ', 1 annulé' : ''}` })}${roundTimeline(g, m.a, m.b)}</section>` : ''}
  </div>`;
  return page({ title: `${m.a.name} ${g.scoreA}–${g.scoreB} ${m.b.name}`, comp: 'lfr', crumbs: crumbsFor(m), body });
}

export function matchForfeit(m: D.Match): Raw {
  const sc = scoreOf(m);
  const by = sideTeam(m, m.forfeit?.by === 'a' ? 'a' : 'b') as D.Team;
  const row = D.standings(by.division).find((r) => r.team.slug === by.slug);
  const body = html`
  ${matchHero({ stage: `${divName(m.division)} · ${t('week')} ${m.week}`, sub: 'LFR · Saison 3 · BO1', a: m.a, b: m.b, aSub: rankText(m.a), bSub: rankText(m.b), score: sc ? [sc.a, sc.b] : null, centrePill: statusPill(m), at: m.scheduledAt })}
  <div class="wrap">
    <div class="grid-main section">
      <div class="stack">
        <div class="callout warn"><strong>Forfait de ${by.name}</strong>${by.name} ne s’est pas présenté à l’horaire convenu (${m.scheduledAt ? D.when(m.scheduledAt) : ''}). Forfait enregistré par le staff le ${D.when(m.validatedAt ?? D.NOW)}. Score de forfait : 7–0, un réglage de la saison ; l’équipe présente ne perd rien à la différence de manches.</div>
        <div>${sectionHead('Conséquences')}
          <table class="tbl"><tbody>
            <tr><th scope="row" style="font-weight:500;color:var(--text-2)">Classement</th><td>Victoire et 3 points pour ${(by === m.a ? m.b : m.a).name}, défaite pour ${by.name} ; match compté comme joué pour les deux.</td></tr>
            <tr><th scope="row" style="font-weight:500;color:var(--text-2)">Forfaits de ${by.tag}</th><td><b>${row?.forfeits ?? 2}</b> cette saison · ${pill('Avertissement', 'warn')} au 2e, exclusion automatique au 3e.</td></tr>
            <tr><th scope="row" style="font-weight:500;color:var(--text-2)">Stats</th><td class="muted">Aucune : pas de carte jouée.</td></tr>
          </tbody></table></div>
      </div>
      <aside class="panel"><p class="kicker">Qui peut enregistrer un forfait</p><p style="margin-top:6px">Le staff uniquement. Une équipe ne peut jamais déclarer une victoire par forfait elle-même.</p></aside>
    </div>
  </div>`;
  return page({ title: `${m.a.name} – ${m.b.name} (forfait)`, comp: 'lfr', crumbs: crumbsFor(m), body });
}

export function matchDisputed(m: D.Match): Raw {
  const rep = m.reported as NonNullable<D.Match['reported']>;
  const dis = m.disputed as NonNullable<D.Match['disputed']>;
  const body = html`
  ${matchHero({ stage: `${divName(m.division)} · ${t('week')} ${m.week} · prolongation`, sub: 'LFR · Saison 3 · BO1', a: m.a, b: m.b, aSub: rankText(m.a), bSub: rankText(m.b), centrePill: html`<div class="d3 disp dim" style="margin-bottom:6px">${rep.score[0]}–${rep.score[1]}</div>${pill(t('stDisputed'), 'danger', 'alert')}`, at: m.scheduledAt })}
  <div class="wrap">
    <div class="grid-main section">
      <div class="stack">
        <div class="callout danger"><strong>Résultat contesté : en attente du staff</strong>${sideTeam(m, rep.by)?.name} a déclaré ${rep.score[0]}–${rep.score[1]} ; ${sideTeam(m, dis.by)?.name} a contesté. Le staff tranche : valider, rejeter, annuler ou saisir un autre résultat. Le motif de la contestation n’est visible que par le staff.</div>
        <div>${sectionHead('Historique')}
          <ol class="steps">
            <li class="step"><span class="n">1</span><span class="act">${D.time(m.scheduledAt ?? 0)}</span><span class="who">Match joué (${D.day(m.scheduledAt ?? 0)})</span><span></span></li>
            <li class="step"><span class="n">2</span><span class="act">${D.time(rep.at)}</span><span class="who">${badge(sideTeam(m, rep.by) as D.Team, 18)} Résultat déclaré : ${rep.score[0]}–${rep.score[1]}, capture jointe</span><span>${pill('Déclaré', 'pending')}</span></li>
            <li class="step"><span class="n">3</span><span class="act">${D.time(dis.at)}</span><span class="who">${badge(sideTeam(m, dis.by) as D.Team, 18)} Contestation</span><span>${pill('Contesté', 'danger')}</span></li>
            <li class="step todo"><span class="n">4</span><span class="act">—</span><span class="who">Décision du staff</span><span class="dim">en attente depuis ${D.relative(dis.at).replace('il y a ', '')}</span></li>
          </ol></div>
        <p class="muted">Tant que le staff n’a pas tranché, ce match ne compte pas au classement.</p>
      </div>
      <aside class="panel"><p class="kicker">Stats</p><p style="margin-top:6px">Les replays envoyés seront rattachés au résultat retenu. Aucune stat n’est publiée avant.</p></aside>
    </div>
  </div>`;
  return page({ title: `${m.a.name} – ${m.b.name} (contesté)`, comp: 'lfr', crumbs: crumbsFor(m), body });
}

// ---------------------------------------------------------------------------------------------
// Cup BO3: one tab per game, each tab its own URL.

export function cupMatch(gameN: number): Raw {
  const cm = D.featured.cupBo3;
  const a = (cm.a as D.CupSeed).team;
  const b = (cm.b as D.CupSeed).team;
  const g = cm.games[gameN - 1] as D.CupGame;
  const sim = g.sim as D.GameSim;
  const files = ['match-cup-bo3.html', 'match-cup-bo3-g2.html', 'match-cup-bo3-g3.html'];
  const routes = [`/matches/${cm.id}`, `/matches/${cm.id}/games/2`, `/matches/${cm.id}/games/3`];
  void files;
  const series = cm.series as [number, number];
  const body = html`
  ${matchHero({
    stage: 'Coupe de France · Quarts de finale',
    sub: 'LFR · Saison 3 · BO3',
    a, b,
    aSub: `Tête de série 1 · L1 1er`,
    bSub: `Tête de série 9 · L2 1er`,
    score: series,
    centrePill: pill(t('stValidated'), 'done', 'check'),
    at: cm.at,
  })}
  <div class="wrap section">
    <nav class="game-tabs" aria-label="Cartes">${cm.games.map((x, i) => html`<a href="${href(routes[i] as string)}" ${i === gameN - 1 ? raw('aria-current="page"') : ''}>Carte ${x.n} · ${x.map} <small>${x.score?.[0]}–${x.score?.[1]}</small></a>`)}</nav>
    <div class="grid-main">
      <div>
        ${sectionHead(`Carte ${g.n} · ${g.map}`, { small: g.pickedBy ? `choix de ${(g.pickedBy === 'a' ? a : b).tag}` : 'carte décisive' })}
        <div class="figures"><div class="figure"><b>${g.score?.[0]}–${g.score?.[1]}</b><span>${(g.score as [number, number])[0] > (g.score as [number, number])[1] ? a.name : b.name}</span>${sim.overtime ? html`<small>prolongation</small>` : ''}</div>
        <div class="figure"><b>${g.startSide ? (g.startSide.team === 'a' ? a : b).tag : '—'}</b><span>commence en ${g.startSide?.side === 'atk' ? 'attaque' : 'défense'}</span><small>choix de l’adversaire du pick</small></div></div>
      </div>
      <aside>${sectionHead('Veto BO3')}<div class="veto-line">${D.cupVetoQf1.filter((v) => v.action !== 'side' && v.action !== 'ot_side').map((v) => html`<span class="${v.action === 'ban' ? 'ban' : v.action === 'pick' ? 'pick' : 'dec'}">${v.team ? (v.team === 'a' ? a : b).tag : 'Décisive'} ${v.action === 'pick' ? 'pick ' : ''}${v.map}</span>`)}</div><p class="note"><a href="${href(`/matches/${cm.id}/veto`)}">Veto complet et côtés ${icon('chevronRight', 12)}</a></p></aside>
    </div>
    <section class="section">${sectionHead('Tableau des joueurs', { small: `carte ${g.n}` })}
      ${sourceBadge(g.stats, `${sim.rounds.length}/${sim.rounds.length} rounds`)}
      <div class="stack" style="margin-top:var(--s4)">
        ${scoreboard(sim.rounds, 'a', a, g.stats, sim.scoreA > sim.scoreB, sim.scoreA)}
        ${scoreboard(sim.rounds, 'b', b, g.stats, sim.scoreB > sim.scoreA, sim.scoreB)}
      </div>
    </section>
    <section class="section">${sectionHead('Rounds')}${roundTimeline(sim, a, b)}</section>
  </div>`;
  return page({ title: `${a.name} ${series[0]}–${series[1]} ${b.name} · carte ${gameN}`, comp: 'lfr', crumbs: [[t('home'), '/'], ['LFR', '/c/lfr/s3'], ['Coupe de France', '/c/lfr/s3/bracket'], ['Quarts de finale', null]], body });
}

// ---------------------------------------------------------------------------------------------
// Veto.

const MAP_DONE = (m: D.Match, steps: D.VetoStep[], map: string) => steps.find((s) => s.map === map && (s.action === 'ban' || s.action === 'decider'));

function poolGrid(m: D.Match, steps: D.VetoStep[], myTurn: boolean): Raw {
  return html`<div class="pool">${D.MAP_POOL.map((map) => {
    const st = MAP_DONE(m, steps, map);
    if (st?.action === 'ban') {
      return html`<div class="mapt banned"><span class="mname">${map}</span><span class="mstate">Ban ${st.seq} · ${sideTeam(m, st.team)?.tag}${st.timedOut ? html` ${pill('au hasard', 'warn', 'timer')}` : ''}</span></div>`;
    }
    if (st?.action === 'decider') return html`<div class="mapt played" style="--maptone:${mapTone(map)}"><span class="mname">${map}</span><span class="mstate">${icon('check', 14)} Carte jouée</span></div>`;
    return html`<div class="mapt available" style="--maptone:${mapTone(map)}"><span class="mname">${map}</span>${myTurn ? html`<span class="choose" role="button" tabindex="0">Bannir</span>` : html`<span class="mstate">Disponible</span>`}</div>`;
  })}</div>`;
}

export function vetoPage(state: 'live' | 'done'): Raw {
  const m = F.toPlay;
  const steps = state === 'live' ? m.veto : D.finishedVetoOf(m);
  const turnTeam = sideTeam(m, m.sideChooser) as D.Team;
  const viewer = state === 'live' ? D.viewers.official : null;
  const played = steps.find((s) => s.action === 'decider');
  const side = steps.find((s) => s.action === 'side');
  const ot = steps.find((s) => s.action === 'ot_side');
  const body = html`
  <section class="hero" style="padding-bottom:var(--s4)"><div class="wrap">
    <p class="stage">Veto · ${divName(m.division)} · ${t('week')} ${m.week}</p>
    <div class="duel" style="margin-top:var(--s3)">
      <a class="team" href="${href(teamRoute(m.a))}" style="--team:${teamColor(m.a)}">${badge(m.a, 64)}<span class="tname" style="font-size:var(--fs-d4)">${m.a.name}</span><span class="tsub">Hôte · côté en prolongation</span></a>
      <div class="centre"><div class="vs">VS</div><p class="kicker" style="margin-top:6px">BO1 · ${D.timeZ(m.scheduledAt as number)}</p></div>
      <a class="team" href="${href(teamRoute(m.b))}" style="--team:${teamColor(m.b)}">${badge(m.b, 64)}<span class="tname" style="font-size:var(--fs-d4)">${m.b.name}</span><span class="tsub">Premier ban · choix du côté</span></a>
    </div>
  </div></section>
  <div class="wrap section">
    ${
      state === 'live'
        ? html`<div class="turn" role="status">
        <div><p class="kicker" style="color:inherit;opacity:.85">Étape 5 sur 9 · à vous</p><p class="disp">${turnTeam.name} bannit une carte</p><p style="font-size:var(--fs-s);margin-top:4px">Sans choix à la fin du minuteur, une carte restante est bannie au hasard.</p></div>
        <div class="timer" aria-label="Temps restant 2 minutes 47">2:47<small>sur 4:00</small></div>
        <div class="timer-track"><i style="width:70%"></i></div>
      </div>`
        : html`<div class="turn" style="grid-template-columns:auto minmax(0,1fr) auto">
        <div style="width:120px;height:72px;background:${mapTone(played?.map ?? '')}" aria-hidden="true"></div>
        <div><p class="kicker" style="color:inherit;opacity:.85">Veto terminé à 20:52 · carte jouée</p><p class="disp">${played?.map}</p></div>
        <div style="text-align:right;font-size:var(--fs-s)"><b>${sideTeam(m, side?.team ?? null)?.tag}</b> commence en ${side?.side === 'atk' ? 'attaque' : 'défense'}<br><b>${sideTeam(m, ot?.team ?? null)?.tag}</b> : ${ot?.side === 'atk' ? 'attaque' : 'défense'} en prolongation</div>
      </div>`
    }
    <div class="grid-main section">
      <div>${sectionHead('Pool de cartes', { small: '9 cartes · saison 3' })}${poolGrid(m, steps, state === 'live')}
        <p class="note">Les vignettes sont des aplats de couleur : pas d’illustration Ubisoft. La page interroge le serveur toutes les 3 s et ne reçoit rien tant que le veto n’avance pas.</p></div>
      <aside>${sectionHead('Séquence BO1')}${vetoSteps(m, steps, 11, state === 'live' ? 5 : null)}
        <p class="note">A ban, B ban… jusqu’à une carte. ${m.b.tag} (moins bien classé) bannit en premier et choisit le côté de départ ; ${m.a.tag} choisit le côté en prolongation.</p></aside>
    </div>
  </div>`;
  return page({ title: `Veto ${m.a.tag} – ${m.b.tag}`, comp: 'lfr', viewer, crumbs: [...crumbsFor(m).slice(0, -1), [`${m.a.tag} – ${m.b.tag}`, `/matches/${m.id}`], ['Veto', null]], body });
}

export function vetoBo3(): Raw {
  const cm = F.cupBo3;
  const a = (cm.a as D.CupSeed).team;
  const b = (cm.b as D.CupSeed).team;
  const tm = (s: 'a' | 'b' | null) => (s === 'a' ? a : s === 'b' ? b : null);
  const actLabel: Record<string, string> = { ban: 'Ban', pick: 'Pick', decider: 'Décisive', side: 'Côté de départ', ot_side: 'Côté en prolongation' };
  const games = [1, 2, 3].map((n) => {
    const mapStep = n === 3 ? D.cupVetoQf1.find((v) => v.action === 'decider') : D.cupVetoQf1.filter((v) => v.action === 'pick')[n - 1];
    const sideStep = D.cupVetoQf1.find((v) => v.action === 'side' && 'game' in v && v.game === n);
    const otStep = D.cupVetoQf1.find((v) => v.action === 'ot_side' && 'game' in v && v.game === n);
    return { n, map: mapStep?.map as string, picker: mapStep?.team ?? null, side: sideStep, ot: otStep };
  });
  const body = html`
  <section class="hero" style="padding-bottom:var(--s4)"><div class="wrap">
    <p class="stage">Veto · Coupe de France · Quarts de finale</p>
    <div class="duel" style="margin-top:var(--s3)">
      <a class="team" href="${href(teamRoute(a))}" style="--team:${teamColor(a)}">${badge(a, 64)}<span class="tname" style="font-size:var(--fs-d4)">${a.name}</span><span class="tsub">Équipe A : premier ban (tirage au sort)</span></a>
      <div class="centre"><div class="vs">VS</div><p class="kicker" style="margin-top:6px">BO3 · terminé</p></div>
      <a class="team" href="${href(teamRoute(b))}" style="--team:${teamColor(b)}">${badge(b, 64)}<span class="tname" style="font-size:var(--fs-d4)">${b.name}</span><span class="tsub">Équipe B</span></a>
    </div>
  </div></section>
  <div class="wrap section">
    <div class="grid-3">${games.map((g) => html`<div class="mapt played" style="--maptone:${mapTone(g.map)};min-height:150px">
      <span class="kicker" style="color:inherit">Carte ${g.n} · ${g.picker ? `pick ${tm(g.picker)?.tag}` : 'décisive'}</span>
      <span class="mname" style="font-size:36px">${g.map}</span>
      <span class="mstate">${tm(g.side?.team ?? null)?.tag} : ${g.side && 'side' in g.side && g.side.side === 'atk' ? 'attaque' : 'défense'} au départ · ${tm(g.ot?.team ?? null)?.tag} : ${g.ot && 'side' in g.ot && g.ot.side === 'atk' ? 'attaque' : 'défense'} en prol.${g.side && 'coin' in g.side ? ' · tirage au sort' : ''}</span>
    </div>`)}</div>
    <div class="grid-2 section">
      <div>${sectionHead('Séquence BO3', { small: '15 étapes' })}
        <ol class="steps">${D.cupVetoQf1.map((v) => html`<li class="step"><span class="n">${v.seq}</span><span class="act">${actLabel[v.action]}</span><span class="who">${tm(v.team) ? html`${badge(tm(v.team) as D.Team, 20)} ${tm(v.team)?.tag}` : html`<span class="dim">Restante</span>`} · <b>${v.map}</b>${'side' in v ? html` · ${v.side === 'atk' ? 'Attaque' : 'Défense'}` : ''}</span><span>${'timedOut' in v && v.timedOut ? pill('Temps écoulé', 'warn', 'timer') : 'coin' in v && v.coin ? pill('Tirage au sort', 'info', 'coin') : ''}</span></li>`)}</ol></div>
      <div>${sectionHead('Règles du BO3')}
        <ul class="article" style="font-size:var(--fs-s)"><li>A ban, B ban, A ban, B ban, A pick, B pick, A ban, B ban ; la carte restante est la décisive.</li><li>Après chaque pick, l’adversaire du picker choisit le côté de départ, le picker le côté en prolongation.</li><li>Sur la décisive, un nouveau tirage au sort donne le choix du côté.</li><li>4 minutes par étape ; un ban sans réponse est tiré au hasard.</li></ul></div>
    </div>
  </div>`;
  return page({ title: `Veto ${a.tag} – ${b.tag} (BO3)`, comp: 'lfr', crumbs: [[t('home'), '/'], ['LFR', '/c/lfr/s3'], ['Coupe de France', '/c/lfr/s3/bracket'], [`${a.tag} – ${b.tag}`, `/matches/${cm.id}`], ['Veto', null]], body });
}

// ---------------------------------------------------------------------------------------------
// Replay, MOSS and screenshot upload.

export function upload(): Raw {
  const u = D.upload;
  const m = u.match;
  const me = D.player(u.uploader);
  const lineupA = D.starters(m.a);
  const lineupB = D.starters(m.b);
  const body = html`
  <div class="wrap">
    <header class="page-title"><p class="kicker">${divName(m.division)} · ${t('week')} ${m.week} · ${m.a.tag} – ${m.b.tag}</p><h1>Replays et MOSS</h1><p>Analysés dans votre navigateur ; les fichiers bruts partent ensuite vers le stockage, en arrière-plan. Ne fermez pas l’onglet avant la fin.</p></header>
    <div class="grid-main section">
      <div class="stack">
        <div>${sectionHead('1 · Dossiers', { small: 'MatchReplay' })}
          <table class="tbl"><thead><tr><th scope="col">Dossier</th><th scope="col" class="r">Fichiers</th><th scope="col" class="r hide-m">Taille</th><th scope="col">Fenêtre du match</th></tr></thead><tbody>
          ${u.folders.map((f) => html`<tr><th scope="row" style="font-weight:500"><code>${f.name}</code>${f.note ? html`<br><span class="note">${f.note}</span>` : ''}</th><td class="r">${f.files}</td><td class="r hide-m">${D.dec1(f.size)} Mo</td><td>${f.inWindow ? pill('Sélectionné', 'done', 'check') : pill('Ignoré', 'muted')}</td></tr>`)}
          </tbody></table></div>
        <div>${sectionHead('2 · Ce que les replays contiennent', { small: u.map })}
          <div class="grid-2">
            ${u.lobbies.map((l) => html`<div class="panel"><p class="kicker">Lobby ${l.n}${l.n === 2 ? ' · re-host' : ''}</p><p class="d3 disp" style="margin:6px 0">${m.a.tag} ${l.scoreA}–${l.scoreB} ${m.b.tag}</p>
              <div class="rounds" style="grid-template-columns:repeat(7,1fr)">${(l.rounds[0] as string[]).map((w, i) => html`<div class="rnd" style="--rc:${teamColor(w === 'a' ? m.a : m.b)}"><b>${i + 1}</b><span class="w">${(w === 'a' ? m.a : m.b).tag}</span></div>`)}${l.rounds[1] === 'interrupted' ? html`<div class="rnd void"><b>7</b>crash</div>` : ''}</div></div>`)}
          </div>
          <div class="callout" style="margin-top:var(--s3)"><strong>Total recousu : ${m.a.tag} 5–7 ${m.b.tag}</strong>Identique au score déclaré ce soir à 20:12. Le round 7 du lobby 1 est annulé (interrompu).</div>
        </div>
        <div>${sectionHead('3 · Joueurs reconnus', { small: 'par identifiant Ubisoft, jamais par pseudo' })}
          <div class="grid-2">
            ${[[m.a, lineupA], [m.b, lineupB]].map(([team, list]) => html`<table class="tbl"><thead><tr><th scope="col" colspan="2">${badge(team as D.Team, 18)} ${(team as D.Team).name}</th></tr></thead><tbody>
              ${(list as string[]).map((p) => html`<tr><th scope="row" style="font-weight:500">${flag(D.player(p).nat)} ${D.player(p).tag}</th><td class="r">${pill('Effectif', 'done', 'check')}</td></tr>`)}
              ${team === m.a ? u.unknown.map((x) => html`<tr><th scope="row" style="font-weight:500">${x.name} <span class="dim">${x.profile}</span></th><td class="r">${pill('Inconnu', 'danger', 'alert')}</td></tr>`) : ''}
            </tbody></table>`)}
          </div>
          <p class="note">Un joueur absent des effectifs est signalé au staff : jouer avec un joueur non inscrit est une irrégularité.</p>
        </div>
        <div>${sectionHead('4 · Envoi des fichiers', { small: '3 à la fois' })}
          <table class="tbl"><thead><tr><th scope="col">Fichier</th><th scope="col" class="r hide-m">Taille</th><th scope="col" style="width:45%">Progression</th><th scope="col" class="r">%</th></tr></thead><tbody>
          ${u.files.map((f) => html`<tr><th scope="row" style="font-weight:500"><code>${f.name}</code></th><td class="r hide-m">${D.dec1(f.size)} Mo</td><td><div class="progress"><i class="${f.progress === 1 ? 'done' : ''}" style="width:${Math.round(f.progress * 100)}%"></i></div></td><td class="r">${f.progress === 1 ? icon('check', 14, 'Envoyé') : D.pct(f.progress)}</td></tr>`)}
          </tbody></table></div>
      </div>
      <aside class="stack">
        <div class="panel"><p class="kicker">Connecté</p><p style="margin-top:4px"><b>${me.tag}</b> · ${m.b.name}</p></div>
        <div>${sectionHead('MOSS', { small: 'obligatoire' })}<div class="drop">${icon('upload', 22)}<strong>Déposer le fichier MOSS</strong>.zip · visible par le staff uniquement</div>
          <p class="note">${icon('check', 12)} Reçu pour ${m.a.tag} à 20:19. Votre équipe : en attente.</p></div>
        <div>${sectionHead('Capture du score')}<div class="drop">${icon('file', 22)}<strong>Capture déjà jointe</strong>PNG, 1,8 Mo · jamais publique</div></div>
        <div class="callout warn"><strong>Avant de fermer</strong>4 fichiers restent à envoyer. Le jeu supprime les replays au-delà de 12 : envoyez-les ce soir.</div>
      </aside>
    </div>
  </div>`;
  return page({ title: 'Replays et MOSS', comp: 'lfr', viewer: { name: me.tag, player: me.slug, team: m.b.slug, role: `Joueur, ${m.b.tag}` }, crumbs: [...crumbsFor(m).slice(0, -1), [`${m.a.tag} – ${m.b.tag}`, `/matches/${m.id}`], ['Envoi', null]], body });
}

export { signedCell };
