import { checkBirthDate, zonedDate, type TeamRole } from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { asc, eq, inArray } from 'drizzle-orm';
import type { Locale } from '../i18n/index.ts';
import { highestRole, teamsOfPlayer } from './permissions.ts';
import { ensurePlayer } from './players.ts';

// A player's own account on the website (design doc section 7, `/me`): who they are, the teams
// they act for, their nationality and their stats consent. Each change is audited.

const { auditLog, org, player, team } = schema;

type Player = typeof player.$inferSelect;

export type LoginReply = { ok: true; player: Player } | { ok: false; error: 'no_org' };

/**
 * The player of a Discord account that logged in, created on first login. One Discord account is
 * one player across the group (design doc section 12); a new one joins the first organisation,
 * the only one until another league joins the instance.
 */
export function loginPlayer(
  db: Db,
  user: { id: string; displayName: string },
  now: number,
): LoginReply {
  const home = db.select({ id: org.id }).from(org).orderBy(asc(org.id)).get();
  const known = db.select().from(player).where(eq(player.discordUserId, user.id)).get();
  if (known) return { ok: true, player: known };
  if (!home) return { ok: false, error: 'no_org' };
  return {
    ok: true,
    player: ensurePlayer(
      db,
      { orgId: home.id, discordUserId: user.id, displayName: user.displayName },
      now,
    ),
  };
}

export interface Profile {
  player: Player;
  /** The teams the player acts for, by name. */
  teams: { name: string; slug: string; role: TeamRole }[];
}

export function profileOf(db: Pick<Db, 'select'>, playerId: number): Profile | null {
  const found = db.select().from(player).where(eq(player.id, playerId)).get();
  if (!found) return null;
  // Each roster once, with the highest role held for it: a club role counts for all its rosters.
  const held = teamsOfPlayer(db, playerId);
  const ids = [...new Set(held.map((entry) => entry.teamId))];
  const teams =
    ids.length === 0
      ? []
      : db
          .select({ id: team.id, name: team.name, slug: team.slug })
          .from(team)
          .where(inArray(team.id, ids))
          .orderBy(asc(team.name))
          .all()
          .flatMap((row) => {
            const role = highestRole(held, row.id);
            return role ? [{ name: row.name, slug: row.slug, role }] : [];
          });
  return { player: found, teams };
}

// Codes Intl names that are no country: unknown, European Union, Eurozone, United Nations,
// outlying Oceania.
const PSEUDO_REGIONS = new Set(['ZZ', 'EU', 'EZ', 'UN', 'QO']);
const LETTERS = Array.from({ length: 26 }, (_letter, index) => String.fromCharCode(65 + index));

function regionName(locale: Locale, code: string): string | undefined {
  if (!/^[A-Z]{2}$/.test(code) || PSEUDO_REGIONS.has(code)) return undefined;
  return new Intl.DisplayNames(locale, { type: 'region', fallback: 'none' }).of(code);
}

const choicesByLocale = new Map<Locale, { code: string; name: string }[]>();

/** Every country Intl knows, by name in `locale`, for the nationality list. */
export function countryChoices(locale: Locale): { code: string; name: string }[] {
  const cached = choicesByLocale.get(locale);
  if (cached) return cached;
  const choices = LETTERS.flatMap((first) => LETTERS.map((second) => first + second))
    .flatMap((code) => {
      const name = regionName(locale, code);
      return name ? [{ code, name }] : [];
    })
    .sort((x, y) => x.name.localeCompare(y.name, locale));
  choicesByLocale.set(locale, choices);
  return choices;
}

function audit(
  db: Pick<Db, 'insert'>,
  playerId: number,
  action: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  now: number,
): void {
  db.insert(auditLog)
    .values({
      actorPlayerId: playerId,
      actorKind: 'user',
      action,
      entity: 'player',
      entityId: String(playerId),
      beforeJson: before,
      afterJson: after,
      at: now,
    })
    .run();
}

/** An ISO 3166 country code, as the registration form asks; empty clears it. */
export function setNationality(
  db: Db,
  playerId: number,
  input: string,
  now: number,
): { ok: true } | { ok: false; error: 'invalid_nationality' } {
  const code = input.trim().toUpperCase();
  if (code !== '' && !regionName('en', code)) return { ok: false, error: 'invalid_nationality' };
  const nationality = code === '' ? null : code;
  db.transaction((tx) => {
    const before = tx
      .select({ nationality: player.nationality })
      .from(player)
      .where(eq(player.id, playerId))
      .get();
    tx.update(player).set({ nationality }).where(eq(player.id, playerId)).run();
    audit(
      tx,
      playerId,
      'player.nationality',
      { nationality: before?.nationality ?? null },
      { nationality },
      now,
    );
  });
  return { ok: true };
}

// Dates on `/me` are the group's: Paris, the only time zone a league uses yet.
const TIME_ZONE = 'Europe/Paris';

/**
 * The player's birth date, for leagues with a minimum age (O-33); empty clears it. The audit
 * says only whether one was given: the date itself stays on the player's row, which only they
 * see.
 */
export function setBirthDate(
  db: Db,
  playerId: number,
  input: string,
  now: number,
): { ok: true } | { ok: false; error: 'invalid_birth_date' } {
  let birthDate: string | null = null;
  if (input.trim() !== '') {
    const checked = checkBirthDate(input, zonedDate(now, TIME_ZONE).date);
    if (!checked.ok) return checked;
    birthDate = checked.value;
  }
  db.transaction((tx) => {
    const before = tx
      .select({ birthDate: player.birthDate })
      .from(player)
      .where(eq(player.id, playerId))
      .get();
    tx.update(player).set({ birthDate }).where(eq(player.id, playerId)).run();
    audit(
      tx,
      playerId,
      'player.birth_date',
      { given: (before?.birthDate ?? null) !== null },
      { given: birthDate !== null },
      now,
    );
  });
  return { ok: true };
}

/**
 * Gives or withdraws consent to public stats. Without it a player stays in rosters and results
 * but off stat pages and leaderboards (design doc section 7, GDPR).
 */
export function setStatsConsent(db: Db, playerId: number, consent: boolean, now: number): void {
  db.transaction((tx) => {
    const before = tx
      .select({ at: player.statsConsentAt })
      .from(player)
      .where(eq(player.id, playerId))
      .get();
    const current = before?.at ?? null;
    // Nothing changes: no audit entry either.
    if (consent === (current !== null)) return;
    const at = consent ? now : null;
    tx.update(player).set({ statsConsentAt: at }).where(eq(player.id, playerId)).run();
    audit(
      tx,
      playerId,
      consent ? 'player.stats_consent.give' : 'player.stats_consent.withdraw',
      { statsConsentAt: current },
      { statsConsentAt: at },
      now,
    );
  });
}
