import {
  ADDABLE_TEAM_ROLES,
  ROSTER_COLORS_MAX,
  ROSTER_COLORS_MIN,
  VETO_OPENINGS,
  vetoFormatSchema,
} from '@ligo/core';
import { z } from 'zod';
import { LEGAL_STATUSES, SIDES } from './schema/enums.ts';

// zod schemas for the `*_json` columns that are not league rule settings.
// Rule settings (points, tie-breaks, ruleset, scheduling, season, stage) live in @ligo/core.

/** `org.settings_json`. The design doc names no org setting yet. */
/**
 * `org.settings_json`: settings of the whole group. `club_roles`: how many managers a club may
 * have besides its owner (maintainer, 14 November 2026: a setting; 3 like a roster's managers
 * until the league says otherwise).
 */
export const orgSettingsSchema = z.strictObject({
  club_roles: z
    .strictObject({ managers_max: z.int().min(0).default(3) })
    .default({ managers_max: 3 }),
  // A roster's own players before any competition (M-34): how many, and how long its
  // invitation link lasts.
  rosters: z
    .strictObject({
      players_max: z.int().min(1).max(50).default(10),
      invite_days: z.int().min(1).max(60).default(7),
    })
    .default({ players_max: 10, invite_days: 7 }),
});
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
  /** How team A was found; vetoes started before the coin toss existed were all ranked. */
  opening: z.enum(VETO_OPENINGS).default('ranked'),
  /**
   * The match side of the veto's team A. Missing on vetoes started before the coin toss, whose
   * team A was always `match.side_chooser`.
   */
  team_a: z.enum(SIDES).optional(),
});
export type MatchVeto = z.infer<typeof matchVetoSchema>;

/**
 * A `registration` request (design doc section 7, "Registration"): a new club, or one the filer
 * already runs, the roster's details, and the rulebook version the filer accepted. The players
 * join apart, each from the invitation (`registration_player`).
 */
export const registrationPayloadSchema = z.strictObject({
  club: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('new'),
      name: z.string().min(2).max(40),
      city: z.string().min(1).max(60).nullable(),
      legalStatus: z.enum(LEGAL_STATUSES).nullable(),
      socials: teamSocialsSchema.max(5),
      // A Discord invitation, shown on the club's page: https only.
      discordUrl: z.url({ protocol: /^https$/ }).nullable(),
    }),
    z.strictObject({ kind: z.literal('existing'), clubId: z.int().positive() }),
  ]),
  roster: z.strictObject({
    name: z.string().min(2).max(40),
    tag: z.string().regex(/^[A-Z0-9]{2,12}$/),
    colors: teamColorsSchema.min(ROSTER_COLORS_MIN).max(ROSTER_COLORS_MAX),
    /** The uploaded logo, by its key in the asset store; none yet is allowed. */
    logoKey: z
      .string()
      .regex(/^uploads\/[0-9a-f]{64}\.png$/)
      .nullable(),
    canStream: z.boolean(),
  }),
  rules: z.strictObject({ versionId: z.int().positive(), acceptedAt: z.int().nonnegative() }),
});
export type RegistrationPayload = z.infer<typeof registrationPayloadSchema>;

/**
 * `request.payload_json` of a registration that enters an existing roster (M-33, maintainer,
 * 15 November 2026): the roster is the request's `team_id`, its lineup the registration's
 * players; only the rulebook accepted is kept here. Registrations filed before carry the
 * roster and its club instead (`registrationPayloadSchema`), kept for their history.
 */
export const rosterRegistrationPayloadSchema = z.strictObject({
  rules: z.strictObject({ versionId: z.int().positive(), acceptedAt: z.int().nonnegative() }),
});
export type RosterRegistrationPayload = z.infer<typeof rosterRegistrationPayloadSchema>;

/** `audit_log.before_json` / `after_json`: a snapshot of the changed entity. */
export const auditSnapshotSchema = z.record(z.string(), z.unknown());
export type AuditSnapshot = z.infer<typeof auditSnapshotSchema>;

/**
 * `request.payload_json`: what a team asks for, about one player (design doc section 5, "Team
 * requests"). The request's `kind` says which shape it has; the server checks the pair.
 */
export const requestPayloadSchema = z.union([
  z.strictObject({ playerId: z.int().positive(), role: z.enum(ADDABLE_TEAM_ROLES) }),
  z.strictObject({ playerId: z.int().positive() }),
  // `registration`: filed before the team existed (until 15 November 2026), so it carries the
  // roster and its club; since, it names its roster in `team_id`.
  z.lazy(() => registrationPayloadSchema),
  z.lazy(() => rosterRegistrationPayloadSchema),
]);
export type RequestPayload = z.infer<typeof requestPayloadSchema>;
