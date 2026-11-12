import { describe, expect, it } from 'vitest';
import { fakeContext, fakeInteraction } from '../testing.ts';
import { commands } from './index.ts';
import { pingCommand } from './ping.ts';

describe('/ping', () => {
  it('answers privately, in French, with the gateway latency', async () => {
    const interaction = fakeInteraction('ping');
    await pingCommand.execute(interaction, fakeContext({ gatewayPingMs: 41.6 }));
    expect(interaction.replies).toEqual([
      { content: 'Pong ! Latence de la passerelle : 42 ms.', ephemeral: true },
    ]);
  });

  it('answers in English when asked to', async () => {
    const interaction = fakeInteraction('ping');
    await pingCommand.execute(interaction, fakeContext({ locale: 'en', gatewayPingMs: 7 }));
    expect(interaction.replies).toEqual([
      { content: 'Pong! Gateway latency: 7 ms.', ephemeral: true },
    ]);
  });

  it('leaves the latency out before the first gateway heartbeat (-1)', async () => {
    const interaction = fakeInteraction('ping');
    await pingCommand.execute(interaction, fakeContext({ gatewayPingMs: -1 }));
    expect(interaction.replies).toEqual([{ content: 'Pong !', ephemeral: true }]);
  });
});

describe('command list', () => {
  it('has unique names that Discord accepts', () => {
    const names = commands.map((command) => command.data.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z0-9_-]{1,32}$/);
  });

  it('gives every command a French description with an English translation, within 100 characters', () => {
    for (const { data } of commands) {
      const english = data.description_localizations?.['en-US'];
      expect(data.description.length).toBeGreaterThan(0);
      expect(data.description.length).toBeLessThanOrEqual(100);
      expect(english?.length).toBeGreaterThan(0);
      expect(english?.length).toBeLessThanOrEqual(100);
    }
  });
});
