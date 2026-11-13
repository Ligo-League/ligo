/** Colours of an image, as #RRGGBB. A competition overrides any of them in `theme_json`. */
export interface ImageTheme {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  win: string;
  loss: string;
  /** Places that play a barrage, between promotion and relegation. */
  barrage: string;
}

export const DEFAULT_THEME: ImageTheme = {
  background: '#0F1218',
  surface: '#1A1F2A',
  text: '#F3F5F8',
  muted: '#8B94A7',
  accent: '#F7BE50',
  win: '#3FB96B',
  loss: '#E5534B',
  barrage: '#F2994A',
};

/** Some colours of a theme; a stored theme lists only the ones a league changed. */
export type ThemeOverrides = { [Key in keyof ImageTheme]?: ImageTheme[Key] | undefined };

/** The default theme with the given colours replaced; undefined values are ignored. */
export function resolveTheme(overrides: ThemeOverrides = {}): ImageTheme {
  const theme = { ...DEFAULT_THEME };
  // Object.keys returns string[]; these are exactly the keys of DEFAULT_THEME.
  for (const key of Object.keys(DEFAULT_THEME) as (keyof ImageTheme)[]) {
    const value = overrides[key];
    if (value !== undefined) theme[key] = value;
  }
  return theme;
}
