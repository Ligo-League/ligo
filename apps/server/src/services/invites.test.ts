import { describe, expect, it } from 'vitest';
import { inviteToken, inviteTokenMatches, inviteUrl, rosterInviteUrl } from './invites.ts';

const SECRET = 'x'.repeat(40);
const INVITE = { id: 3, nonce: 'n'.repeat(43) };

describe('invitation links', () => {
  it('builds a link that only this invitation, nonce and secret match', () => {
    const url = inviteUrl(new URL('https://ligoleague.eu'), SECRET, INVITE);
    expect(url).toMatch(/^https:\/\/ligoleague\.eu\/join\/3\/[\w-]{43}$/);
    const token = url.split('/').at(-1) ?? '';
    expect(inviteTokenMatches(SECRET, INVITE, token)).toBe(true);
    expect(inviteTokenMatches(SECRET, { ...INVITE, id: 4 }, token)).toBe(false);
    expect(inviteTokenMatches(SECRET, { ...INVITE, nonce: 'm'.repeat(43) }, token)).toBe(false);
    expect(inviteTokenMatches('y'.repeat(40), INVITE, token)).toBe(false);
    expect(inviteTokenMatches(SECRET, INVITE, token.slice(1))).toBe(false);
    expect(inviteTokenMatches(SECRET, INVITE, '')).toBe(false);
  });

  it('gives the same link each time, for the filer to copy again', () => {
    expect(inviteToken(SECRET, INVITE)).toBe(inviteToken(SECRET, { ...INVITE }));
  });

  it('keeps a roster’s link and a registration’s apart', () => {
    const url = rosterInviteUrl(new URL('https://ligoleague.eu'), SECRET, INVITE);
    expect(url).toMatch(/^https:\/\/ligoleague\.eu\/invite\/3\/[\w-]{43}$/);
    const token = url.split('/').at(-1) ?? '';
    expect(inviteTokenMatches(SECRET, INVITE, token, 'roster')).toBe(true);
    expect(inviteTokenMatches(SECRET, INVITE, token)).toBe(false);
    expect(inviteTokenMatches(SECRET, INVITE, inviteToken(SECRET, INVITE), 'roster')).toBe(false);
  });
});
