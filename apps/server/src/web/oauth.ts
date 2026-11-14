import { z } from 'zod';

// Discord login (design doc section 7): OAuth2 authorisation code flow, scope `identify` only.
// The access token is used once to read who logged in, then dropped; it is never stored or
// logged.

export interface DiscordUser {
  id: string;
  /** The name Discord shows: the display name, or the username without one. */
  displayName: string;
}

export interface DiscordOAuth {
  /** The Discord page that asks the user to let Ligo read their identity. */
  authorizeUrl(state: string): string;
  /** The user behind an authorisation code; null when Discord refuses the code. */
  userFor(code: string): Promise<DiscordUser | null>;
}

const API = 'https://discord.com/api/v10';
const TIMEOUT_MS = 10_000;

const tokenSchema = z.object({ access_token: z.string().min(1), token_type: z.string() });
const userSchema = z.object({
  id: z.string().regex(/^\d{17,20}$/),
  username: z.string().min(1),
  global_name: z.string().min(1).nullish(),
});

export function createDiscordOAuth(
  settings: { clientId: string; clientSecret: string; redirectUri: string },
  fetcher: typeof fetch = fetch,
): DiscordOAuth {
  return {
    authorizeUrl(state) {
      const url = new URL('https://discord.com/oauth2/authorize');
      url.search = new URLSearchParams({
        client_id: settings.clientId,
        response_type: 'code',
        scope: 'identify',
        redirect_uri: settings.redirectUri,
        state,
        prompt: 'none',
      }).toString();
      return url.href;
    },

    async userFor(code) {
      const tokenResponse = await fetcher(`${API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: settings.redirectUri,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
      // A refused code is the user's: expired, used twice, or forged.
      if (tokenResponse.status === 400 || tokenResponse.status === 401) return null;
      if (!tokenResponse.ok)
        throw new Error(`Discord answered ${tokenResponse.status} for a token`);
      const token = tokenSchema.safeParse(await tokenResponse.json());
      if (!token.success) throw new Error('Discord sent a token in an unknown shape');

      const userResponse = await fetcher(`${API}/users/@me`, {
        headers: { Authorization: `Bearer ${token.data.access_token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
      if (!userResponse.ok) throw new Error(`Discord answered ${userResponse.status} for a user`);
      const user = userSchema.safeParse(await userResponse.json());
      if (!user.success) throw new Error('Discord sent a user in an unknown shape');
      return { id: user.data.id, displayName: user.data.global_name ?? user.data.username };
    },
  };
}

/** An in-memory Discord for tests: each code names a user, and any other code is refused. */
export function fakeDiscordOAuth(users: Record<string, DiscordUser>): DiscordOAuth & {
  states: string[];
} {
  const states: string[] = [];
  return {
    states,
    authorizeUrl(state) {
      states.push(state);
      return `https://discord.example/authorize?state=${encodeURIComponent(state)}`;
    },
    userFor(code) {
      return Promise.resolve(users[code] ?? null);
    },
  };
}
