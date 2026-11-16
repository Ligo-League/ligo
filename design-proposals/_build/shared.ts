// Match and standings vocabulary shared by the three proposals: what a status is called, how a
// score reads, which tone it takes. Each proposal decides how a tone looks.

import * as D from '../_data/index.ts';
import { t } from './i18n.ts';

export type Tone = 'done' | 'pending' | 'warn' | 'danger' | 'muted' | 'live' | 'info';

export interface StatusView {
  key: D.MatchStatus | 'auto' | 'veto' | 'live';
  label: string;
  tone: Tone;
  /** Short text for a narrow column. */
  short: string;
}

export function statusOf(m: D.Match): StatusView {
  switch (m.status) {
    case 'validated':
      return { key: 'validated', label: t('stValidated'), tone: 'done', short: 'Validé' };
    case 'forfeit':
      return { key: 'forfeit', label: m.forfeit?.reason === 'exclusion' ? 'Forfait (exclusion)' : `${t('stForfeit')} (W.O.)`, tone: 'warn', short: 'W.O.' };
    case 'void':
      return { key: 'void', label: t('stVoid'), tone: 'muted', short: 'Annulé' };
    case 'no_result':
      return { key: 'no_result', label: t('stNoResult'), tone: 'muted', short: '—' };
    case 'reported':
      return { key: 'reported', label: t('stReported'), tone: 'pending', short: 'Déclaré' };
    case 'disputed':
      return { key: 'disputed', label: t('stDisputed'), tone: 'danger', short: 'Contesté' };
    case 'proposed':
      return { key: 'proposed', label: t('stProposed'), tone: 'info', short: 'Proposé' };
    case 'scheduled':
      if (m.vetoState === 'in_progress') return { key: 'veto', label: t('stVeto'), tone: 'live', short: 'Veto' };
      if (m.autoScheduled) return { key: 'auto', label: t('stAuto'), tone: 'info', short: 'Auto' };
      return { key: 'scheduled', label: t('stScheduled'), tone: 'info', short: 'Prog.' };
    default:
      return { key: 'to_schedule', label: t('stToSchedule'), tone: 'muted', short: 'À planifier' };
  }
}

/** "7–1", "W.O. 7–0", or null when nothing is final. Always from side A's view. */
export function scoreOf(m: D.Match): { a: number; b: number; winner: 'a' | 'b'; forfeit: boolean } | null {
  if (m.status === 'validated' && m.score) return { a: m.score[0], b: m.score[1], winner: m.score[0] > m.score[1] ? 'a' : 'b', forfeit: false };
  if (m.status === 'forfeit' && m.forfeit && m.forfeit.by !== 'both') {
    const winner = m.forfeit.by === 'a' ? 'b' : 'a';
    return winner === 'a' ? { a: 7, b: 0, winner, forfeit: true } : { a: 0, b: 7, winner, forfeit: true };
  }
  return null;
}

export const otherSide = (s: 'a' | 'b'): 'a' | 'b' => (s === 'a' ? 'b' : 'a');
export const sideTeam = (m: D.Match, s: 'a' | 'b') => (s === 'a' ? m.a : m.b);

/** "Ligue 1 · Semaine 6" */
export function matchContext(m: D.Match): string {
  const div = m.division === 'ligue-1' ? 'Ligue 1' : 'Ligue 2';
  return `${div} · ${t('week')} ${m.week}${m.extension ? ` · ${t('stExtension').toLowerCase()}` : ''}`;
}

/** The time line under a match: agreed time, proposal, or what is missing. */
export function timeLine(m: D.Match): string {
  if (m.status === 'proposed' && m.proposal) return `Proposé : ${D.when(m.proposal.at)} (par ${sideTeam(m, m.proposal.by).tag})`;
  if (m.scheduledAt) return D.when(m.scheduledAt);
  if (m.status === 'to_schedule') return `À planifier avant le ${D.dateShort(D.weekRange(m.week).end)}`;
  return '';
}

