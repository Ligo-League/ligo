import { box, picture, text, type EmbeddedImage, type ImageNode } from '../node.ts';
import { resolveTheme, type ImageTheme, type ThemeOverrides } from '../theme.ts';

// One match on a square picture for social networks (design doc section 11): its time once
// agreed, or its result. Every text arrives translated: this package holds no user-facing text.

export const MATCH_CARD_SIZE = 1080;
/** Part of the cache key: raise it whenever the picture changes for the same input. */
export const MATCH_CARD_TEMPLATE_VERSION = 1;

export interface MatchCardTeam {
  name: string;
  /** The team's colours as #RRGGBB; the first two are shown when it has no logo. */
  colors: readonly string[];
  logo?: EmbeddedImage | null;
}

export interface MatchCardInput {
  /** The competition and season, e.g. "LFR · Saison 3". */
  eyebrow: string;
  /** The division and week, e.g. "Ligue 1 · Semaine 3". */
  title: string;
  /** What the picture announces, e.g. "Match programmé" or "Résultat". */
  label: string;
  teams: readonly [MatchCardTeam, MatchCardTeam];
  /** Between the teams: "VS", a score such as "7 – 5", or "Forfait". */
  center: string;
  /** The team that won, by its place in `teams`; the other is dimmed. Null for no result. */
  winner: 0 | 1 | null;
  /** Under the teams: the first line large, such as the date, then smaller ones. */
  lines: readonly string[];
  theme?: ThemeOverrides;
}

const LOGO_SIZE = 260;
const PADDING = 72;

function badge(team: MatchCardTeam, theme: ImageTheme): ImageNode {
  if (team.logo) return picture(team.logo, LOGO_SIZE);
  const [first = theme.muted, second = first] = team.colors;
  // The team's two colours, outlined so that a dark colour does not vanish.
  return box(
    {
      width: 200,
      height: 200,
      borderRadius: 100,
      overflow: 'hidden',
      border: `4px solid ${theme.muted}`,
    },
    box({ flexGrow: 1, backgroundColor: first }),
    box({ flexGrow: 1, backgroundColor: second }),
  );
}

function teamColumn(team: MatchCardTeam, dimmed: boolean, theme: ImageTheme): ImageNode {
  return box(
    {
      width: 360,
      flexDirection: 'column',
      alignItems: 'center',
      opacity: dimmed ? 0.45 : 1,
    },
    box(
      { width: LOGO_SIZE, height: LOGO_SIZE, alignItems: 'center', justifyContent: 'center' },
      badge(team, theme),
    ),
    text(
      { marginTop: 28, fontSize: 40, fontWeight: 700, textAlign: 'center', lineHeight: 1.15 },
      team.name,
    ),
  );
}

export function matchCardImage(input: MatchCardInput): ImageNode {
  const theme = resolveTheme(input.theme);
  const [first, second] = input.teams;
  const dimmed = (index: 0 | 1) => input.winner !== null && input.winner !== index;
  const [headline, ...details] = input.lines;
  return box(
    {
      width: MATCH_CARD_SIZE,
      height: MATCH_CARD_SIZE,
      flexDirection: 'column',
      backgroundColor: theme.background,
      color: theme.text,
      fontFamily: 'Inter',
    },
    box({ height: 12, backgroundColor: theme.accent }),
    box(
      { flexGrow: 1, flexDirection: 'column', padding: PADDING },
      box(
        { flexDirection: 'column' },
        text({ fontSize: 28, color: theme.muted }, input.eyebrow),
        text({ fontSize: 56, fontWeight: 700, marginTop: 8 }, input.title),
        box(
          { marginTop: 20 },
          text(
            {
              fontSize: 26,
              fontWeight: 700,
              color: theme.background,
              backgroundColor: theme.accent,
              padding: '8px 20px',
              borderRadius: 8,
              letterSpacing: 2,
            },
            input.label.toUpperCase(),
          ),
        ),
      ),
      box(
        { flexGrow: 1, alignItems: 'center', justifyContent: 'space-between' },
        teamColumn(first, dimmed(0), theme),
        text(
          {
            fontSize: input.center.length > 5 ? 48 : 88,
            fontWeight: 700,
            color: input.winner === null ? theme.muted : theme.text,
          },
          input.center,
        ),
        teamColumn(second, dimmed(1), theme),
      ),
      box(
        {
          flexDirection: 'column',
          alignItems: 'center',
          padding: '28px 0',
          borderRadius: 16,
          backgroundColor: theme.surface,
        },
        ...(headline === undefined ? [] : [text({ fontSize: 52, fontWeight: 700 }, headline)]),
        ...details.map((line) => text({ fontSize: 34, color: theme.muted, marginTop: 8 }, line)),
      ),
    ),
  );
}
