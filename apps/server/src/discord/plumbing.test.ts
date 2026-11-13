import { describe, expect, it, vi } from 'vitest';
import { isDiscordAttachmentUrl } from '../services/attachments.ts';
import { buttonId, parseButtonId } from './button-id.ts';
import type { ButtonHandler, FormHandler } from './commands/types.ts';
import { readCapped } from './gateway.ts';
import { toDiscordMessage, toDiscordModal } from './outgoing.ts';
import { routeButton, routeForm } from './router.ts';
import { fakeButton, fakeContext, fakeForm, fakeGateway } from './testing.ts';

describe('button IDs', () => {
  it('are written as action:entityId:nonce and read back', () => {
    const id = buttonId('report-confirm', 42, 7);
    expect(id).toBe('report-confirm:42:7');
    expect(parseButtonId(id)).toEqual({ action: 'report-confirm', entityId: 42, nonce: '7' });
  });

  it.each([
    'report-confirm:42',
    'report-confirm:0:7',
    'report-confirm:-1:7',
    'report-confirm:4.2:7',
    'Report:42:7',
    'report confirm:42:7',
    'report-confirm:42:a b',
    'report-confirm:42:7:extra',
    ':42:7',
    '',
  ])('reads nothing from %j', (customId) => {
    expect(parseButtonId(customId)).toBeNull();
  });

  it('refuses to write an ID it could not read back', () => {
    expect(() => buttonId('Report', 1, 1)).toThrow(/Not a valid button ID/);
    expect(() => buttonId('report', 0, 1)).toThrow(/Not a valid button ID/);
    expect(() => buttonId('report', 1, 'a:b')).toThrow(/Not a valid button ID/);
  });

  it('stay within the 100 characters Discord allows', () => {
    expect(buttonId('a-rather-long-action-name', 999_999_999_999_999, 'x'.repeat(32)).length).toBe(
      74,
    );
  });
});

describe('routeButton', () => {
  const context = fakeContext();
  const handler = (action: string, execute: ButtonHandler['execute']): ButtonHandler => ({
    action,
    execute,
  });

  it('runs the handler of the action with the entity and the nonce', async () => {
    const seen = vi.fn();
    const confirm = handler('confirm', async (interaction, target) => {
      seen(target);
      await interaction.update({ content: 'confirmed' });
    });
    const other = handler('other', () => Promise.reject(new Error('must not run')));
    const interaction = fakeButton('confirm:12:abc');

    await routeButton([other, confirm], interaction, context, { error: vi.fn() });

    expect(seen).toHaveBeenCalledWith({ action: 'confirm', entityId: 12, nonce: 'abc' });
    expect(interaction.updates).toEqual([{ content: 'confirmed' }]);
  });

  it.each(['gone:12:abc', 'not a button id'])(
    'answers %j privately: nothing handles it',
    async (customId) => {
      const interaction = fakeButton(customId);
      await routeButton([], interaction, context, { error: vi.fn() });
      expect(interaction.replies).toEqual([
        { content: "Ce bouton n'est plus utilisable.", ephemeral: true },
      ]);
    },
  );

  it('logs a failing handler and answers privately without the error details', async () => {
    const logger = { error: vi.fn() };
    const failure = new Error('secret detail');
    const broken = handler('broken', () => Promise.reject(failure));
    const interaction = fakeButton('broken:3:x');

    await routeButton([broken], interaction, context, logger);

    expect(logger.error).toHaveBeenCalledWith(
      { err: failure, action: 'broken', entityId: 3 },
      'Button failed',
    );
    expect(interaction.replies).toEqual([
      { content: 'Une erreur est survenue. Réessaie dans un instant.', ephemeral: true },
    ]);
  });

  it('does not answer twice when the handler fails after answering', async () => {
    const halfDone = handler('half', async (interaction) => {
      await interaction.update({ content: 'done' });
      throw new Error('failed afterwards');
    });
    const interaction = fakeButton('half:3:x');
    await routeButton([halfDone], interaction, context, { error: vi.fn() });
    expect(interaction.updates).toHaveLength(1);
    expect(interaction.replies).toEqual([]);
  });
});

describe('routeForm', () => {
  const context = fakeContext();

  it('runs the handler of the action with what was sent', async () => {
    const seen = vi.fn();
    const handler: FormHandler = {
      action: 'report-dispute',
      async execute(interaction, target) {
        seen(target, interaction.getSelected('reason'), interaction.getText('details'));
        await interaction.update({ content: 'disputed' });
      },
    };
    const interaction = fakeForm('report-dispute:3:9', {
      selected: { reason: ['wrong_score'] },
      text: { details: 'Mauvais score' },
    });
    await routeForm([handler], interaction, context, { error: vi.fn() });
    expect(seen).toHaveBeenCalledWith(
      { action: 'report-dispute', entityId: 3, nonce: '9' },
      ['wrong_score'],
      'Mauvais score',
    );
    expect(interaction.updates).toEqual([{ content: 'disputed' }]);
  });

  it('reads an empty or missing field as nothing', () => {
    const interaction = fakeForm('a:1:1', { text: { details: '' } });
    expect(interaction.getText('details')).toBeNull();
    expect(interaction.getText('missing')).toBeNull();
    expect(interaction.getSelected('missing')).toEqual([]);
  });

  it('answers a form nothing handles privately, and a failure without its details', async () => {
    const unknown = fakeForm('gone:1:1');
    await routeForm([], unknown, context, { error: vi.fn() });
    expect(unknown.replies).toEqual([
      { content: "Ce formulaire n'est plus utilisable.", ephemeral: true },
    ]);

    const logger = { error: vi.fn() };
    const broken = fakeForm('broken:2:x');
    await routeForm(
      [{ action: 'broken', execute: () => Promise.reject(new Error('secret detail')) }],
      broken,
      context,
      logger,
    );
    expect(logger.error).toHaveBeenCalledOnce();
    expect(broken.replies).toEqual([
      { content: 'Une erreur est survenue. Réessaie dans un instant.', ephemeral: true },
    ]);
  });
});

