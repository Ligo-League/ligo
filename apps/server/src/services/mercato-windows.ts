import { windowOpenAt, type MercatoSettings } from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { and, asc, eq } from 'drizzle-orm';
import { requireStaff, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';

// Mercato windows (design doc section 7; O-35, maintainer, 16 November 2026): league staff open
// one for the season under way and decide how long it lasts. Its limit and block are filled from
// `ruleset.mercato` and then are its own. A window can be closed early, never deleted: moves
// filed in it keep pointing at it.

const { auditLog, mercatoWindow } = schema;

export type MercatoWindowRow = typeof mercatoWindow.$inferSelect;
export type WindowState = 'upcoming' | 'open' | 'closed';

/** Where a window stands at `now`. */
export function windowState(row: MercatoWindowRow, now: number): WindowState {
  if (windowOpenAt(row, now)) return 'open';
  return now < row.opensAt && row.closedEarlyAt === null ? 'upcoming' : 'closed';
}

export type MercatoOverview =
  | {
      ok: true;
      season: { id: number; name: string } | null;
      settings: MercatoSettings;
      timeZone: string;
      /** The season's windows, earliest first, with where each stands now. */
      windows: (MercatoWindowRow & { state: WindowState })[];
    }
  | { ok: false; error: 'not_linked' | 'not_staff' };

/** The league's mercato for its staff: its settings and the season's windows. */
export function mercatoOverview(
  db: Pick<Db, 'select'>,
  actor: Pick<Actor, 'guildId' | 'memberRoleIds'>,
  now: number,
): MercatoOverview {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const { league } = staff;
  const season = league.season && league.season.status !== 'closed' ? league.season : null;
  const windows = season
    ? db
        .select()
        .from(mercatoWindow)
        .where(eq(mercatoWindow.seasonId, season.id))
        .orderBy(asc(mercatoWindow.opensAt), asc(mercatoWindow.id))
        .all()
    : [];
  return {
    ok: true,
    season: season && { id: season.id, name: season.name },
    settings: league.competition.rulesetJson.mercato,
    timeZone: league.competition.schedulingJson.time_zone,
    windows: windows.map((row) => ({ ...row, state: windowState(row, now) })),
  };
}

export interface OpenWindowRequest {
  opensAt: number;
  closesAt: number;
  /** Null: no limit. */
  maxMovesPerTeam: number | null;
  lockHours: number;
}

export type OpenWindowError =
  | 'not_linked'
  | 'not_staff'
  | 'no_season'
  | 'always_open'
  | 'closes_before_opening'
  | 'closes_in_past'
  | 'invalid_limit'
  | 'invalid_lock'
  | 'overlaps';

export type OpenWindowReply =
  | {
      ok: true;
      window: MercatoWindowRow;
      season: { name: string };
      competition: { name: string };
      timeZone: string;
      /** Where the bot announces it; null when the league has no `#mercato` channel. */
      mercatoChannelId: string | null;
    }
  | { ok: false; error: OpenWindowError };

const MAX_MOVES = 50;
const MAX_LOCK_HOURS = 720;

/**
 * Opens a window for the season under way. A league whose mercato is always open has no windows.
 * Two windows of a season never overlap, so a move belongs to one window only.
 */
export function openMercatoWindow(
  db: Db,
  actor: Actor,
  request: OpenWindowRequest,
  now: number,
): OpenWindowReply {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const { league } = staff;
  const fail = (error: OpenWindowError) => ({ ok: false as const, error });
  const season = league.season && league.season.status !== 'closed' ? league.season : null;
  if (!season) return fail('no_season');
  if (league.competition.rulesetJson.mercato.mode === 'open') return fail('always_open');
  if (request.closesAt <= request.opensAt) return fail('closes_before_opening');
  if (request.closesAt <= now) return fail('closes_in_past');
  const limit = request.maxMovesPerTeam;
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > MAX_MOVES)) {
    return fail('invalid_limit');
  }
  const lock = request.lockHours;
  if (!Number.isInteger(lock) || lock < 0 || lock > MAX_LOCK_HOURS) return fail('invalid_lock');

  return db.transaction((tx) => {
    const overlapping = tx
      .select()
      .from(mercatoWindow)
      .where(eq(mercatoWindow.seasonId, season.id))
      .all()
      .some(
        (other) =>
          request.opensAt < (other.closedEarlyAt ?? other.closesAt) &&
          other.opensAt < request.closesAt &&
          // A window closed before it opened never was.
          (other.closedEarlyAt === null || other.closedEarlyAt > other.opensAt),
      );
    if (overlapping) return fail('overlaps');
    const staffPlayer = ensurePlayer(
      tx,
      { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
      now,
    );
    const window = tx
      .insert(mercatoWindow)
      .values({
        seasonId: season.id,
        opensAt: request.opensAt,
        closesAt: request.closesAt,
        maxMovesPerTeam: limit,
        lockHours: lock,
        createdBy: staffPlayer.id,
        createdAt: now,
      })
      .returning()
      .get();
    tx.insert(auditLog)
      .values({
        actorPlayerId: staffPlayer.id,
        actorKind: 'user',
        action: 'mercato.window.open',
        entity: 'mercato_window',
        entityId: String(window.id),
        beforeJson: null,
        afterJson: { ...window },
        at: now,
      })
      .run();
    return {
      ok: true as const,
      window,
      season: { name: season.name },
      competition: { name: league.competition.name },
      timeZone: league.competition.schedulingJson.time_zone,
      mercatoChannelId: league.guild.mercatoChannelId,
    };
  });
}

export type CloseWindowReply =
  | {
      ok: true;
      window: MercatoWindowRow;
      /** Whether it was open: an upcoming window closed before opening was never announced open. */
      wasOpen: boolean;
      mercatoChannelId: string | null;
    }
  | { ok: false; error: 'not_linked' | 'not_staff' | 'window_not_found' | 'already_closed' };

/** Closes a window now, open or still to come; moves filed in it stay as they are. */
export function closeMercatoWindow(
  db: Db,
  actor: Actor,
  windowId: number,
  now: number,
): CloseWindowReply {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const { league } = staff;
  return db.transaction((tx) => {
    const row = tx
      .select({ window: mercatoWindow })
      .from(mercatoWindow)
      .innerJoin(schema.season, eq(mercatoWindow.seasonId, schema.season.id))
      .where(
        and(eq(mercatoWindow.id, windowId), eq(schema.season.competitionId, league.competition.id)),
      )
      .get();
    if (!row) return { ok: false as const, error: 'window_not_found' as const };
    const state = windowState(row.window, now);
    if (state === 'closed') return { ok: false as const, error: 'already_closed' as const };
    const staffPlayer = ensurePlayer(
      tx,
      { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
      now,
    );
    const closed = tx
      .update(mercatoWindow)
      .set({ closedEarlyAt: now })
      .where(eq(mercatoWindow.id, windowId))
      .returning()
      .get();
    tx.insert(auditLog)
      .values({
        actorPlayerId: staffPlayer.id,
        actorKind: 'user',
        action: 'mercato.window.close',
        entity: 'mercato_window',
        entityId: String(windowId),
        beforeJson: { closedEarlyAt: null },
        afterJson: { closedEarlyAt: now },
        at: now,
      })
      .run();
    return {
      ok: true as const,
      window: closed,
      wasOpen: state === 'open',
      mercatoChannelId: league.guild.mercatoChannelId,
    };
  });
}
