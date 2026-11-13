import { describe, expect, it, vi } from 'vitest';
import type { Command } from './commands/types.ts';
import { routeAutocomplete, routeCommand } from './router.ts';
import { fakeAutocomplete, fakeContext, fakeInteraction } from './testing.ts';

const context = fakeContext();
const command = (name: string, execute: Command['execute']): Command => ({
  data: { name, description: name },
  execute,
});

describe('routeCommand', () => {
  it('runs the command named by the interaction', async () => {
    const logger = { error: vi.fn() };
    const hello = command('hello', (interaction) =>
      interaction.reply({ content: 'hi', ephemeral: false }),
    );
    const other = command('other', () => Promise.reject(new Error('must not run')));
    const interaction = fakeInteraction('hello');

    await routeCommand([other, hello], interaction, context, logger);

    expect(interaction.replies).toEqual([{ content: 'hi', ephemeral: false }]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('answers an unknown command privately', async () => {
    const interaction = fakeInteraction('nope');
    await routeCommand([], interaction, context, { error: vi.fn() });
    expect(interaction.replies).toEqual([{ content: 'Commande inconnue.', ephemeral: true }]);
  });

  it('logs a failing command and answers privately without the error details', async () => {
    const logger = { error: vi.fn() };
    const failure = new Error('database password is hunter2');
    const broken = command('broken', () => Promise.reject(failure));
    const interaction = fakeInteraction('broken');

    await routeCommand([broken], interaction, context, logger);

    expect(logger.error).toHaveBeenCalledWith(
      { err: failure, command: 'broken' },
      'Command failed',
    );
    expect(interaction.replies).toEqual([
      { content: 'Une erreur est survenue. Réessaie dans un instant.', ephemeral: true },
    ]);
  });

  it('does not reply twice when the command fails after answering', async () => {
    const logger = { error: vi.fn() };
    const halfDone = command('half', async (interaction) => {
      await interaction.reply({ content: 'working', ephemeral: true });
      throw new Error('failed afterwards');
    });
    const interaction = fakeInteraction('half');

    await routeCommand([halfDone], interaction, context, logger);

    expect(interaction.replies).toEqual([{ content: 'working', ephemeral: true }]);
    expect(logger.error).toHaveBeenCalledOnce();
  });
});

describe('routeCommand after a deferral', () => {
  it('still tells the member when the command fails before its reply', async () => {
    const logger = { error: vi.fn() };
    const slow = command('slow', async (interaction) => {
      await interaction.defer();
      throw new Error('rendering failed');
    });
    const interaction = fakeInteraction('slow');

    await routeCommand([slow], interaction, context, logger);

    expect(interaction.deferred).toBe(true);
    expect(interaction.replies).toEqual([
      { content: 'Une erreur est survenue. Réessaie dans un instant.', ephemeral: true },
    ]);
    expect(logger.error).toHaveBeenCalledOnce();
  });
});

describe('routeAutocomplete', () => {
  const focused = { name: 'match', value: 'rck' };

  it('asks the command for its suggestions', async () => {
    const suggesting: Command = {
      ...command('pick', () => Promise.resolve()),
      autocomplete: (interaction) =>
        interaction.respond([{ name: `found ${interaction.focused.value}`, value: 7 }]),
    };
    const interaction = fakeAutocomplete('pick', focused);

    await routeAutocomplete([suggesting], interaction, context, { error: vi.fn() });

    expect(interaction.responses).toEqual([[{ name: 'found rck', value: 7 }]]);
  });

  it('answers with no suggestion for an unknown command or one that has none', async () => {
    const plain = command('plain', () => Promise.resolve());
    for (const name of ['nope', 'plain']) {
      const interaction = fakeAutocomplete(name, focused);
      await routeAutocomplete([plain], interaction, context, { error: vi.fn() });
      expect(interaction.responses).toEqual([[]]);
    }
  });

  it('logs a failure and answers with no suggestion', async () => {
    const logger = { error: vi.fn() };
    const failure = new Error('database is locked');
    const broken: Command = {
      ...command('broken', () => Promise.resolve()),
      autocomplete: () => Promise.reject(failure),
    };
    const interaction = fakeAutocomplete('broken', focused);

    await routeAutocomplete([broken], interaction, context, logger);

    expect(logger.error).toHaveBeenCalledWith(
      { err: failure, command: 'broken' },
      'Autocomplete failed',
    );
    expect(interaction.responses).toEqual([[]]);
  });
});
