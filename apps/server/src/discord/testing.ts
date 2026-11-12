import type { CommandInteraction } from './commands/types.ts';

export interface FakeInteraction extends CommandInteraction {
  replies: { content: string; ephemeral: boolean }[];
}

/** An in-memory stand-in for a Discord slash-command interaction. */
export function fakeInteraction(commandName: string): FakeInteraction {
  const replies: FakeInteraction['replies'] = [];
  return {
    commandName,
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
