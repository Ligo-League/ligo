import { vetoFormatSchema } from '@ligo/core';
import { z } from 'zod';
import { SIDES } from './schema/enums.ts';

// zod schemas for the `*_json` columns that are not league rule settings.
// Rule settings (points, tie-breaks, ruleset, scheduling, season, stage) live in @ligo/core.

/** `org.settings_json`. The design doc names no org setting yet. */
export const orgSettingsSchema = z.strictObject({});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * `competition.theme_json`: the colours of the league's images. Every key is optional; a missing
 * one takes the renderer's default.
 */
export const themeSchema = z.strictObject({
  background: hexColor.optional(),
  surface: hexColor.optional(),
  text: hexColor.optional(),
  muted: hexColor.optional(),
  accent: hexColor.optional(),
});
export type Theme = z.infer<typeof themeSchema>;

/** `team.colors_json`. "At least 2 colours" is a registration-form rule, not a storage rule. */
export const teamColorsSchema = z.array(hexColor);
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

/**
 * `match.veto_json`: the veto's format, pool and timer, frozen when it starts, so that staff
 * changing the settings mid-veto cannot break the steps already taken.
 */
export const matchVetoSchema = z.strictObject({
  format: vetoFormatSchema,
  pool: z.array(z.string().min(1)),
  step_seconds: z.int().min(1),
});
export type MatchVeto = z.infer<typeof matchVetoSchema>;

/** `audit_log.before_json` / `after_json`: a snapshot of the changed entity. */
export const auditSnapshotSchema = z.record(z.string(), z.unknown());
export type AuditSnapshot = z.infer<typeof auditSnapshotSchema>;
