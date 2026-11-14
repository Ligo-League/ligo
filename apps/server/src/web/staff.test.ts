import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../services/permissions.ts';
import { recordQueuePost } from '../services/queue-posts.ts';
import { answerReport, reportResult, validateResult } from '../services/reports.ts';
import { answerRequest, fileRequest } from '../services/requests.ts';
import { listTeamStaff, setTeamOwner } from '../services/team-staff.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, testSite } from './testing.ts';

// The staff queue on the website (design doc section 7): what waits, and the decisions, which
// mark the bot's posts in the Discord staff queue as the buttons do.

const QUEUE = '800000000000000001';
const RESULTS = '800000000000000002';
const LEA = { id: '222222222222222222', displayName: 'Léa Staff' };
const actor = (user: { id: string; displayName: string }, roles: string[] = []): Actor => ({
  guildId: TEST_GUILD,
  user,
  memberRoleIds: roles,
});
// Match 3 of leagueDatabase() is Bravo (side A, owned by Ana) v Charlie, still to play.
const BRAVO = actor(ANA);
const CHARLIE = actor({ id: '700000000000000002', displayName: 'Member 2' });
const NEW_MANAGER = { id: '700000000000000005', displayName: 'Member 5' };
const SCREENSHOT = {
  url: 'https://cdn.discordapp.com/attachments/1/2/score.png?ex=1&is=2&hm=3',
  contentType: 'image/png',
  size: 1000,
};

async function queueSite() {
  const db = leagueDatabase();
  const staff = actor(LEA, [TEST_STAFF_ROLE]);
  setTeamOwner(db, staff, { teamId: 2, member: BRAVO.user }, 100);
  setTeamOwner(db, staff, { teamId: 3, member: CHARLIE.user }, 100);
  db.update(schema.leagueGuild).set({ alertsChannelId: QUEUE, resultsChannelId: RESULTS }).run();
  const site = testSite({ db, users: { 'code-lea': LEA } });
  site.setRoles([TEST_STAFF_ROLE], LEA.id);

  const reported = await reportResult(
    db,
    site.gateway,
    site.evidence,
    BRAVO,
    { matchId: 3, scoreA: 7, scoreB: 5, screenshot: SCREENSHOT },
    () => ({ content: 'Résultat à valider', buttons: [] }),
    9000,
  );
  if (!reported.ok) throw new Error(reported.error);
  const status = () => db.select().from(schema.match).where(eq(schema.match.id, 3)).get()?.status;
  /** A request from Bravo, posted in the staff queue as the bot does. */
  const fileRequestWithPost = async (
    member = NEW_MANAGER,
    role: 'manager' | 'coach' = 'manager',
  ) => {
    const filed = fileRequest(
      db,
      BRAVO,
      {
        kind: 'team_member_add',
        member,
        role,
        teamId: null,
        note: 'Notre <b>nouveau</b> manager',
      },
      9500,
    );
    if (!filed.ok) throw new Error(filed.error);
    const post = await site.gateway.postMessage(QUEUE, { content: 'Demande', buttons: [] });
    recordQueuePost(
      db,
      { entity: 'request', entityId: filed.request.id },
      {
        channelId: QUEUE,
        messageId: post.messageId,
      },
      9500,
    );
    return filed.request.id;
  };
  return { ...site, db, evidenceId: reported.evidenceId, status, fileRequestWithPost };
}

