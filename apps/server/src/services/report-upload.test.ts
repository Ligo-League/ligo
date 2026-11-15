import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { fakeEvidenceStore } from '../assets/evidence-store.ts';
import { fakeGateway } from '../discord/testing.ts';
import { PNG_HEADER_FOR_TESTS } from '../assets/store.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { openEvidence } from './evidence.ts';
import type { Actor } from './permissions.ts';
import { answerReport, recordReportPost, reportResult, type ReportDetails } from './reports.ts';
import { SCREENSHOT_MAX_BYTES } from './results.ts';
import { addTeamMember, setTeamOwner } from './team-staff.ts';

// A result reported on the website (phase 3e): the screenshot comes as the file's own bytes, with
// the same checks as one attached in Discord, and the server keeps it before anything is stored.
// The report's public post, with the other team's buttons, is kept so its answer can edit it;
// both teams of the match see the screenshot, as staff do.

const QUEUE = '800000000000000001';
const SCHEDULE = '800000000000000003';
const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const member = (n: number): Actor => ({
  guildId: TEST_GUILD,
  user: { id: `70000000000000000${String(n)}`, displayName: `Member ${String(n)}` },
  memberRoleIds: [],
});
// In leagueDatabase(): match 3 is Bravo (team 2, side A) v Charlie (team 3, side B), to play.
const BRAVO_MANAGER = member(1);
const CHARLIE_MANAGER = member(2);
const XRAY_MANAGER = member(5);
const PNG = new Uint8Array([...PNG_HEADER_FOR_TESTS, 1, 2, 3]);
const queueMessage = (report: ReportDetails) => ({ content: `queue ${String(report.match.id)}` });

function league() {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 2, member: BRAVO_MANAGER.user }, 100);
  setTeamOwner(db, STAFF, { teamId: 3, member: CHARLIE_MANAGER.user }, 100);
  addTeamMember(db, STAFF, { teamId: 4, member: XRAY_MANAGER.user, role: 'manager' }, 100);
  db.update(schema.leagueGuild).set({ alertsChannelId: QUEUE, scheduleChannelId: SCHEDULE }).run();
  const gateway = fakeGateway();
  const store = fakeEvidenceStore();
  const upload = (data: Uint8Array, actor: Actor = BRAVO_MANAGER) =>
    reportResult(
      db,
      gateway,
      store,
      actor,
      { matchId: 3, scoreA: 7, scoreB: 5, screenshot: { data } },
      queueMessage,
      9000,
    );
  const dump = () => db.$client.serialize().toString('base64');
  return { db, gateway, store, upload, dump };
}

describe('reportResult with an uploaded screenshot', () => {
  it('keeps the file first, then posts it in the staff queue, as from Discord', async () => {
    const { db, gateway, store, upload } = league();
    const reply = await upload(PNG);
    expect(reply).toMatchObject({
      ok: true,
      kept: true,
      queued: true,
      scheduleChannelId: SCHEDULE,
    });
    // Nothing to download: the bytes came with the form.
    expect(gateway.downloads).toEqual([]);
    const row = db.select().from(schema.evidence).get();
    expect(row?.objectKey).toMatch(/^evidence\/3\/[0-9a-f]{64}\.png$/);
    expect(store.files.get(row?.objectKey ?? '')).toEqual(PNG);
    expect(row?.url).toBe(
      `https://discord.com/channels/1/${QUEUE}/${gateway.posted[0]?.messageId}`,
    );
    expect(gateway.posted[0]?.message.files).toMatchObject([{ name: 'score-3.png' }]);
  });

  it('refuses a file that is not an image, empty or too large, and stores nothing', async () => {
    const { db, store, upload, dump } = league();
    const before = dump();
    const html = new Uint8Array(Buffer.from('<!doctype html><script></script>'));
    const large = new Uint8Array(SCREENSHOT_MAX_BYTES + 1);
    large.set(PNG);
    for (const data of [html, new Uint8Array(0), large]) {
      expect(await upload(data)).toEqual({ ok: false, error: 'invalid_screenshot' });
    }
    expect(dump()).toBe(before);
    expect(store.files.size).toBe(0);
    expect(db.select().from(schema.evidence).all()).toEqual([]);
  });

  it('stores nothing when the server cannot keep the file: it is the only copy', async () => {
    const { db, store, upload, dump } = league();
    const before = dump();
    store.failing = true;
    expect(await upload(PNG)).toEqual({ ok: false, error: 'screenshot_unstored' });
    expect(dump()).toBe(before);
    expect(db.select().from(schema.evidence).all()).toEqual([]);
  });

  it('keeps the checks of any report: only the match’s own teams', async () => {
    const { upload } = league();
    expect(await upload(PNG, XRAY_MANAGER)).toEqual({ ok: false, error: 'not_your_match' });
  });
});

describe('the report’s public post', () => {
  it('is given back with the answer, so the answer can edit it wherever it was given', async () => {
    const { db, upload } = league();
    const reply = await upload(PNG);
    if (!reply.ok) throw new Error(reply.error);
    const post = { channelId: SCHEDULE, messageId: '900000000000000001' };
    recordReportPost(db, reply.evidenceId, post);
    expect(
      answerReport(
        db,
        CHARLIE_MANAGER,
        { matchId: 3, evidenceId: reply.evidenceId, action: 'confirm' },
        9100,
      ),
    ).toMatchObject({ ok: true, status: 'validated', post });
  });

  it('is none when it was never posted', async () => {
    const { db, upload } = league();
    const reply = await upload(PNG);
    if (!reply.ok) throw new Error(reply.error);
    expect(
      answerReport(
        db,
        CHARLIE_MANAGER,
        { matchId: 3, evidenceId: reply.evidenceId, action: 'confirm' },
        9100,
      ),
    ).toMatchObject({ ok: true, post: null });
  });
});

describe('openEvidence for the match’s teams', () => {
  it('shows the screenshot to both teams and staff, to nobody else', async () => {
    const { db, store, upload } = league();
    const reply = await upload(PNG);
    if (!reply.ok) throw new Error(reply.error);
    const shown = { ok: true, type: 'image/png', data: PNG };
    expect(await openEvidence(db, store, BRAVO_MANAGER, reply.evidenceId)).toEqual(shown);
    expect(await openEvidence(db, store, CHARLIE_MANAGER, reply.evidenceId)).toEqual(shown);
    expect(await openEvidence(db, store, STAFF, reply.evidenceId)).toEqual(shown);
    expect(await openEvidence(db, store, XRAY_MANAGER, reply.evidenceId)).toEqual({
      ok: false,
      error: 'not_staff',
    });
  });

  it('keeps evidence marked for staff to staff alone', async () => {
    const { db, store, upload } = league();
    const reply = await upload(PNG);
    if (!reply.ok) throw new Error(reply.error);
    db.update(schema.evidence).set({ visibility: 'staff' }).run();
    expect(await openEvidence(db, store, BRAVO_MANAGER, reply.evidenceId)).toEqual({
      ok: false,
      error: 'not_staff',
    });
    expect((await openEvidence(db, store, STAFF, reply.evidenceId)).ok).toBe(true);
  });
});
