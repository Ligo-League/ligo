// One change to a league's server at a time (phase 4; design doc section 6): a sync, or staff
// linking a team role. Two at once would both create what is missing, or one would store a role
// the other just replaced.

const running = new Map<string, Promise<unknown>>();

/** Runs `task` after anything for the same server still under way. */
export function withGuildLock<T>(guildId: string, task: () => Promise<T>): Promise<T> {
  const before = running.get(guildId) ?? Promise.resolve();
  const next = before.then(task, task);
  running.set(guildId, next);
  void next.finally(() => {
    if (running.get(guildId) === next) running.delete(guildId);
  });
  return next;
}