describe('/staff', () => {
  it('asks a visitor to log in, and refuses someone who is not league staff', async () => {
    const { request, logIn } = await queueSite();
    const visitor = await request('/staff');
    expect(visitor.status).toBe(303);
    expect(visitor.headers.get('location')).toBe('/auth/login?next=/staff');
    await logIn('/staff');
    expect((await request('/staff')).status).toBe(403);
  });

  it('shows staff what waits: the dispute with the team’s words, and the requests', async () => {
    const { db, request, logIn, evidenceId, fileRequestWithPost } = await queueSite();
    answerReport(
      db,
      CHARLIE,
      {
        matchId: 3,
        evidenceId,
        action: 'dispute',
        reason: 'other',
        details: '<script>alert(1)</script>',
      },
      9100,
    );
    await fileRequestWithPost();
    await logIn('/staff', 'code-lea');
    const response = await request('/staff');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const page = await response.text();
    expect(page).toContain('Résultats à valider (0)');
    expect(page).toContain('Contestations (1)');
    expect(page).toContain('Ligue 1, semaine 3 : Bravo 7–5 Charlie');
    expect(page).toMatch(/Contesté par Member 2, .+\. Motif : Autre\./);
    // The team's words are shown as text, never run.
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page).not.toContain('<script>alert');
    // The server's copy of the screenshot is shown on the page itself.
    expect(page).toContain(`src="/evidence/${String(evidenceId)}"`);
    expect(page).toContain('action="/staff/matches/3/validate"');
    expect(page).toMatch(new RegExp(`name="evidence" value="${String(evidenceId)}"`));
    expect(page).toContain('Demandes des équipes (1)');
    expect(page).toContain('Ajouter Member 5 comme manager.');
    expect(page).toContain('Notre &lt;b&gt;nouveau&lt;/b&gt; manager');
  });

  it('validates a result: it counts, the Discord posts are marked, the result is announced', async () => {
    const { db, request, logIn, post, gateway, evidenceId, status } = await queueSite();
    await logIn('/staff', 'code-lea');
    const done = await post('/staff/matches/3/validate', { evidence: String(evidenceId) });
    expect(done.status).toBe(303);
    expect(done.headers.get('location')).toBe('/staff?done=validated');
    expect(status()).toBe('validated');
    const lea = db
      .select()
      .from(schema.player)
      .where(eq(schema.player.discordUserId, LEA.id))
      .get();
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'match.validate',
      actorPlayerId: lea?.id,
    });
    expect(gateway.posted[0]).toMatchObject({
      channelId: QUEUE,
      edits: 1,
      message: {
        content: '**Ligue 1, semaine 3 : Bravo 7–5 Charlie** — validé par <@222222222222222222>.',
      },
    });
    expect(gateway.posted.at(-1)).toMatchObject({
      channelId: RESULTS,
      message: { content: 'Résultat validé — Ligue 1, semaine 3 : Bravo 7–5 Charlie.' },
    });
    const page = await (await request('/staff?done=validated')).text();
    expect(page).toContain('Résultat validé : il compte maintenant au classement.');
    expect(page).toContain('Résultats à valider (0)');
  });

  it('refuses an older report, and a result handled meanwhile in Discord', async () => {
    const { db, logIn, post, evidenceId, status } = await queueSite();
    await logIn('/staff', 'code-lea');
    const stale = await post('/staff/matches/3/validate', { evidence: String(evidenceId + 1) });
    expect(stale.headers.get('location')).toBe('/staff?error=stale');
    expect(status()).toBe('reported');

    validateResult(db, actor(LEA, [TEST_STAFF_ROLE]), { matchId: 3, evidenceId }, 9600);
    const late = await post('/staff/matches/3/reject', { evidence: String(evidenceId) });
    expect(late.headers.get('location')).toBe('/staff?error=wrong_status');
    expect(status()).toBe('validated');
  });

  it('refuses a request with the reason, which the team reads; the post is marked', async () => {
    const { db, logIn, post, gateway, fileRequestWithPost } = await queueSite();
    const requestId = await fileRequestWithPost();
    await logIn('/staff', 'code-lea');
    const path = `/staff/requests/${String(requestId)}/reject`;
    expect((await post(path, { reason: '   ' })).headers.get('location')).toBe(
      '/staff?error=reason_required',
    );
    const done = await post(path, { reason: 'Pas de place' });
    expect(done.headers.get('location')).toBe('/staff?done=rejected_request');
    expect(
      db.select().from(schema.request).where(eq(schema.request.id, requestId)).get(),
    ).toMatchObject({ status: 'rejected', reason: 'Pas de place' });
    const marked = gateway.posted.find((entry) => entry.message.content.includes('Demande n°'));
    expect(marked?.edits).toBe(1);
    expect(marked?.message.content).toContain(
      '❌ Refusée par <@222222222222222222> : Pas de place',
    );
    expect(marked?.message.buttons).toBeUndefined();
    expect(gateway.direct.map((message) => message.userId).sort()).toEqual([
      ANA.id,
      NEW_MANAGER.id,
    ]);
  });

  it('approves a request, and leaves one answered in Discord meanwhile alone', async () => {
    const { db, logIn, post, fileRequestWithPost } = await queueSite();
    const first = await fileRequestWithPost();
    const second = await fileRequestWithPost(
      { id: '700000000000000006', displayName: 'Member 6' },
      'coach',
    );
    await logIn('/staff', 'code-lea');
    const done = await post(`/staff/requests/${String(first)}/approve`, {});
    expect(done.headers.get('location')).toBe('/staff?done=approved');
    expect(listTeamStaff(db, 2).map((member) => [member.displayName, member.role])).toContainEqual([
      'Member 5',
      'manager',
    ]);

    answerRequest(
      db,
      actor(LEA, [TEST_STAFF_ROLE]),
      { requestId: second, decision: 'reject', reason: 'Déjà traité' },
      9700,
    );
    const late = await post(`/staff/requests/${String(second)}/approve`, {});
    expect(late.headers.get('location')).toBe('/staff?error=not_pending');
    const stored = db.select().from(schema.request).where(eq(schema.request.id, second)).get();
    expect(stored?.status).toBe('rejected');
  });

  it('checks the staff role again on every decision, and the form’s token', async () => {
    const { logIn, post, request, setRoles, evidenceId, status } = await queueSite();
    await logIn('/staff', 'code-lea');
    const form = { evidence: String(evidenceId) };
    const forged = await request('/staff/matches/3/validate', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ ...form, _csrf: 'guess' }),
    });
    expect(forged.status).toBe(403);
    setRoles([], LEA.id);
    expect((await post('/staff/matches/3/validate', form)).status).toBe(403);
    expect((await request('/staff')).status).toBe(403);
    expect(status()).toBe('reported');
  });
});

describe('/evidence/:id', () => {
  it('shows staff the screenshot, never cached', async () => {
    const { request, logIn, evidenceId } = await queueSite();
    await logIn('/staff', 'code-lea');
    const response = await request(`/evidence/${String(evidenceId)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer()).slice(0, 4)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
  });

  it('shows it to nobody else: a visitor, a team, staff who lost the role', async () => {
    const { request, logIn, setRoles, evidenceId } = await queueSite();
    const path = `/evidence/${String(evidenceId)}`;
    expect((await request(path)).status).toBe(403);
    await logIn('/me');
    expect((await request(path)).status).toBe(403);
    await logIn('/staff', 'code-lea');
    expect((await request(path)).status).toBe(200);
    setRoles([], LEA.id);
    expect((await request(path)).status).toBe(403);
  });

  it('finds no evidence for an unknown or malformed ID', async () => {
    const { request, logIn, evidenceId } = await queueSite();
    await logIn('/staff', 'code-lea');
    for (const id of [String(evidenceId + 1), '0', 'abc', '1.png']) {
      expect((await request(`/evidence/${id}`)).status).toBe(404);
    }
  });
});
