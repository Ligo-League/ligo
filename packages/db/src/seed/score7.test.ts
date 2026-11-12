import { describe, expect, it } from 'vitest';
import {
  score7MatchSchema,
  score7StandingSchema,
  score7TeamKey,
  tagResolver,
  toMatchRow,
  toStandingLines,
} from './score7.ts';

const TEAMS = [
  { division: 'Ligue 1', name: 'Greed Esport', tag: 'GREED1' },
  { division: 'Ligue 1', name: 'Outsouki', tag: 'OUTSOUKI' },
  { division: 'Ligue 1', name: 'NTS kastuki', tag: 'NTS' },
  { division: 'Ligue 2', name: 'Nova 1 Esport', tag: 'NOVA1' },
];
const resolve = tagResolver(TEAMS);

// One match as score7 answers it (Ligue 1, week 1), trimmed of nothing: extra fields must not
// break the schema.
const sample = (overrides: object) =>
  score7MatchSchema.parse({
    id: 116524925,
    timestamp: 1792958400,
    location: 'https://example.invalid/stream',
    referee: null,
    homePlaceholder: null,
    homeParticipant: { id: 22891369, name: 'GREED ESPORT (Paris)', logo: 'x.png', withdrawn: null },
    awayPlaceholder: null,
    awayParticipant: { id: 22891378, name: 'OUTSOUKI (Strasbourg)', logo: 'y.png' },
    homeScore: [7.0],
    awayScore: [1.0],
    outcome: '1',
    resultTimestamp: 1792961749,
    overridePoints: null,
    hasStats: false,
    ...overrides,
  });
const row = (overrides: object) => toMatchRow('Ligue 1', 1, sample(overrides), resolve);

describe('score7TeamKey', () => {
  it.each([
    ['GREED ESPORT (Paris)', 'greed-esport'],
    ['Greed Esport', 'greed-esport'],
    ["MIX N' CHILL (Marseille)", 'mix-n-chill'],
    ['NOVA ESPORT 1 (Cherbourg-En-Cotentin)', 'nova-esport-1'],
    ['IGURU ESPORT', 'iguru-esport'],
  ])('%j gives %j', (name, key) => {
    expect(score7TeamKey(name)).toBe(key);
  });
});

describe('tagResolver', () => {
  it('matches by name, ignoring case and the city', () => {
    expect(resolve('Ligue 1', 'OUTSOUKI (Strasbourg)')).toBe('OUTSOUKI');
  });

  it('falls back to the override list', () => {
    expect(resolve('Ligue 1', 'NOTSCAM KATSUKI (Carcassonne)')).toBe('NTS');
    expect(resolve('Ligue 2', 'NOVA ESPORT 1 (Cherbourg-En-Cotentin)')).toBe('NOVA1');
  });

  it('finds nothing for an unknown name or a team of another division', () => {
    expect(resolve('Ligue 1', 'UNKNOWN TEAM (Paris)')).toBeUndefined();
    expect(resolve('Ligue 2', 'OUTSOUKI (Strasbourg)')).toBeUndefined();
    expect(resolve('Ligue 1', 'NOVA ESPORT 1')).toBeUndefined();
  });
});

describe('toMatchRow', () => {
  const base = { division: 'Ligue 1', week: 1, teamA: 'GREED1', teamB: 'OUTSOUKI' };

  it.each([
    ['a home win', {}, { kind: 'played', scoreA: 7, scoreB: 1 }],
    [
      'an away win',
      { homeScore: [6], awayScore: [8], outcome: '2' },
      { kind: 'played', scoreA: 6, scoreB: 8 },
    ],
    [
      'a home walkover as a forfeit by the away team',
      { homeScore: [], awayScore: [], outcome: 'W1' },
      { kind: 'forfeit', forfeitBy: 'b' },
    ],
    [
      'an away walkover as a forfeit by the home team',
      { homeScore: [], awayScore: [], outcome: 'W2' },
      { kind: 'forfeit', forfeitBy: 'a' },
    ],
    [
      'a draw',
      { homeScore: [0], awayScore: [0], outcome: 'X' },
      { kind: 'draw', scoreA: 0, scoreB: 0 },
    ],
    ['an undecided match', { homeScore: [], awayScore: [], outcome: null }, { kind: 'none' }],
  ])('reads %s', (_name, overrides, result) => {
    expect(row(overrides)).toEqual({ ok: true, row: { ...base, result } });
  });

  it.each([
    ['an outcome that contradicts the score', { outcome: '2' }, 'does not fit the score 7-1'],
    ['a score without an outcome', { outcome: null }, 'a score without an outcome'],
    ['a walkover with a score', { outcome: 'W1' }, 'a walkover with a score'],
    ['a series', { homeScore: [7, 7], awayScore: [1, 2] }, 'expected one whole-number score'],
    ['a fractional score', { homeScore: [7.5] }, 'expected one whole-number score'],
    ['an unknown outcome', { outcome: 'A' }, 'unknown outcome "A"'],
    ['an unknown team', { awayParticipant: { name: 'NOBODY' } }, 'matches "NOBODY"'],
    ['an empty side', { awayParticipant: null }, 'a side has no team yet'],
  ])('refuses %s', (_name, overrides, message) => {
    const result = row(overrides);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: expect.stringContaining(message) as string });
    expect(result).toMatchObject({ error: expect.stringContaining('Ligue 1, week 1') as string });
  });
});

describe('toStandingLines', () => {
  const entry = (name: string, ranking: number, points: number) => ({
    participant: { id: 1, name, withdrawn: false },
    ranking,
    played: 6,
    wins: 5,
    draws: 0,
    losses: 1,
    scoreFor: 26,
    scoreAgainst: 15,
    scoreDifference: 11,
    points,
    averagePoints: 2.5,
  });

  it('lists teams by rank with their tag', () => {
    const standing = score7StandingSchema.parse({
      id: 1,
      columns: [],
      entries: [entry('OUTSOUKI (Strasbourg)', 2, 1), entry('GREED ESPORT (Paris)', 1, 15)],
    });
    expect(toStandingLines('Ligue 1', standing, resolve)).toEqual({
      ok: true,
      row: [
        ['Ligue 1', 1, 'GREED1', 6, 5, 0, 1, 26, 15, 11, 15],
        ['Ligue 1', 2, 'OUTSOUKI', 6, 5, 0, 1, 26, 15, 11, 1],
      ],
    });
  });

  it('refuses a team it cannot name', () => {
    const standing = score7StandingSchema.parse({ entries: [entry('NOBODY', 1, 0)] });
    expect(toStandingLines('Ligue 1', standing, resolve)).toMatchObject({ ok: false });
  });
});
