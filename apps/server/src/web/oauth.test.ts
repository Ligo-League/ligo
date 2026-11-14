import { describe, expect, it } from 'vitest';
import { createDiscordOAuth } from './oauth.ts';

const SETTINGS = {
  clientId: '123456789012345678',
  clientSecret: 'client-secret-value',
  redirectUri: 'http://localhost:3000/auth/callback',
};

/** A fetch that answers from a list, and keeps what it was asked. */
function fakeFetch(...answers: Response[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = (input, init) => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), init });
    const answer = answers.shift();
    return answer ? Promise.resolve(answer) : Promise.reject(new Error('Unexpected call'));
  };
  return { fetcher, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createDiscordOAuth', () => {
  it('asks Discord for the identify scope only, with the state and the redirect', () => {
    const url = new URL(createDiscordOAuth(SETTINGS).authorizeUrl('abc'));
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: SETTINGS.clientId,
      response_type: 'code',
      scope: 'identify',
      redirect_uri: SETTINGS.redirectUri,
      state: 'abc',
      prompt: 'none',
    });
  });

  it('trades the code for a token, then reads the user with it', async () => {
    const { fetcher, calls } = fakeFetch(
      json({ access_token: 'token-1', token_type: 'Bearer' }),
      json({ id: '700000000000000001', username: 'ana', global_name: 'Ana' }),
    );
    const user = await createDiscordOAuth(SETTINGS, fetcher).userFor('code-1');
    expect(user).toEqual({ id: '700000000000000001', displayName: 'Ana' });
    expect(calls[0]?.url).toBe('https://discord.com/api/v10/oauth2/token');
    const body = calls[0]?.init?.body;
    expect(body instanceof URLSearchParams && Object.fromEntries(body)).toEqual({
      client_id: SETTINGS.clientId,
      client_secret: SETTINGS.clientSecret,
      grant_type: 'authorization_code',
      code: 'code-1',
      redirect_uri: SETTINGS.redirectUri,
    });
    expect(calls[1]?.url).toBe('https://discord.com/api/v10/users/@me');
    expect(calls[1]?.init?.headers).toEqual({ Authorization: 'Bearer token-1' });
  });

  it('falls back to the username when there is no display name', async () => {
    const { fetcher } = fakeFetch(
      json({ access_token: 'token-1', token_type: 'Bearer' }),
      json({ id: '700000000000000001', username: 'ana', global_name: null }),
    );
    expect(await createDiscordOAuth(SETTINGS, fetcher).userFor('code-1')).toMatchObject({
      displayName: 'ana',
    });
  });

  it('answers null for a code Discord refuses', async () => {
    const { fetcher, calls } = fakeFetch(json({ error: 'invalid_grant' }, 400));
    expect(await createDiscordOAuth(SETTINGS, fetcher).userFor('stale')).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('fails on an outage or an unknown answer, without repeating the secret', async () => {
    const outage = createDiscordOAuth(SETTINGS, fakeFetch(json({}, 503)).fetcher);
    await expect(outage.userFor('code')).rejects.toThrow('503');
    const odd = createDiscordOAuth(
      SETTINGS,
      fakeFetch(json({ access_token: 'token-1', token_type: 'Bearer' }), json({ id: 'x' })).fetcher,
    );
    const error = await odd.userFor('code').catch((caught: unknown) => caught);
    expect(String(error)).not.toContain(SETTINGS.clientSecret);
    expect(String(error)).not.toContain('token-1');
  });
});
