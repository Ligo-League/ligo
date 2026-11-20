import {
  reconcile,
  rulesetSchema,
  type DesiredState,
  type KnownObject,
  type ObjectKind,
  type Operation,
  type ReconcileResult,
  type RoleRef,
} from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { and, eq } from 'drizzle-orm';
import type { DiscordGateway, GuildChange, ResolvedOverwrite } from '../discord/gateway.ts';

// The reconciler (phase 4; design doc section 6, "Reconciler"). It reads the league's server,
// compares it with what the database wants (`@ligo/core` reconcile), and makes the changes one
// by one, in order. Each object it creates is stored in `discord_object` as soon as it exists,
// so a failure halfway leaves nothing unknown behind and the next run carries on. One run at a
// time per server: two at once would both create what is missing.

const { auditLog, competition, discordObject, leagueGuild } = schema;

export interface SyncOptions {
  /** Only says what would change. */
  dryRun: boolean;
  now: number;
  /** Who asked for it; null when the bot runs it on its own (start, clock, a change). */
  actorPlayerId: number | null;
}

export type SyncReply =
  | {
      ok: true;
      /** Everything the comparison found, applied or not. */
      operations: Operation[];
      applied: number;
      failures: { operation: Operation; message: string }[];
      absentMembers: ReconcileResult['absentMembers'];
    }
  | { ok: false; error: 'not_in_server' | 'discord_unavailable' };

/** The reason Discord shows in the server's audit log for each change. */
const REASON = 'Ligo: league server sync';

const running = new Map<string, Promise<unknown>>();

/** Runs `task` after any sync of the same server still under way. */
function oneAtATime<T>(guildId: string, task: () => Promise<T>): Promise<T> {
  const before = running.get(guildId) ?? Promise.resolve();
  const next = before.then(task, task);
  running.set(guildId, next);
  void next.finally(() => {
    if (running.get(guildId) === next) running.delete(guildId);
  });
  return next;
}

const identity = (kind: string, key: string) => `${kind}\u0000${key}`;

/** Thrown when an operation needs an object an earlier one could not create. */
class Unresolved extends Error {}

export function syncGuild(
  db: Db,
  gateway: DiscordGateway,
  guildId: string,
  desired: DesiredState,
  options: SyncOptions,
): Promise<SyncReply> {
  return oneAtATime(guildId, () => runSync(db, gateway, guildId, desired, options));
}

