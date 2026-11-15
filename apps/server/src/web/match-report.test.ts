import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { PNG_HEADER_FOR_TESTS } from '../assets/store.ts';
import type { Actor } from '../services/permissions.ts';
import { SCREENSHOT_MAX_BYTES } from '../services/results.ts';
import { setTeamOwner } from '../services/team-staff.ts';
import { leagueDatabase, setResultValidation, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, testSite } from './testing.ts';

// Results on the match page (phase 3e): a side reports with the scoreboard screenshot, the other
// side confirms or disputes, as with `/match report` and its buttons. A report made here goes to
// the staff queue and is posted in the schedule channel (M-32); an answer edits that post.
// Match 3 is Bravo (side A, Ana's) v Charlie (side B, Ben's).

const QUEUE = '800000000000000001';
const RESULTS = '800000000000000002';
const SCHEDULE = '800000000000000004';
const LEA = { id: '222222222222222222', displayName: 'Léa Staff' };
const BEN = { id: '700000000000000002', displayName: 'Ben' };
const STRANGER = { id: '700000000000000004', displayName: 'Stranger' };
const STAFF: Actor = { guildId: TEST_GUILD, user: LEA, memberRoleIds: [TEST_STAFF_ROLE] };
const PNG = new Uint8Array([...PNG_HEADER_FOR_TESTS, 1, 2, 3]);
const png = (data: Uint8Array<ArrayBuffer> = PNG) =>
  new File([data], 'score.png', { type: 'image/png' });

function site({ scheduleChannel = true } = {}) {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 2, member: ANA }, 100);
  setTeamOwner(db, STAFF, { teamId: 3, member: BEN }, 100);
  db.update(schema.leagueGuild)
    .set({
      alertsChannelId: QUEUE,
      resultsChannelId: RESULTS,
      scheduleChannelId: scheduleChannel ? SCHEDULE : null,
    })
    .run();
  const browser = testSite({ db, users: { 'code-ben': BEN, 'code-stranger': STRANGER } });
  const status = () => db.select().from(schema.match).where(eq(schema.match.id, 3)).get()?.status;
  const report = (file: File | null = png(), scores = { score_a: '7', score_b: '5' }) =>
    browser.postFile('/matches/3/report', scores, file ? { screenshot: file } : {});
  /** Ana reports, then Ben logs in. */
  const reported = async () => {
    await browser.logIn('/matches/3');
    await report();
    browser.jar.clear();
    await browser.logIn('/matches/3', 'code-ben');
  };
  return { ...browser, status, report, reported };
}
const where = (response: Response) => response.headers.get('location');

describe('reporting a result on the match page', () => {
  it('shows the report form to the two sides only', async () => {
    const { request, logIn, jar } = site();
    expect(await (await request('/matches/3')).text()).not.toContain('Résultat du match');
    await logIn('/matches/3', 'code-stranger');
    expect(await (await request('/matches/3')).text()).not.toContain('Résultat du match');
    jar.clear();
    await logIn('/matches/3');
    const page = await (await request('/matches/3')).text();
    expect(page).toContain('Résultat du match');
    expect(page).toContain('enctype="multipart/form-data"');
    expect(page).toContain('Manches gagnées par Bravo');
    expect(page).toContain('accept="image/png,image/jpeg,image/webp"');
  });

  it('stores the report, queues it for staff and posts it for the other side', async () => {
    const { db, request, logIn, gateway, evidence, status, report } = site();
    await logIn('/matches/3');
    expect(where(await report())).toBe('/matches/3?report=reported#result');
    expect(status()).toBe('reported');
    expect(gateway.posted).toMatchObject([
      {
        channelId: QUEUE,
        message: {
          buttons: [{ customId: 'report-validate:3:1' }, { customId: 'report-reject:3:1' }],
        },
      },
      {
        channelId: SCHEDULE,
        message: {
          files: [{ name: 'score-3.png' }],
          buttons: [{ customId: 'report-confirm:3:1' }, { customId: 'report-dispute:3:1' }],
          mentionUserIds: [BEN.id],
        },
      },
    ]);
    const row = db.select().from(schema.evidence).get();
    expect(row).toMatchObject({
      uploadedBy: 1,
      postChannelId: SCHEDULE,
      postMessageId: gateway.posted[1]?.messageId,
    });
    expect(evidence.files.get(row?.objectKey ?? '')).toEqual(PNG);

    // Ana sees her report and its screenshot, and waits: she cannot answer it.
    const page = await (await request('/matches/3')).text();
    expect(page).toContain('Bravo 7–5 Charlie');
    expect(page).toContain('En attente de la réponse de l’autre équipe.');
    expect(page).toContain('src="/evidence/1"');
    expect(page).not.toContain('/matches/3/report/1/confirm');
    expect((await request('/evidence/1')).status).toBe(200);
  });

  it('says so when the league has no schedule channel', async () => {
    const { logIn, report, status } = site({ scheduleChannel: false });
    await logIn('/matches/3');
    expect(where(await report())).toBe('/matches/3?report=reported_unposted#result');
    expect(status()).toBe('reported');
  });

  it('refuses a missing file, a file that is not an image, and a bad score', async () => {
    const { db, logIn, report, status, request } = site();
    await logIn('/matches/3');
    expect(where(await report(null))).toBe('/matches/3?report_error=screenshot_required#result');
    const html = new File(['<!doctype html>'], 'score.png', { type: 'image/png' });
    expect(where(await report(html))).toBe('/matches/3?report_error=invalid_screenshot#result');
    expect(where(await report(png(), { score_a: '7', score_b: 'x' }))).toBe(
      '/matches/3?report_error=invalid_score#result',
    );
    expect(status()).toBe('scheduled');
    expect(db.select().from(schema.evidence).all()).toEqual([]);
    const page = await (await request('/matches/3?report_error=invalid_screenshot')).text();
    expect(page).toContain('class="card flash error"');
  });

  it('refuses a file over the limit before reading it', async () => {
    const { logIn, report, status } = site();
    await logIn('/matches/3');
    const large = new Uint8Array(SCREENSHOT_MAX_BYTES + 128 * 1024);
    large.set(PNG);
    expect((await report(png(large))).status).toBe(413);
    expect(status()).toBe('scheduled');
  });

  it('is for the match’s sides, with the session’s token', async () => {
    const { logIn, postFile, report, status, jar } = site();
    await logIn('/matches/3', 'code-stranger');
    expect(where(await report())).toBe('/matches/3?report_error=no_team#result');
    jar.clear();
    await logIn('/matches/3');
    const forged = await postFile(
      '/matches/3/report',
      { _csrf: 'forged', score_a: '7', score_b: '5' },
      {
        screenshot: png(),
      },
    );
    expect(forged.status).toBe(403);
    expect(status()).toBe('scheduled');
  });
});

