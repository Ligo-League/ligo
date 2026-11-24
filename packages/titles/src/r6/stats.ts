import type { Derived, Metric, StatValues, TitleStats } from '../stats.ts';

// Rainbow Six Siege's metrics (design doc section 9). The grid asks for what the in-game
// scoreboard shows; the rest comes only from replays with round detail (phase 5). The limits are
// what cannot happen: five players a side, one death a round, five kills at most a round.

/** A team on the map: also how many MOSS files each side owes (M-47). */
export const R6_PLAYERS_PER_SIDE = 5;
const PLAYERS_PER_SIDE = R6_PLAYERS_PER_SIDE;

/** A value the other limits read, when the player entered it as a whole number. */
const known = (values: StatValues, key: string): number | null => {
  const value = values[key] ?? null;
  return value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
};
const perRound = (count: number) => (_ctx: unknown, values: StatValues) => {
  const rounds = known(values, 'rounds_played');
  return rounds === null ? null : rounds * count;
};

const replayOnly = (key: string, fr: string, en: string): Metric => ({
  key,
  label: { fr, en },
  manual: false,
  requiresRounds: true,
});

const metrics: Metric[] = [
  {
    key: 'rounds_played',
    label: { fr: 'Manches jouées', en: 'Rounds played' },
    manual: true,
    max: (ctx) => ctx.rounds,
    sideMax: (ctx) => ctx.rounds * PLAYERS_PER_SIDE,
  },
  { key: 'kills', label: { fr: 'Kills', en: 'Kills' }, manual: true, max: perRound(5) },
  { key: 'deaths', label: { fr: 'Morts', en: 'Deaths' }, manual: true, max: perRound(1) },
  { key: 'assists', label: { fr: 'Assists', en: 'Assists' }, manual: true, max: perRound(5) },
  {
    key: 'headshots',
    label: { fr: 'Headshots', en: 'Headshots' },
    manual: true,
    optional: true,
    max: (_ctx, values) => known(values, 'kills'),
  },
  replayOnly('rounds_kost', 'Manches KOST', 'KOST rounds'),
  replayOnly('rounds_survived', 'Manches survécues', 'Rounds survived'),
  replayOnly('opening_kills', 'Premiers kills', 'Opening kills'),
  replayOnly('opening_deaths', 'Premières morts', 'Opening deaths'),
  replayOnly('trade_kills', 'Kills d’échange', 'Trade kills'),
  replayOnly('traded_deaths', 'Morts échangées', 'Traded deaths'),
  replayOnly('clutch_attempts', 'Clutchs tentés', 'Clutch attempts'),
  replayOnly('clutch_wins', 'Clutchs gagnés', 'Clutch wins'),
  replayOnly('plants', 'Poses du désamorceur', 'Plants'),
  replayOnly('defuses', 'Désamorçages', 'Defuses'),
];

/** A ratio, or null when its denominator is zero. */
const ratio = (top: number | undefined, bottom: number | undefined) =>
  top === undefined || bottom === undefined || bottom === 0 ? null : top / bottom;
const difference = (x: number | undefined, y: number | undefined) =>
  x === undefined || y === undefined ? null : x - y;

const derived: Derived[] = [
  {
    key: 'kd',
    label: { fr: 'K/D', en: 'K/D' },
    needs: ['kills', 'deaths'],
    // Kills alone when the player never died.
    compute: (t) => (t.deaths === 0 ? (t.kills ?? null) : ratio(t.kills, t.deaths)),
    format: 'ratio',
  },
  {
    key: 'kpr',
    label: { fr: 'Kills par manche', en: 'KPR' },
    needs: ['kills', 'rounds_played'],
    compute: (t) => ratio(t.kills, t.rounds_played),
    format: 'ratio',
  },
  {
    key: 'hs',
    label: { fr: 'HS %', en: 'HS%' },
    needs: ['headshots', 'kills'],
    compute: (t) => ratio(t.headshots, t.kills),
    format: 'percent',
  },
  {
    key: 'srv',
    label: { fr: 'Survie', en: 'SRV' },
    needs: ['rounds_survived', 'rounds_played'],
    compute: (t) => ratio(t.rounds_survived, t.rounds_played),
    format: 'percent',
  },
  {
    key: 'kost',
    label: { fr: 'KOST', en: 'KOST' },
    needs: ['rounds_kost', 'rounds_played'],
    compute: (t) => ratio(t.rounds_kost, t.rounds_played),
    format: 'percent',
  },
  {
    key: 'entry',
    label: { fr: 'Entrée', en: 'Entry' },
    needs: ['opening_kills', 'opening_deaths'],
    compute: (t) => difference(t.opening_kills, t.opening_deaths),
    format: 'signed',
  },
  {
    key: 'trade_diff',
    label: { fr: 'Échanges', en: 'Trade diff' },
    needs: ['trade_kills', 'traded_deaths'],
    compute: (t) => difference(t.trade_kills, t.traded_deaths),
    format: 'signed',
  },
  {
    key: 'clutch',
    label: { fr: 'Clutch %', en: 'Clutch %' },
    needs: ['clutch_wins', 'clutch_attempts'],
    compute: (t) => ratio(t.clutch_wins, t.clutch_attempts),
    format: 'percent',
  },
];

export const R6_STATS: TitleStats = {
  metrics,
  derived,
  crossCheck: { kills: 'kills', deaths: 'deaths' },
};
