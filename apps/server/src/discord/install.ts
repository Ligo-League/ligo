// The address that adds the bot to a server, with the permissions of design doc section 6
// (docs/setup.md, step 4, lists them one by one).
const BOT_PERMISSIONS = '2251800082238480';

export function botInstallUrl(clientId: string): string {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', 'bot applications.commands');
  url.searchParams.set('permissions', BOT_PERMISSIONS);
  return url.href;
}