describe('answering a report on the match page', () => {
  it('lets the other side confirm: the report’s post loses its buttons, the result is announced', async () => {
    const { request, post, gateway, status, reported } = site();
    await reported();
    const page = await (await request('/matches/3')).text();
    expect(page).toContain('action="/matches/3/report/1/confirm"');
    expect(page).toContain('<option value="wrong_score">');
    expect(where(await post('/matches/3/report/1/confirm', {}))).toBe(
      '/matches/3?report=validated#result',
    );
    expect(status()).toBe('validated');
    const publicPost = gateway.posted.find((entry) => entry.channelId === SCHEDULE);
    expect(publicPost?.edits).toBe(1);
    expect(publicPost?.message.content).toContain('confirmé par <@700000000000000002>');
    expect(publicPost?.message.buttons).toBeUndefined();
    expect(gateway.posted.some((entry) => entry.channelId === RESULTS)).toBe(true);
  });

  it('where staff validate, a confirmation waits for them', async () => {
    const { db, post, status, reported } = site();
    setResultValidation(db, 'staff');
    await reported();
    expect(where(await post('/matches/3/report/1/confirm', {}))).toBe(
      '/matches/3?report=confirmed#result',
    );
    expect(status()).toBe('confirmed');
  });

  it('lets the other side dispute with a reason; "Autre" needs details', async () => {
    const { db, post, gateway, status, reported } = site();
    await reported();
    expect(where(await post('/matches/3/report/1/dispute', { reason: 'other', details: '' }))).toBe(
      '/matches/3?report_error=details_required#result',
    );
    expect(status()).toBe('reported');
    expect(
      where(
        await post('/matches/3/report/1/dispute', {
          reason: 'wrong_score',
          details: 'Le score était 7–6',
        }),
      ),
    ).toBe('/matches/3?report=disputed#result');
    expect(status()).toBe('disputed');
    expect(db.select().from(schema.dispute).get()).toMatchObject({
      reason: 'wrong_score',
      details: 'Le score était 7–6',
    });
    // Staff get the team's words in the queue; the public post names no reason.
    expect(gateway.posted.at(-1)).toMatchObject({ channelId: QUEUE });
    const publicPost = gateway.posted.find((entry) => entry.channelId === SCHEDULE);
    expect(publicPost?.message.content).not.toContain('7–6');
  });

  it('refuses an answer from the side that reported, and an older report', async () => {
    const { post, logIn, jar, status, reported } = site();
    await reported();
    jar.clear();
    await logIn('/matches/3');
    expect(where(await post('/matches/3/report/1/confirm', {}))).toBe(
      '/matches/3?report_error=not_opponent#result',
    );
    expect(where(await post('/matches/3/report/2/confirm', {}))).toBe(
      '/matches/3?report_error=stale#result',
    );
    expect(status()).toBe('reported');
  });
});
