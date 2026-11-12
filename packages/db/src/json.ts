import { z } from 'zod';
import { SIDES } from './schema/enums.ts';

// zod schemas for the `*_json` columns that are not league rule settings.
// Rule settings (points, tie-breaks, ruleset, scheduling, season, stage) live in @ligo/core.

/** `org.settings_json`. The design doc names no org setting yet. */
export const orgSettingsSchema = z.strictObject({});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;

/** `competition.theme_json`. Colours and logo arrive with the first image template (phase 1). */
export const themeSchema = z.strictObject({});
export type Theme = z.infer<typeof themeSchema>;

/** `team.colors_json`. "At least 2 colours" is a registration-form rule, not a storage rule. */
export const teamColorsSchema = z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/));
export type TeamColors = z.infer<typeof teamColorsSchema>;

/** `team.socials_json`. Links are rendered on public pages, so only http(s) is accepted. */
export const teamSocialsSchema = z.array(
  z.strictObject({
    label: z.string().min(1),
    url: z.url({ protocol: /^https?$/ }),
  }),
);
export type TeamSocials = z.infer<typeof teamSocialsSchema>;

/** `game.bans_json`: the maps banned before this game, in ban order. */
export const gameBansSchema = z.array(
  z.strictObject({ side: z.enum(SIDES), map: z.string().min(1) }),
);
export type GameBans = z.infer<typeof gameBansSchema>;

/** `audit_log.before_json` / `after_json`: a snapshot of the changed entity. */
export const auditSnapshotSchema = z.record(z.string(), z.unknown());
export type AuditSnapshot = z.infer<typeof auditSnapshotSchema>;