export const winConditionLabel: Record<D.WinCondition, string> = {
  elimination: 'Élimination',
  defuser: 'Désamorceur',
  time: 'Temps écoulé',
  disable: 'Désamorceur coupé',
};

export const sourceLabel: Record<D.StatsSource, { label: string; short: string; tone: Tone; note: string }> = {
  replay_verified: { label: 'Replay vérifié', short: 'Replay ✓', tone: 'done', note: 'Stats tirées des replays, re-parsés par le serveur : identiques.' },
  replay_unverified: { label: 'Replay non vérifié', short: 'Replay', tone: 'pending', note: 'Stats tirées des replays analysés dans le navigateur ; la vérification par le serveur est en attente.' },
  manual: { label: 'Saisie manuelle', short: 'Manuel', tone: 'info', note: 'Kills, morts, assistances et headshots saisis par les équipes. KOST, entry, clutchs et plants demandent un replay.' },
  none: { label: 'Pas de stats', short: '—', tone: 'muted', note: 'Aucun replay ni feuille de stats pour ce match.' },
};

export const zoneKeyLabel = (z: Exclude<D.Zone, null>): string =>
  ({
    champion: t('zoneChampion'),
    promotion: t('zonePromotion'),
    barrage_promotion: t('zoneBarragePromotion'),
    barrage_relegation: t('zoneBarrageRelegation'),
    relegation: t('zoneRelegation'),
  })[z];

/** Zones present in a table, in legend order. */
export function zonesIn(rows: D.StandingRow[]): Exclude<D.Zone, null>[] {
  const order: Exclude<D.Zone, null>[] = ['champion', 'promotion', 'barrage_promotion', 'barrage_relegation', 'relegation'];
  return order.filter((z) => rows.some((r) => r.zone === z));
}

export const divisionName = (slug: string) =>
  ({ 'ligue-1': 'Ligue 1', 'ligue-2': 'Ligue 2', 'division-1': 'Division 1', open: 'Classement joueurs' })[slug] ?? slug;

/** Matches of a division and week, sorted by time then name. */
export function weekMatches(division: string, week: number): D.Match[] {
  return D.matches
    .filter((m) => m.division === division && m.week === week && m.stage === 'league')
    .sort((x, y) => (x.scheduledAt ?? Infinity) - (y.scheduledAt ?? Infinity) || x.a.name.localeCompare(y.a.name));
}

/** Matches played or to be played on a calendar day (Paris), across divisions. */
export const matchesOn = (day: number) => D.matches.filter((m) => m.scheduledAt && D.sameDay(m.scheduledAt, day));

/** The previous validated results, newest first. */
export const latestResults = (n = 8, division?: string) =>
  D.matches
    .filter((m) => (m.status === 'validated' || (m.status === 'forfeit' && m.forfeit?.reason === 'no_show')) && (!division || m.division === division) && (m.validatedAt ?? 0) <= D.NOW)
    .sort((x, y) => (y.validatedAt ?? 0) - (x.validatedAt ?? 0))
    .slice(0, n);

/** Matches of the current week (6) and the extension matches played in it. */
export const thisWeek = (division?: string) =>
  D.matches.filter((m) => (m.week === 6 || (m.extension && m.week === 5)) && (!division || m.division === division));

/** Default fallbacks: an unbuilt page of a kind links to the example of that kind. */
export function defaultFallbacks(): [RegExp, string][] {
  return [
    [/^\/teams\/[^/]+\/workspace/, '/teams/greed-esport/workspace'],
    [/^\/teams\/[^/]+$/, '/teams/greed-esport'],
    [/^\/players\/[^/]+$/, '/players/vexo'],
    [/^\/clubs\/[^/]+$/, '/clubs/w-mates'],
    [/^\/matches\/\d+\/veto$/, `/matches/${D.featured.toPlay.id}/veto`],
    [/^\/matches\/\d+$/, `/matches/${D.featured.played.id}`],
    [/^\/c\/lfr\/s3\/standings/, '/c/lfr/s3/standings/ligue-1'],
  ];
}
