const INTENT_HINT =
  'Discord refused the Guild Members intent. Enable "Server Members Intent" for the bot in the Developer Portal, click Save Changes (docs/setup.md, step 2), then start again.';
const TOKEN_HINT =
  'Discord refused DISCORD_TOKEN. Reset the bot token in the Developer Portal and copy the new one into .env (docs/setup.md, step 2).';

// discord.js reports a malformed token with an error code; the gateway library reports
// refusals from Discord (close codes 4004 and 4014) as plain errors with only a message.
const HINTS_BY_CODE: Record<string, string> = {
  DisallowedIntents: INTENT_HINT,
  TokenInvalid: TOKEN_HINT,
};
const HINTS_BY_MESSAGE: Record<string, string> = {
  'Used disallowed intents': INTENT_HINT,
  'Authentication failed': TOKEN_HINT,
};

/** What the maintainer should do about a failed login, or null when the cause is not a known one. */
export function loginHint(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  return HINTS_BY_CODE[code] ?? HINTS_BY_MESSAGE[error.message] ?? null;
}
