import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// The server's own presigned upload, for a machine without R2 (design doc section 8, upload
// flow 5): the token names one key, size and type and when it stops working, signed with the
// session secret under its own label, so it can never pass for a session or a CSRF token.

export interface UploadGrant {
  key: string;
  size: number;
  contentType: string;
  /** Unix milliseconds. */
  expiresAt: number;
}

const grantSchema = z.strictObject({
  key: z.string().min(1).max(512),
  size: z.int().min(0),
  contentType: z.string().min(1).max(100),
  expiresAt: z.int(),
});

const sign = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(`upload:${payload}`).digest();

export function signUploadToken(secret: string, grant: UploadGrant): string {
  const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
  return `${payload}.${sign(secret, payload).toString('base64url')}`;
}

/** The grant, or null for a token that was changed, signed elsewhere, or has expired. */
export function readUploadToken(secret: string, token: string, now: number): UploadGrant | null {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = sign(secret, payload);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const grant = grantSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    return grant.expiresAt > now ? grant : null;
  } catch {
    return null;
  }
}
