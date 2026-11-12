import { describe, expect, it } from 'vitest';
import { loginHint } from './login-hint.ts';

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

describe('loginHint', () => {
  it.each([
    ['the gateway closing with "Used disallowed intents"', new Error('Used disallowed intents')],
    [
      'the discord.js DisallowedIntents code',
      withCode('Privileged intent provided is not enabled.', 'DisallowedIntents'),
    ],
  ])('points at the Server Members Intent for %s', (_label, error) => {
    expect(loginHint(error)).toMatch(/Server Members Intent/);
  });

  it.each([
    ['the gateway closing with "Authentication failed"', new Error('Authentication failed')],
    [
      'the discord.js TokenInvalid code',
      withCode('An invalid token was provided.', 'TokenInvalid'),
    ],
  ])('points at the token for %s', (_label, error) => {
    expect(loginHint(error)).toMatch(/DISCORD_TOKEN/);
  });

  it.each([
    ['an unrelated error', new Error('getaddrinfo ENOTFOUND gateway.discord.gg')],
    ['something that is not an error', 'Used disallowed intents'],
    ['nothing', undefined],
  ])('gives no hint for %s', (_label, error) => {
    expect(loginHint(error)).toBeNull();
  });
});
