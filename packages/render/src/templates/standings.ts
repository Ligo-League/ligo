import { box, text, type ImageNode, type Style } from '../node.ts';
import { resolveTheme, type ThemeOverrides } from '../theme.ts';

export const STANDINGS_IMAGE_WIDTH = 1200;
/** Part of the cache key: raise it whenever the picture changes for the same input. */
export const STANDINGS_TEMPLATE_VERSION = 1;

export interface StandingsImageRow {
  rank: number;
  name: string;
  /** The team's colours as #RRGGBB; the first two are shown. */
  colors: readonly string[];
  played: number;
  wins: number;
  losses: number;
  scoreFor: number;
  scoreAgainst: number;
  diff: number;
  points: number;
  /** Latest results, oldest first. */
  form: readonly ('W' | 'L')[];
}

export interface StandingsImageInput {
  /** The division, e.g. "Ligue 1". */
  title: string;
  /** The competition and season, e.g. "LFR · Saison 3". */
  subtitle: string;
  /** Column labels, already translated: this package holds no user-facing text. */
  headers: {
    rank: string;
    team: string;
    played: string;
    wins: string;
    losses: string;
    for: string;
    against: string;
    diff: string;
    points: string;
    form: string;
  };
  rows: readonly StandingsImageRow[];
  theme?: ThemeOverrides;
}

const NUMBER_WIDTH = 68;
const FORM_SLOTS = 5;
const signed = (value: number) => (value > 0 ? `+${value}` : String(value));
const right: Style = { justifyContent: 'flex-end' };

export function standingsImage(input: StandingsImageInput): ImageNode {
  const theme = resolveTheme(input.theme);
  const { headers } = input;

  const cells = (
    style: Style,
    values: {
      rank: string | number;
      team: ImageNode;
      numbers: (string | number)[];
      diff: string;
      points: string | number;
      form: ImageNode;
    },
    pointsStyle: Style,
  ) =>
    box(
      { alignItems: 'center', padding: '0 20px', ...style },
      text({ width: 52, fontWeight: 700 }, values.rank),
      box({ flexGrow: 1, flexShrink: 1, alignItems: 'center', overflow: 'hidden' }, values.team),
      ...values.numbers.map((value) => text({ width: NUMBER_WIDTH, ...right }, value)),
      text({ width: 88, ...right }, values.diff),
      text({ width: 88, ...right, fontWeight: 700, ...pointsStyle }, values.points),
      box({ width: 150, ...right }, values.form),
    );

  const header = cells(
    { height: 44, fontSize: 18, color: theme.muted, letterSpacing: 1 },
    {
      rank: headers.rank,
      team: text({}, headers.team.toUpperCase()),
      numbers: [headers.played, headers.wins, headers.losses, headers.for, headers.against],
      diff: headers.diff.toUpperCase(),
      points: headers.points,
      form: text({}, headers.form.toUpperCase()),
    },
    {},
  );

  const rows = input.rows.map((row, index) => {
    const [first = theme.muted, second = first] = row.colors;
    const team = box(
      { alignItems: 'center' },
      // The team's two colours, until teams have logos.
      box(
        {
          width: 14,
          height: 34,
          borderRadius: 4,
          overflow: 'hidden',
          flexDirection: 'column',
          // A dark team colour would vanish into the dark background without an outline.
          border: `1px solid ${theme.muted}`,
        },
        box({ flexGrow: 1, backgroundColor: first }),
        box({ flexGrow: 1, backgroundColor: second }),
      ),
      text({ marginLeft: 16, fontSize: 26, fontWeight: 700 }, row.name),
    );
    const form = box(
      { alignItems: 'center' },
      ...Array.from({ length: FORM_SLOTS }, (_slot, slot) => {
        const result = row.form.slice(-FORM_SLOTS)[slot];
        const color = result === 'W' ? theme.win : result === 'L' ? theme.loss : theme.surface;
        // An empty slot is a ring of the same outer size as a dot: 12 px plus a 2 px border.
        const size = result ? 16 : 12;
        return box({
          width: size,
          height: size,
          borderRadius: 8,
          marginLeft: 8,
          backgroundColor: color,
          border: result ? 'none' : `2px solid ${theme.muted}`,
        });
      }),
    );
    return cells(
      {
        height: 60,
        fontSize: 24,
        borderRadius: 10,
        backgroundColor: index % 2 === 0 ? theme.surface : theme.background,
      },
      {
        rank: row.rank,
        team,
        numbers: [row.played, row.wins, row.losses, row.scoreFor, row.scoreAgainst],
        diff: signed(row.diff),
        points: row.points,
        form,
      },
      { color: theme.accent },
    );
  });

  // The outer box fixes the width; the padding sits on an inner box, because a box with both
  // would be laid out wider than the picture.
  return box(
    {
      width: STANDINGS_IMAGE_WIDTH,
      flexDirection: 'column',
      backgroundColor: theme.background,
      color: theme.text,
      fontFamily: 'Inter',
    },
    box(
      { flexDirection: 'column', padding: 40 },
      box(
        { alignItems: 'center', marginBottom: 28 },
        box({ width: 8, height: 76, borderRadius: 4, backgroundColor: theme.accent }),
        box(
          { flexDirection: 'column', marginLeft: 20 },
          text({ fontSize: 22, color: theme.muted }, input.subtitle),
          text({ fontSize: 46, fontWeight: 700 }, input.title),
        ),
      ),
      header,
      ...rows,
    ),
  );
}
