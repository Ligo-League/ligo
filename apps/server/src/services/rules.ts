import { zonedDateTime } from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { and, desc, eq } from 'drizzle-orm';
import { requireStaff, type Actor } from './permissions.ts';
import { findCompetitionAt, type CompetitionKey } from './competitions.ts';
import { ensurePlayer } from './players.ts';

const { auditLog, rulesVersion } = schema;

// A competition's rulebook (design doc sections 4 and 7). Versions are published by the
// competition's staff and never edited: teams accept a given version when they register, so a
// change is a new version. The one in force is the latest whose day has come.

const VERSION_MAX = 60;
const MARKDOWN_MAX = 200_000;

export interface RulesVersionSummary {
  id: number;
  version: string;
  effectiveFrom: number;
  votedAt: number | null;
  publishedAt: number;
}

export type RulesPage =
  | {
      ok: true;
      /** `path` is its address, `/:org/:comp`. */
      competition: { id: number; name: string; slug: string; path: string; timeZone: string };
      /** The version asked for, or the one in force; null before any is in force. */
      shown: (RulesVersionSummary & { markdown: string }) | null;
      currentId: number | null;
      /** Every version, the latest to come into force first. */
      versions: RulesVersionSummary[];
    }
  | { ok: false; error: 'not_found' };

/** The rulebook of a competition: the version in force, or the one asked for, and the history. */
export function rulesPage(
  db: Pick<Db, 'select'>,
  key: CompetitionKey,
  now: number,
  versionId: number | null = null,
): RulesPage {
  const found = findCompetitionAt(db, key);
  if (!found) return { ok: false, error: 'not_found' };
  const rows = db
    .select()
    .from(rulesVersion)
    .where(eq(rulesVersion.competitionId, found.id))
    .orderBy(desc(rulesVersion.effectiveFrom), desc(rulesVersion.id))
    .all();
  const current = rows.find((row) => row.effectiveFrom <= now) ?? null;
  const shown = versionId === null ? current : rows.find((row) => row.id === versionId);
  if (shown === undefined) return { ok: false, error: 'not_found' };

  const summary = (row: (typeof rows)[number]): RulesVersionSummary => ({
    id: row.id,
    version: row.version,
    effectiveFrom: row.effectiveFrom,
    votedAt: row.votedAt,
    publishedAt: row.publishedAt,
  });
  return {
    ok: true,
    competition: {
      id: found.id,
      name: found.name,
      slug: found.slug,
      path: found.path,
      timeZone: found.schedulingJson.time_zone,
    },
    shown: shown && { ...summary(shown), markdown: shown.markdown },
    currentId: current?.id ?? null,
    versions: rows.map(summary),
  };
}

export type PublishRulesError =
  | 'not_linked'
  | 'not_staff'
  | 'version_invalid'
  | 'markdown_empty'
  | 'markdown_too_long'
  | 'invalid_date'
  | 'version_taken';

export type PublishRulesReply = { ok: true; id: number } | { ok: false; error: PublishRulesError };

/**
 * The competition's staff publish a version of its rulebook, in force from midnight on
 * `effectiveOn` in the league's time zone. `votedOn`, when given, is the day the league voted it.
 */
export function publishRules(
  db: Db,
  actor: Actor,
  request: {
    competitionId: number;
    version: string;
    markdown: string;
    effectiveOn: string;
    votedOn: string | null;
  },
  now: number,
): PublishRulesReply {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const { league } = staff;
  // Staff of one league's Discord server publish only that league's rulebook.
  if (league.competition.id !== request.competitionId) return { ok: false, error: 'not_staff' };

  const version = request.version.trim();
  if (version === '' || version.length > VERSION_MAX) {
    return { ok: false, error: 'version_invalid' };
  }
  if (request.markdown.trim() === '') return { ok: false, error: 'markdown_empty' };
  if (request.markdown.length > MARKDOWN_MAX) return { ok: false, error: 'markdown_too_long' };
  const timeZone = league.competition.schedulingJson.time_zone;
  const effective = zonedDateTime(request.effectiveOn, '00:00', timeZone);
  const voted = request.votedOn === null ? null : zonedDateTime(request.votedOn, '00:00', timeZone);
  if (!effective.ok || (voted !== null && !voted.ok)) return { ok: false, error: 'invalid_date' };

  return db.transaction((tx): PublishRulesReply => {
    const taken = tx
      .select({ id: rulesVersion.id })
      .from(rulesVersion)
      .where(
        and(
          eq(rulesVersion.competitionId, request.competitionId),
          eq(rulesVersion.version, version),
        ),
      )
      .get();
    if (taken) return { ok: false, error: 'version_taken' };

    const publisher = ensurePlayer(
      tx,
      { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
      now,
    );
    const row = {
      competitionId: request.competitionId,
      version,
      markdown: request.markdown,
      votedAt: voted?.at ?? null,
      effectiveFrom: effective.at,
      publishedBy: publisher.id,
      publishedAt: now,
    };
    const stored = tx.insert(rulesVersion).values(row).returning().get();
    tx.insert(auditLog)
      .values({
        actorPlayerId: publisher.id,
        actorKind: 'user',
        action: 'rules.publish',
        entity: 'rules_version',
        entityId: String(stored.id),
        // The text itself is in the row, which is never edited.
        afterJson: { version, effectiveFrom: row.effectiveFrom, votedAt: row.votedAt },
        at: now,
      })
      .run();
    return { ok: true, id: stored.id };
  });
}
