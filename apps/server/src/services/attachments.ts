// A file attached to a slash command is hosted by Discord. Its address is a signed link: it
// expires, and it must stay out of logs.
const DISCORD_ATTACHMENT_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];

/** True for an https address on one of Discord's attachment hosts, and nothing else. */
export function isDiscordAttachmentUrl(address: string): boolean {
  if (!URL.canParse(address)) return false;
  const url = new URL(address);
  return url.protocol === 'https:' && DISCORD_ATTACHMENT_HOSTS.includes(url.hostname);
}
