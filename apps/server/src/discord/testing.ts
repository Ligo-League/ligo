import { openTestDatabase } from '@ligo/db/testing';
import type { CommandContext, CommandInteraction } from './commands/types.ts';

export interface FakeInteraction extends CommandInteraction {
  replies: { content: string; ephemeral: boolean }[];
}

/** An in-memory stand-in for a Discord slash-command interaction. */
export function fakeInteraction(
  commandName: string,
  input: { guildId?: string | null; options?: Record<string, string> } = {},
): FakeInteraction {
  const replies: FakeInteraction['replies'] = [];
  return {
    commandName,
    guildId: input.guildId ?? null,
    options: { getString: (name) => input.options?.[name] ?? null },
    replies,
    get answered() {
      return replies.length > 0;
    },
    reply(message) {
      // Discord refuses a second reply to the same interaction.
      if (replies.length > 0) return Promise.reject(new Error('Interaction already answered'));
      replies.push(message);
      return Promise.resolve();
    },
  };
}

/** A command context in French over an empty in-memory database, unless overridden. */
export function fakeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return { locale: 'fr', gatewayPingMs: 10, db: openTestDatabase(), ...overrides };
}
