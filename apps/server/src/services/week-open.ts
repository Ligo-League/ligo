import { stageConfigSchema } from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { and, eq } from 'drizzle-orm';
import { requireStaff, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';

// Opening a play week's match channels before the usual day (phase 4; design doc section 6,
// `/week publish`): the week joins the stage's `opened_weeks`, and the reconciler opens its
// channels on its next check. Nothing else about the matches changes.

const { auditLog, division, match, stage } = schema;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type StageRow = typeof stage.$inferSelect;

/** Whether the stage has a match in that week. */
export const stageHasWeek = (db: Pick<Db, 'select'>, stageId: number, week: number) =>
  db
    .select({ id: match.id })
    .from(match)
    .where(and(eq(match.stageId, stageId), eq(match.week, week)))
    .get() !== undefined;

/** Adds the week to the stage's opened weeks, audited; false when it was already there. */
export function markWeekOpen(
  tx: Pick<Tx, 'update' | 'insert'>,
  stageRow: StageRow,
  week: number,
  actorPlayerId: number,
  now: number,
): boolean {
  const config = stageConfigSchema.parse(stageRow.configJson);
  if (config.opened_weeks.includes(week)) return false;
  const next = { ...config, opened_weeks: [...config.opened_weeks, week].sort((x, y) => x - y) };
  tx.update(stage).set({ configJson: next }).where(eq(stage.id, stageRow.id)).run();
  tx.insert(auditLog)
    .values({
      actorPlayerId,
      actorKind: 'user',
      action: 'schedule.open_week',
      entity: 'stage',
      entityId: String(stageRow.id),
      beforeJson: { opened_weeks: config.opened_weeks },
      afterJson: { opened_weeks: next.opened_weeks },
      at: now,
    })
    .run();
  return true;
}

export type OpenWeekReply =
  | { ok: true; divisions: string[]; alreadyOpen: boolean }
  | { ok: false; error: 'not_linked' | 'not_staff' | 'no_season' | 'no_matches' };

/** League staff open a play week of the current season in every division that plays it. */
export function openLeagueWeek(db: Db, actor: Actor, week: number, now: number): OpenWeekReply {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const season = staff.league.season;
  if (!season) return { ok: false, error: 'no_season' };
  const stages = db
    .select({ stage, divisionName: division.name })
    .from(stage)
    .innerJoin(division, eq(stage.divisionId, division.id))
    .where(and(eq(stage.seasonId, season.id), eq(stage.status, 'published')))
    .all()
    .filter((row) => stageHasWeek(db, row.stage.id, week));
  if (stages.length === 0) return { ok: false, error: 'no_matches' };
  return db.transaction((tx): OpenWeekReply => {
    const player = ensurePlayer(
      tx,
      {
        orgId: staff.league.org.id,
        discordUserId: actor.user.id,
        displayName: actor.user.displayName,
      },
      now,
    );
    let changed = 0;
    for (const row of stages) if (markWeekOpen(tx, row.stage, week, player.id, now)) changed += 1;
    return {
      ok: true,
      divisions: stages.map((row) => row.divisionName),
      alreadyOpen: changed === 0,
    };
  });
}
