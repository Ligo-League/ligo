import { OAuth2Scopes, PermissionFlagsBits, PermissionsBitField } from 'discord.js';

/**
 * What the bot is invited with (design doc section 6, "Bot setup").
 * Pin Messages replaces the doc's "Manage Messages (for pinning)": since 23 February 2026
 * Discord requires this separate permission to pin, and nothing else needs Manage Messages.
 */
export const BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.PinMessages,
] as const;

export const BOT_SCOPES = [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands] as const;

/** The URL a server admin opens to add the bot with exactly these permissions. */
export function inviteUrl(clientId: string): string {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', BOT_SCOPES.join(' '));
  url.searchParams.set('permissions', new PermissionsBitField(BOT_PERMISSIONS).bitfield.toString());
  return url.toString();
}
