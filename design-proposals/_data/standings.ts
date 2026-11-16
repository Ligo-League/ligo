// Standings computed from matches, never typed: 3 points a win, forfeit 7–0, rank by points then
// Diff, shared rank when both tie, excluded teams last as "Exclue", sanctions as point deltas.

import { EXCLUDED, SANCTIONS, matches, type Match } from './matches.ts';
import { teams, type Team } from './teams.ts';

export type Zone = 'champion' | 'promotion' | 'barrage_promotion' | 'barrage_relegation' | 'relegation' | null;
export type FormResult = { result: 'W' | 'L'; forfeit: boolean; match: number; label: string };

export interface StandingRow {
  team: Team;
  rank: number;
  shared: boolean;
  /** Places gained since last week (positive is up); null for no previous table. */
  change: number | null;
  played: number;
  wins: number;
  losses: number;
  roundsWon: number;
  roundsLost: number;
  diff: number;
  points: number;
  sanction: number;
  excluded: boolean;
  zone: Zone;
  form: FormResult[];
  forfeits: number;
}

const FORFEIT_SCORE: [number, number] = [7, 0];
const POINTS_WIN = 3;

function outcome(m: Match): { a: number; b: number; winner: 'a' | 'b'; forfeit: boolean } | null {
  if (m.status === 'validated' && m.score) {
    return { a: m.score[0], b: m.score[1], winner: m.score[0] > m.score[1] ? 'a' : 'b', forfeit: false };
  }
  if (m.status === 'forfeit' && m.forfeit && m.forfeit.by !== 'both') {
    const winner = m.forfeit.by === 'a' ? 'b' : 'a';
    return winner === 'a'
      ? { a: FORFEIT_SCORE[0], b: FORFEIT_SCORE[1], winner, forfeit: true }
      : { a: FORFEIT_SCORE[1], b: FORFEIT_SCORE[0], winner, forfeit: true };
  }
  return null;
}

/** Zones follow the promotion rule and the divisions that exist (design doc section 11). */
function zoneOf(place: number, size: number, division: string): Zone {
  if (division === 'ligue-1') {
    if (place === 1) return 'champion';
    if (place > size - 2) return 'relegation';
    if (place === size - 2) return 'barrage_relegation';
    return null;
  }
  if (division === 'ligue-2') {
    if (place <= 2) return 'promotion';
    if (place === 3) return 'barrage_promotion';
    return null; // nothing below Ligue 2: no relegation
  }
  if (place === 1) return 'champion';
  return null;
}

export function computeStandings(division: string, upToWeek = 99): StandingRow[] {
  const divTeams = teams.filter((t) => t.competition === 'lfr' && t.division === division);
  const rows = new Map<string, StandingRow>();
  for (const t of divTeams) {
    rows.set(t.slug, {
      team: t, rank: 0, shared: false, change: null, played: 0, wins: 0, losses: 0, roundsWon: 0,
      roundsLost: 0, diff: 0, points: 0, sanction: 0, excluded: !!EXCLUDED[t.slug], zone: null, form: [], forfeits: 0,
    });
  }
  const ms = matches
    .filter((m) => m.division === division && m.stage === 'league' && m.week <= upToWeek)
    .sort((x, y) => x.week - y.week || (x.scheduledAt ?? 0) - (y.scheduledAt ?? 0));
  for (const m of ms) {
    const o = outcome(m);
    if (!o) continue;
    const ra = rows.get(m.a.slug) as StandingRow;
    const rb = rows.get(m.b.slug) as StandingRow;
    for (const [row, mine, theirs, side] of [[ra, o.a, o.b, 'a'], [rb, o.b, o.a, 'b']] as const) {
      row.played++;
      row.roundsWon += mine;
      row.roundsLost += theirs;
      const won = o.winner === side;
      if (won) {
        row.wins++;
        row.points += POINTS_WIN;
      } else {
        row.losses++;
        if (o.forfeit && m.forfeit?.reason === 'no_show') row.forfeits++;
      }
      const opp = side === 'a' ? m.b : m.a;
      row.form.push({ result: won ? 'W' : 'L', forfeit: o.forfeit, match: m.id, label: `S${m.week} · ${opp.tag} ${mine}–${theirs}` });
    }
  }
  for (const s of SANCTIONS) {
    const row = rows.get(s.team);
    if (row && s.division === division) {
      row.points += s.points;
      row.sanction += s.points;
    }
  }
  const list = [...rows.values()];
  for (const r of list) {
    r.diff = r.roundsWon - r.roundsLost;
    r.form = r.form.slice(-5);
  }
  list.sort(
    (x, y) =>
      Number(x.excluded) - Number(y.excluded) || y.points - x.points || y.diff - x.diff || x.team.name.localeCompare(y.team.name),
  );
  let place = 0;
  list.forEach((r, i) => {
    place = i + 1;
    const prev = list[i - 1];
    if (prev && !r.excluded && !prev.excluded && prev.points === r.points && prev.diff === r.diff) {
      r.rank = prev.rank;
      r.shared = true;
      prev.shared = true;
    } else {
      r.rank = place;
    }
    r.zone = zoneOf(place, list.length, division);
  });
  return list;
}

/** The table with rank change since the previous week (the latest week with a counted result). */
export function standings(division: string, currentWeek = 6): StandingRow[] {
  const now = computeStandings(division);
  const before = computeStandings(division, currentWeek - 1);
  const prevRank = new Map(before.map((r) => [r.team.slug, r.rank]));
  for (const r of now) {
    const p = prevRank.get(r.team.slug);
    r.change = r.excluded || p === undefined ? null : p - r.rank;
  }
  return now;
}

export const ZONE_LABELS: Record<Exclude<Zone, null>, { label: string; short: string; mark: string }> = {
  champion: { label: 'Champion', short: 'Champion', mark: 'C' },
  promotion: { label: 'Montée en Ligue 1', short: 'Montée', mark: 'M' },
  barrage_promotion: { label: 'Barrage de montée', short: 'Barrage', mark: 'B' },
  barrage_relegation: { label: 'Barrage de maintien', short: 'Barrage', mark: 'B' },
  relegation: { label: 'Descente en Ligue 2', short: 'Descente', mark: 'D' },
};
