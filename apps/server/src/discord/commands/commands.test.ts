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

// Every description Discord shows: the command's own, its subcommands' and their options'.
interface Described {
  name: string;
  description: string;
  description_localizations?: Partial<Record<string, string | null>> | null;
  options?: readonly unknown[];
}
function everyDescription(node: Described): Described[] {
  const children = (node.options ?? []) as Described[];
  return [node, ...children.flatMap(everyDescription)];
}

describe('command list', () => {
  it('has unique names that Discord accepts', () => {
    const names = commands.map((command) => command.data.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z0-9_-]{1,32}$/);
  });

  it('gives every command, subcommand and option a French description with an English translation, within 100 characters', () => {
    const described = commands.flatMap(({ data }) => everyDescription(data as Described));
    expect(described.length).toBeGreaterThan(commands.length);
    for (const node of described) {
      const english = node.description_localizations?.['en-US'];
      expect(node.name).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(node.description.length, node.name).toBeGreaterThan(0);
      expect(node.description.length, node.name).toBeLessThanOrEqual(100);
      expect(english?.length, node.name).toBeGreaterThan(0);
      expect(english?.length, node.name).toBeLessThanOrEqual(100);
    }
  });
});
