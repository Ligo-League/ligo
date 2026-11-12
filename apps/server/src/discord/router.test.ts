import { describe, expect, it, vi } from 'vitest';
import type { Command } from './commands/types.ts';
import { routeCommand } from './router.ts';
import { fakeInteraction } from './testing.ts';

const context = { locale: 'fr' as const, gatewayPingMs: 10 };
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
