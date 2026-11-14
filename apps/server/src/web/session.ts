import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import type { DiscordOAuth } from './oauth.ts';

// Sessions (design doc section 7): a signed, httpOnly, SameSite=Lax cookie holding the player ID
// and when the session started. Nothing else about the player lives in the cookie: every request
// reads the player, and what they may do, from the database.

export interface LoginSettings {
  oauth: DiscordOAuth;
  /** Signs the cookies and the CSRF tokens; from SESSION_SECRET. */
  secret: string;
  /** The address people use; Discord sends them back to it. */
  publicUrl: URL;
}

export const SESSION_COOKIE = 'ligo_session';
const LOGIN_COOKIE = 'ligo_login';
export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 3600 * 1000;
// Time to click "Authorise" on Discord's page.
const LOGIN_SECONDS = 10 * 60;

const cookieOptions = (settings: LoginSettings, maxAge: number): CookieOptions => ({
  httpOnly: true,
  sameSite: 'Lax',
  secure: settings.publicUrl.protocol === 'https:',
  path: '/',
  maxAge,
});

export interface Session {
  playerId: number;
  /** The signed value itself: the CSRF token is derived from it. */
  value: string;
}

export async function startSession(
  c: Context,
  settings: LoginSettings,
  playerId: number,
  now: number,
): Promise<void> {
  await setSignedCookie(
    c,
    SESSION_COOKIE,
    `${String(playerId)}.${String(now)}`,
    settings.secret,
    cookieOptions(settings, SESSION_MS / 1000),
  );
}

/** The session of this request; null for none, a forged cookie, or one older than 30 days. */
export async function readSession(
  c: Context,
  settings: LoginSettings,
  now: number,
): Promise<Session | null> {
  const value = await getSignedCookie(c, settings.secret, SESSION_COOKIE);
  const parts = typeof value === 'string' ? /^([1-9]\d{0,9})\.(\d{1,15})$/.exec(value) : null;
  if (!value || !parts) return null;
  const startedAt = Number(parts[2]);
  if (startedAt > now || now - startedAt > SESSION_MS) return null;
  return { playerId: Number(parts[1]), value };
}

export function endSession(c: Context, settings: LoginSettings): void {
  deleteCookie(c, SESSION_COOKIE, cookieOptions(settings, 0));
}

/** A fresh login: the state Discord sends back, and where to go after. */
export async function startLogin(
  c: Context,
  settings: LoginSettings,
  next: string,
): Promise<string> {
  const state = randomBytes(32).toString('base64url');
  await setSignedCookie(
    c,
    LOGIN_COOKIE,
    `${state}|${next}`,
    settings.secret,
    cookieOptions(settings, LOGIN_SECONDS),
  );
  return state;
}

/**
 * Where to go after login, if `state` is the one this browser was given; null otherwise. The
 * login cookie is used once.
 */
export async function finishLogin(
  c: Context,
  settings: LoginSettings,
  state: string,
): Promise<string | null> {
  const value = await getSignedCookie(c, settings.secret, LOGIN_COOKIE);
  deleteCookie(c, LOGIN_COOKIE, cookieOptions(settings, 0));
  if (!value) return null;
  const separator = value.indexOf('|');
  if (separator < 0 || !sameText(value.slice(0, separator), state)) return null;
  return safeNext(value.slice(separator + 1));
}

/** A path on this site to go back to; anything else (another site, `//host`) goes to `/me`. */
export function safeNext(next: string | undefined): string {
  if (!next || next.length > 200) return '/me';
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/me';
  return /^[\x21-\x7e]+$/.test(next) ? next : '/me';
}

/** The token a session's forms carry: an HMAC of the session, so it changes with each login. */
export function csrfToken(settings: LoginSettings, session: Session): string {
  return createHmac('sha256', settings.secret).update(`csrf:${session.value}`).digest('base64url');
}

export function checkCsrfToken(settings: LoginSettings, session: Session, token: unknown): boolean {
  return typeof token === 'string' && sameText(token, csrfToken(settings, session));
}

/** Compares in constant time, so a wrong guess says nothing about how close it was. */
function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
