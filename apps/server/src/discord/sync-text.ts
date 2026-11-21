import type { Operation } from '@ligo/core';
import { t, type Locale, type MessageKey } from '../i18n/index.ts';
import type { LeagueSyncReply } from '../services/reconciler.ts';

// What a sync of the league's server found and did, for `/league sync` and the sync page.

/** Every kind of change, in the order the reconciler makes them, with its label. */
export const SYNC_LABELS = {
  create_role: 'sync.op.create_role',
  update_role: 'sync.op.update_role',
  create_category: 'sync.op.create_category',
  rename_category: 'sync.op.rename_category',
  create_channel: 'sync.op.create_channel',
  update_channel: 'sync.op.update_channel',
  set_overwrite: 'sync.op.set_overwrite',
  remove_overwrite: 'sync.op.remove_overwrite',
  add_member_role: 'sync.op.add_member_role',
  remove_member_role: 'sync.op.remove_member_role',
  delete_channel: 'sync.op.delete_channel',
  delete_category: 'sync.op.delete_category',
  delete_role: 'sync.op.delete_role',
  forget: 'sync.op.forget',
} as const satisfies Record<Operation['op'], MessageKey>;

/** How many changes of each kind, in the order above, leaving out the kinds with none. */
export function syncCounts(
  operations: readonly Operation[],
): { label: MessageKey; count: number }[] {
  return (Object.keys(SYNC_LABELS) as Operation['op'][]).flatMap((op) => {
    const count = operations.filter((operation) => operation.op === op).length;
    return count === 0 ? [] : [{ label: SYNC_LABELS[op], count }];
  });
}

/** Discord's own refusals are kept short: a sync can fail many times for one reason. */
const FAILURES_SHOWN = 5;

/** The whole answer as lines of text. */
export function syncReplyLines(locale: Locale, reply: LeagueSyncReply, dryRun: boolean): string[] {
  if (!reply.ok) return [t(locale, `sync.error.${reply.error}`)];
  // A dry run with management off: what turning it on would do.
  const off = reply.managed ? [] : [t(locale, 'sync.offPreview')];
  const absent =
    reply.absentMembers.length === 0
      ? []
      : [t(locale, 'sync.absent', { count: String(reply.absentMembers.length) })];
  if (reply.operations.length === 0) return [...off, t(locale, 'sync.inSync'), ...absent];
  const counts = syncCounts(reply.operations).map(
    ({ label, count }) =>
      `• ${t(locale, 'sync.line', { label: t(locale, label), count: String(count) })}`,
  );
  if (dryRun) return [...off, t(locale, 'sync.preview'), ...counts, ...absent];
  const failures = reply.failures
    .slice(0, FAILURES_SHOWN)
    .map(
      ({ operation, message }) =>
        `• ${t(locale, 'sync.failure', { label: t(locale, SYNC_LABELS[operation.op]), message })}`,
    );
  return [
    t(locale, 'sync.applied', {
      applied: String(reply.applied),
      total: String(reply.operations.length),
    }),
    ...(reply.failures.length === 0
      ? []
      : [t(locale, 'sync.failed', { count: String(reply.failures.length) }), ...failures]),
    ...absent,
  ];
}
