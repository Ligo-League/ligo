import { PermissionsBitField } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { BOT_PERMISSIONS, inviteUrl } from './permissions.ts';

describe('bot invite', () => {
  it('asks for exactly the permissions of docs/setup.md', () => {
    expect(new PermissionsBitField(BOT_PERMISSIONS).toArray().sort()).toEqual([
      'AttachFiles',
      'EmbedLinks',
      'ManageChannels',
      'ManageRoles',
      'PinMessages',
      'ReadMessageHistory',
      'SendMessages',
      'ViewChannel',
    ]);
  });

  it('never asks for Administrator or Manage Messages', () => {
    const permissions = new PermissionsBitField(BOT_PERMISSIONS);
    expect(permissions.has('Administrator', false)).toBe(false);
    expect(permissions.has('ManageMessages', false)).toBe(false);
  });

  it('builds the invite URL written in docs/setup.md', () => {
    expect(inviteUrl('123456789012345678')).toBe(
      'https://discord.com/oauth2/authorize?client_id=123456789012345678&scope=bot+applications.commands&permissions=2251800082238480',
    );
  });
});
