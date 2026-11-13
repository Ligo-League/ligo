import { openTestDatabase } from '@ligo/db/testing';
import type {
  AutocompleteChoice,
  AutocompleteInteraction,
  CommandAttachment,
  CommandContext,
  CommandInteraction,
} from './commands/types.ts';

type OptionValue = string | number | CommandAttachment;

export interface FakeInput {
  guildId?: string | null;
  user?: { id: string; displayName: string };
  memberRoleIds?: readonly string[];
  subcommand?: string;
  options?: Record<string, OptionValue>;
}

const actorOf = (input: FakeInput) => ({
  guildId: input.guildId ?? null,
  user: input.user ?? { id: '555555555555555555', displayName: 'Member' },
  memberRoleIds: input.memberRoleIds ?? [],
});

export interface FakeInteraction extends CommandInteraction {
  replies: { content: string; ephemeral: boolean }[];
}

/** An in-memory stand-in for a Discord slash-command interaction. */
export function fakeInteraction(commandName: string, input: FakeInput = {}): FakeInteraction {
  const replies: FakeInteraction['replies'] = [];
  const option = (name: string) => input.options?.[name];
  return {
    ...actorOf(input),
    commandName,
    options: {
      getSubcommand: () => input.subcommand ?? null,
      getString: (name) => {
        const value = option(name);
        return typeof value === 'string' ? value : null;
      },
      getInteger: (name) => {
        const value = option(name);
        return typeof value === 'number' ? value : null;
      },
      getAttachment: (name) => {
        const value = option(name);
        return typeof value === 'object' ? value : null;
      },
    },
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

export interface FakeAutocomplete extends AutocompleteInteraction {
  responses: AutocompleteChoice[][];
}

/** An in-memory stand-in for the interaction Discord sends while an option is being typed. */
export function fakeAutocomplete(
  commandName: string,
  focused: { name: string; value: string },
  input: FakeInput = {},
): FakeAutocomplete {
  const responses: AutocompleteChoice[][] = [];
  return {
    ...actorOf(input),
    commandName,
    options: { getSubcommand: () => input.subcommand ?? null },
    focused,
    responses,
    respond(choices) {
      responses.push([...choices]);
      return Promise.resolve();
    },
  };
}

/** A command context in French over an empty in-memory database, unless overridden. */
export function fakeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    locale: 'fr',
    gatewayPingMs: 10,
    db: openTestDatabase(),
    now: () => 1_800_000_000_000,
    ...overrides,
  };
}
