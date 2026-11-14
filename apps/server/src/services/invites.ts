import { createHmac, timingSafeEqual } from 'node:crypto';

// A registration's invitation link (maintainer, 14 November 2026). The secret part is an HMAC of
// the invitation's row and its random nonce under the server's secret: it is never stored, so
// the database alone does not hold a working link, yet the filer can see it again at any time.
// A new nonce, or the server's secret changing, voids every link made before.

const PURPOSE = 'ligo:registration-invite';

export function inviteToken(secret: string, invite: { id: number; nonce: string }): string {
  return createHmac('sha256', secret)
    .update(`${PURPOSE}:${String(invite.id)}:${invite.nonce}`)
    .digest('base64url');
}

/** The link to share: `/join/<invitation>/<token>` on the public site. */
export function inviteUrl(
  publicUrl: URL,
  secret: string,
  invite: { id: number; nonce: string },
): string {
  return new URL(`/join/${String(invite.id)}/${inviteToken(secret, invite)}`, publicUrl).href;
}

/** Whether `token` is this invitation's, compared in constant time. */
export function inviteTokenMatches(
  secret: string,
  invite: { id: number; nonce: string },
  token: string,
): boolean {
  const expected = Buffer.from(inviteToken(secret, invite));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