async function runSync(
  db: Db,
  gateway: DiscordGateway,
  guildId: string,
  desired: DesiredState,
  options: SyncOptions,
): Promise<SyncReply> {
  let snapshot;
  try {
    snapshot = await gateway.guildSnapshot(guildId);
  } catch {
    return { ok: false, error: 'discord_unavailable' };
  }
  if (!snapshot) return { ok: false, error: 'not_in_server' };

  const stored = db.select().from(discordObject).where(eq(discordObject.guildId, guildId)).all();
  const known: KnownObject[] = stored.map(({ kind, key, discordId, createdByLigo }) => ({
    kind,
    key,
    discordId,
    createdByLigo,
  }));
  const { operations, absentMembers } = reconcile(desired, snapshot, known);
  if (options.dryRun || operations.length === 0)
    return { ok: true, operations, applied: 0, failures: [], absentMembers };

  // Each object's ID as the run goes: what was stored, then what each creation returns.
  const ids = new Map(known.map((object) => [identity(object.kind, object.key), object.discordId]));
  const idOf = (kind: ObjectKind, key: string) => {
    const id = ids.get(identity(kind, key));
    if (id === undefined) throw new Unresolved(`${kind} ${key} could not be created`);
    return id;
  };
  const roleId = (ref: RoleRef) => ('id' in ref ? ref.id : idOf('team_role', ref.key));
  const overwrite = (
    target: { role: RoleRef } | { member: string },
    allow: ResolvedOverwrite['allow'],
    deny: ResolvedOverwrite['deny'],
  ): ResolvedOverwrite =>
    'member' in target
      ? { targetId: target.member, targetType: 'member', allow, deny }
      : { targetId: roleId(target.role), targetType: 'role', allow, deny };

  const remember = (kind: ObjectKind, key: string, discordId: string) => {
    ids.set(identity(kind, key), discordId);
    const where = and(
      eq(discordObject.guildId, guildId),
      eq(discordObject.kind, kind),
      eq(discordObject.key, key),
    );
    db.transaction((tx) => {
      tx.delete(discordObject).where(where).run();
      tx.insert(discordObject)
        .values({ guildId, kind, key, discordId, createdByLigo: true, createdAt: options.now })
        .run();
    });
  };
  const forget = (kind: ObjectKind, key: string) => {
    ids.delete(identity(kind, key));
    db.delete(discordObject)
      .where(
        and(
          eq(discordObject.guildId, guildId),
          eq(discordObject.kind, kind),
          eq(discordObject.key, key),
        ),
      )
      .run();
  };

  /** The Discord change for an operation, or null for one Discord takes no part in. */
  const changeOf = (operation: Operation): GuildChange | null => {
    switch (operation.op) {
      case 'create_role':
        return {
          kind: 'create_role',
          name: operation.name,
          color: operation.color,
          mentionable: operation.mentionable,
        };
      case 'update_role':
        return { kind: 'edit_role', roleId: operation.id, ...operation.changes };
      case 'create_category':
        return { kind: 'create_category', name: operation.name };
      case 'rename_category':
        return { kind: 'edit_channel', channelId: operation.id, name: operation.name };
      case 'create_channel':
        return {
          kind: 'create_text_channel',
          name: operation.name,
          parentId: idOf(operation.parent.kind, operation.parent.key),
          overwrites: operation.overwrites.map((entry) =>
            overwrite(entry.target, entry.allow, entry.deny),
          ),
        };
      case 'update_channel':
        return {
          kind: 'edit_channel',
          channelId: operation.id,
          ...(operation.name === undefined ? {} : { name: operation.name }),
          ...(operation.parent
            ? { parentId: idOf(operation.parent.kind, operation.parent.key) }
            : {}),
        };
      case 'set_overwrite':
        return {
          kind: 'set_overwrite',
          channelId: operation.channelId,
          ...overwrite(operation.target, operation.allow, operation.deny),
        };
      case 'remove_overwrite':
        return {
          kind: 'remove_overwrite',
          channelId: operation.channelId,
          targetId: operation.targetId,
        };
      case 'add_member_role':
        return {
          kind: 'add_member_role',
          userId: operation.userId,
          roleId: roleId(operation.role),
        };
      case 'remove_member_role':
        return {
          kind: 'remove_member_role',
          userId: operation.userId,
          roleId: roleId(operation.role),
        };
      case 'delete_channel':
      case 'delete_category':
        return { kind: 'delete_channel', channelId: operation.id };
      case 'delete_role':
        return { kind: 'delete_role', roleId: operation.id };
      case 'forget':
        return null;
    }
  };

  let applied = 0;
  const failures: { operation: Operation; message: string }[] = [];
  for (const operation of operations) {
    try {
      const change = changeOf(operation);
      const created = change ? await gateway.changeGuild(guildId, change, REASON) : null;
      switch (operation.op) {
        case 'create_role':
          if (created) remember('team_role', operation.key, created);
          break;
        case 'create_category':
        case 'create_channel':
          if (created) remember(operation.kind, operation.key, created);
          break;
        case 'delete_channel':
        case 'delete_category':
        case 'forget':
          forget(operation.kind, operation.key);
          break;
        case 'delete_role':
          forget('team_role', operation.key);
          break;
        default:
          break;
      }
      applied += 1;
    } catch (error) {
      failures.push({
        operation,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const counts: Record<string, number> = {};
  for (const operation of operations) counts[operation.op] = (counts[operation.op] ?? 0) + 1;
  db.insert(auditLog)
    .values({
      actorPlayerId: options.actorPlayerId,
      actorKind: options.actorPlayerId === null ? 'bot' : 'user',
      action: 'discord.sync',
      entity: 'league_guild',
      entityId: guildId,
      beforeJson: null,
      afterJson: { operations: counts, applied, failed: failures.length },
      at: options.now,
    })
    .run();
  return { ok: true, operations, applied, failures, absentMembers };
}

export type LeagueSyncReply =
  SyncReply | { ok: false; error: 'not_found' | 'not_linked' | 'not_managed' };

/** Syncs a competition's own server, when the league lets Ligo manage it (`ruleset.discord`). */
export async function syncLeague(
  db: Db,
  gateway: DiscordGateway,
  competitionId: number,
  options: SyncOptions,
): Promise<LeagueSyncReply> {
  const row = db.select().from(competition).where(eq(competition.id, competitionId)).get();
  if (!row) return { ok: false, error: 'not_found' };
  if (!rulesetSchema.parse(row.rulesetJson).discord.manage)
    return { ok: false, error: 'not_managed' };
  const linked = db
    .select({ guildId: leagueGuild.guildId })
    .from(leagueGuild)
    .where(eq(leagueGuild.competitionId, competitionId))
    .get();
  if (!linked) return { ok: false, error: 'not_linked' };
  // What Ligo wants there: team roles come with 4-6, match channels with 4-7 and MOSS
  // channels with 4-8. Until then it wants nothing, and leaves alone what it made (channels are
  // only deleted once released).
  const desired: DesiredState = { roles: [], categories: [], channels: [] };
  return syncGuild(db, gateway, linked.guildId, desired, options);
}