describe('toDiscordModal', () => {
  it('puts each field under its own label: a list, then a long text', () => {
    const modal = toDiscordModal({
      customId: 'report-dispute:3:9',
      title: 'Contester le résultat',
      fields: [
        {
          kind: 'select',
          id: 'reason',
          label: 'Motif',
          options: [
            { value: 'wrong_score', label: 'Score incorrect' },
            { value: 'other', label: 'Autre' },
          ],
        },
        {
          kind: 'text',
          id: 'details',
          label: 'Détails',
          description: 'Obligatoires pour « Autre ».',
          required: false,
          maxLength: 1000,
        },
      ],
    }).toJSON();
    expect(modal).toMatchObject({
      custom_id: 'report-dispute:3:9',
      title: 'Contester le résultat',
      components: [
        {
          label: 'Motif',
          component: {
            custom_id: 'reason',
            required: true,
            options: [
              { value: 'wrong_score', label: 'Score incorrect' },
              { value: 'other', label: 'Autre' },
            ],
          },
        },
        {
          label: 'Détails',
          description: 'Obligatoires pour « Autre ».',
          component: { custom_id: 'details', required: false, max_length: 1000, style: 2 },
        },
      ],
    });
  });
});

describe('toDiscordMessage', () => {
  it('notifies nobody unless users are named: a team name cannot ping @everyone', () => {
    expect(toDiscordMessage({ content: '@everyone <@&1> <@2>' }).allowedMentions).toEqual({
      parse: [],
      users: [],
    });
    expect(toDiscordMessage({ content: 'hi <@2>', mentionUserIds: ['2'] }).allowedMentions).toEqual(
      { parse: [], users: ['2'] },
    );
  });

  it('puts the buttons in one row and sends none when there are none', () => {
    expect(toDiscordMessage({ content: 'x' }).components).toEqual([]);
    const [row] = toDiscordMessage({
      content: 'x',
      buttons: [
        { customId: 'a:1:n', label: 'Confirmer', style: 'success' },
        { customId: 'b:1:n', label: 'Contester', style: 'danger' },
      ],
    }).components;
    expect(row?.toJSON().components).toMatchObject([
      { custom_id: 'a:1:n', label: 'Confirmer', style: 3 },
      { custom_id: 'b:1:n', label: 'Contester', style: 4 },
    ]);
  });

  it('starts a new row every five buttons, as Discord requires', () => {
    const buttons = Array.from({ length: 9 }, (_button, index) => ({
      customId: `veto:1:0x${index}`,
      label: `Map ${index}`,
      style: 'danger' as const,
    }));
    const rows = toDiscordMessage({ content: 'x', buttons }).components;
    expect(rows.map((row) => row.toJSON().components.length)).toEqual([5, 4]);
  });

  it('attaches files under their name', () => {
    const { files } = toDiscordMessage({
      content: '',
      files: [{ name: 'score.png', data: new Uint8Array([1, 2, 3]) }],
    });
    expect(files.map((file) => file.name)).toEqual(['score.png']);
  });
});

describe('isDiscordAttachmentUrl', () => {
  it.each([
    'https://cdn.discordapp.com/attachments/1/2/score.png?ex=1&is=2&hm=3',
    'https://media.discordapp.net/attachments/1/2/score.png',
  ])('accepts %s', (url) => {
    expect(isDiscordAttachmentUrl(url)).toBe(true);
  });

  it.each([
    'http://cdn.discordapp.com/attachments/1/2/score.png',
    'https://cdn.discordapp.com.evil.example/score.png',
    'https://evil.example/cdn.discordapp.com/score.png',
    'https://example.com/score.png',
    'file:///etc/passwd',
    'score.png',
    '',
  ])('refuses %s', (url) => {
    expect(isDiscordAttachmentUrl(url)).toBe(false);
  });
});

describe('readCapped', () => {
  const stream = (...chunks: number[][]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
        controller.close();
      },
    });

  it('joins the chunks of a file within the limit', async () => {
    expect([...(await readCapped(stream([1, 2], [3], [4, 5]), 5))]).toEqual([1, 2, 3, 4, 5]);
    expect([...(await readCapped(stream(), 5))]).toEqual([]);
  });

  it('stops reading as soon as the file is over the limit', async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1000));
      },
    });
    await expect(readCapped(endless, 2500)).rejects.toThrow(/larger than 2500 bytes/);
    expect(pulled).toBeLessThan(10);
  });
});

describe('fakeGateway', () => {
  it('keeps posted messages, applies edits and can be made to fail', async () => {
    const gateway = fakeGateway();
    const { messageId, url } = await gateway.postMessage('111', { content: 'first' });
    expect(url).toBe(`https://discord.com/channels/1/111/${messageId}`);
    await gateway.editMessage('111', messageId, { content: 'edited' });
    expect(gateway.posted).toMatchObject([
      { channelId: '111', messageId, message: { content: 'edited' }, edits: 1 },
    ]);
    await expect(gateway.editMessage('111', '0', { content: 'x' })).rejects.toThrow();

    gateway.failing = true;
    await expect(gateway.postMessage('111', { content: 'x' })).rejects.toThrow(/unreachable/);
    await expect(gateway.downloadAttachment('https://x', 10)).rejects.toThrow(/unreachable/);
  });
});
