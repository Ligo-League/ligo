import { createHmac, timingSafeEqual } from 'node:crypto';

// Invitation links: a registration's (maintainer, 14 November 2026) and a roster's (M-33). The
// secret part is an HMAC of the invitation's row and its random nonce under the server's secret:
// it is never stored, so the database alone does not hold a working link, yet the officials can
// see it again at any time. A new nonce, or the server's secret changing, voids every link made
// before. The purpose keeps one kind of link from opening the other.

export type InvitePurpose = 'registration' | 'roster';

const PURPOSES: Record<InvitePurpose, string> = {
  registration: 'ligo:registration-invite',
  roster: 'ligo:roster-invite',
};

export function inviteToken(
  secret: string,
  invite: { id: number; nonce: string },
  purpose: InvitePurpose = 'registration',
): string {
  return createHmac('sha256', secret)
    .update(`${PURPOSES[purpose]}:${String(invite.id)}:${invite.nonce}`)
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

/** A roster's link to share: `/invite/<invitation>/<token>` on the public site. */
export function rosterInviteUrl(
  publicUrl: URL,
  secret: string,
  invite: { id: number; nonce: string },
): string {
  const token = inviteToken(secret, invite, 'roster');
  return new URL(`/invite/${String(invite.id)}/${token}`, publicUrl).href;
}

/** Whether `token` is this invitation's, compared in constant time. */
export function inviteTokenMatches(
  secret: string,
  invite: { id: number; nonce: string },
  token: string,
  purpose: InvitePurpose = 'registration',
): boolean {
  const expected = Buffer.from(inviteToken(secret, invite, purpose));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
