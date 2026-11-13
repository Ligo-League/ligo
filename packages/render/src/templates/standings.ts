import { box, picture, text, type EmbeddedImage, type ImageNode, type Style } from '../node.ts';
import { resolveTheme, type ImageTheme, type ThemeOverrides } from '../theme.ts';

export const STANDINGS_IMAGE_WIDTH = 1200;
/** Part of the cache key: raise it whenever the picture changes for the same input. */
export const STANDINGS_TEMPLATE_VERSION = 6;

export interface StandingsImageRow {
  rank: number;
  /** Places gained since the previous week (negative: lost); null or absent shows nothing. */
  change?: number | null;
  name: string;
  /** The team's colours as #RRGGBB; the first two are shown when it has no logo. */
  colors: readonly string[];
  /** The team's logo, square; null or absent shows its colours instead. */
  logo?: EmbeddedImage | null;
  played: number;
  wins: number;
  losses: number;
  scoreFor: number;
  scoreAgainst: number;
  diff: number;
  points: number;
  /** Latest results, oldest first. */
  form: readonly ('W' | 'L')[];
  /** The colour of the zone the row falls in (title, promotion, barrage…); null for none. */
  zoneColor?: string | null;
  /** A word after the name, such as "Exclue"; the row is then dimmed. */
  note?: string | null;
}

/** One entry of the legend under the table: a zone's colour and what it means. */
export interface StandingsLegendEntry {
  color: string;
  label: string;
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
  /** The zones the table shows, in table order; none draws no legend. */
  legend?: readonly StandingsLegendEntry[];
  theme?: ThemeOverrides;
}

const NUMBER_WIDTH = 64;
const PLAYED_WIDTH = 96;
const LOGO_SIZE = 40;
const FORM_SLOTS = 5;
const signed = (value: number) => (value > 0 ? `+${value}` : String(value));
const right: Style = { justifyContent: 'flex-end' };

/** A rise in green, a fall in red, no move as a dash; nothing before there is a previous week. */
function rankChange(change: number | null, theme: ImageTheme): ImageNode {
  if (change === null) return box({});
  if (change === 0) return text({ fontSize: 20, color: theme.muted }, '–');
  const [arrow, color] = change > 0 ? ['▲', theme.win] : ['▼', theme.loss];
  return text({ fontSize: 18, fontWeight: 700, color }, `${arrow} ${Math.abs(change)}`);
}

function legend(entries: readonly StandingsLegendEntry[], theme: ImageTheme): ImageNode {
  return box(
    { flexWrap: 'wrap', marginTop: 24, padding: '0 20px', fontSize: 20, color: theme.muted },
    ...entries.map((entry) =>
      box(
        { alignItems: 'center', marginRight: 32, marginTop: 4 },
        box({ width: 16, height: 16, borderRadius: 4, backgroundColor: entry.color }),
        text({ marginLeft: 10 }, entry.label),
      ),
    ),
  );
}

export function standingsImage(input: StandingsImageInput): ImageNode {
  const theme = resolveTheme(input.theme);
  const { headers } = input;

  const cells = (
    style: Style,
    values: {
      rank: string | number;
      change: ImageNode;
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
      box({ width: 64, alignItems: 'center' }, values.change),
      box({ flexGrow: 1, flexShrink: 1, alignItems: 'center', overflow: 'hidden' }, values.team),
      // The first number is "played", whose header is a whole word.
      ...values.numbers.map((value, index) =>
        text({ width: index === 0 ? PLAYED_WIDTH : NUMBER_WIDTH, ...right }, value),
      ),
      text({ width: 88, ...right }, values.diff),
      text({ width: 88, ...right, fontWeight: 700, ...pointsStyle }, values.points),
      box({ width: 150, ...right }, values.form),
    );

  const header = cells(
    {
      height: 44,
      fontSize: 18,
      color: theme.muted,
      letterSpacing: 1,
      // As wide as a row's zone edge, so that headers sit over their columns.
      borderLeft: '6px solid transparent',
    },
    {
      rank: headers.rank,
      change: box({}),
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
    // The logo, or the team's two colours for a team without one.
    const badge = row.logo
      ? picture(row.logo, LOGO_SIZE)
      : box(
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
        );
    const team = box(
      { alignItems: 'center' },
      // A fixed slot, so names line up whether a team has a logo or not.
      box({ width: LOGO_SIZE, justifyContent: 'center', flexShrink: 0 }, badge),
      text({ marginLeft: 14, fontSize: 26, fontWeight: 700 }, row.name),
      ...(row.note
        ? [
            text(
              {
                marginLeft: 12,
                fontSize: 16,
                fontWeight: 700,
                color: theme.loss,
                letterSpacing: 1,
              },
              row.note.toUpperCase(),
            ),
          ]
        : []),
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
        // The zone's colour on the row's edge; a transparent edge keeps the columns aligned.
        borderLeft: `6px solid ${row.zoneColor ?? 'transparent'}`,
        opacity: row.note ? 0.6 : 1,
      },
      {
        rank: row.rank,
        change: rankChange(row.change ?? null, theme),
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
      ...(input.legend && input.legend.length > 0 ? [legend(input.legend, theme)] : []),
    ),
  );
}
