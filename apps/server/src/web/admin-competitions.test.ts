import { schema } from '@ligo/db';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, testSite } from './testing.ts';

// Competitions in the admin panel (phase 3h; M-20): MLB Group's owner creates one; the owner and
// LFR's staff (Ana, with the staff role) change LFR's general settings.

const OWNER = { id: '994597181476569170', displayName: 'Owner' };
const where = (response: Response) => response.headers.get('location');

function site() {
  const browser = testSite({ users: { 'code-owner': OWNER } });
  const lfr = () =>
    browser.db.select().from(schema.competition).where(eq(schema.competition.slug, 'lfr')).get();
  return { ...browser, lfr };
}

/** The general form as the page shows it, read back from the page's own inputs. */
async function formOf(page: string): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};
  for (const match of page.matchAll(/<input\s+name="([^"]+)"\s+value="([^"]*)"/g)) {
    fields[match[1] ?? ''] = match[2] ?? '';
  }
  for (const match of page.matchAll(/<select name="([^"]+)">([\s\S]*?)<\/select>/g)) {
    fields[match[1] ?? ''] = /<option value="([^"]*)"\s+selected/.exec(match[2] ?? '')?.[1] ?? '';
  }
  return Promise.resolve(fields);
}

describe('creating a competition', () => {
  it('is for the organisation’s owner, and leads to the new competition’s page', async () => {
    const { request, logIn, post, jar, db } = site();
    await logIn('/admin/mlb-group/new');
    expect((await request('/admin/mlb-group/new')).status).toBe(403);
    jar.clear();
    await logIn('/admin/mlb-group/new', 'code-owner');
    expect(await (await request('/admin/mlb-group')).text()).toContain(
      'href="/admin/mlb-group/new"',
    );
    const create = (fields: Record<string, string>) =>
      post('/admin/mlb-group/new', {
        title: 'valorant',
        name: 'LFV',
        slug: 'lfv',
        participant_mode: 'team',
        ...fields,
      });
    const taken = await create({ slug: 'lfr' });
    expect(taken.status).toBe(400);
    expect(await taken.text()).toContain('Cette adresse est déjà prise.');
    expect(where(await create({}))).toBe('/admin/mlb-group/lfv?done=created');
    expect(
      db
        .select()
        .from(schema.competition)
        .where(and(eq(schema.competition.slug, 'lfv'), eq(schema.competition.title, 'valorant')))
        .get(),
    ).toBeDefined();
    const page = await (await request('/admin/mlb-group/lfv?done=created')).text();
    expect(page).toContain('Reliez maintenant son serveur Discord');
    expect(page).toContain('href="/mlb-group/lfv/discord"');
  });
});

describe('a competition’s general settings', () => {
  it('open to the competition’s staff, and save what they change', async () => {
    const { request, logIn, post, setRoles, lfr } = site();
    await logIn('/admin/mlb-group/lfr');
    expect((await request('/admin/mlb-group/lfr')).status).toBe(403);
    setRoles([TEST_STAFF_ROLE]);
    const response = await request('/admin/mlb-group/lfr');
    expect(response.status).toBe(200);
    const fields = await formOf(await response.text());
    expect(fields).toMatchObject({
      name: 'LFR',
      'ruleset.result_validation': 'opponent',
      'scheduling.time_zone': 'Europe/Paris',
      'scheduling.auto_slot.weekday': '7',
    });
    expect(
      where(
        await post('/admin/mlb-group/lfr', {
          ...fields,
          'ruleset.requests.answer_within_hours': '48',
          'scheduling.auto_slot.weekday': '',
        }),
      ),
    ).toBe('/admin/mlb-group/lfr?done=saved');
    expect(lfr()).toMatchObject({
      rulesetJson: { requests: { answer_within_hours: 48 } },
      schedulingJson: { auto_slot: null },
    });
    // The admin home leads staff here.
    expect(await (await request('/admin')).text()).toContain('href="/admin/mlb-group/lfr"');
  });

  it('keeps what was typed and names each problem when nothing can be saved', async () => {
    const { request, logIn, post, setRoles, lfr } = site();
    setRoles([TEST_STAFF_ROLE], ANA.id);
    await logIn('/admin/mlb-group/lfr');
    const fields = await formOf(await (await request('/admin/mlb-group/lfr')).text());
    const before = lfr();
    const response = await post('/admin/mlb-group/lfr', {
      ...fields,
      'scheduling.time_zone': 'Mars/Olympus',
      'scheduling.rounds_per_week': '1.5',
    });
    expect(response.status).toBe(400);
    const page = await response.text();
    expect(page).toContain('Rien n’est enregistré');
    expect(page).toContain('value="Mars/Olympus"');
    expect(page).toContain('Un nombre entier.');
    expect(lfr()).toEqual(before);
  });
});

describe('a competition’s rules page', () => {
  /** Every input of the page with its value, ticked boxes only, as a browser sends them. */
  const inputsOf = (page: string): Record<string, string> => {
    const fields: Record<string, string> = {};
    for (const match of page.matchAll(/<input\s+name="([^"]+)"\s+value="([^"]*)"/g)) {
      fields[match[1] ?? ''] = match[2] ?? '';
    }
    for (const match of page.matchAll(
      /<input\s+type="checkbox"\s+name="([^"]+)"\s+value="1"\s+checked/g,
    )) {
      fields[match[1] ?? ''] = '1';
    }
    for (const match of page.matchAll(/<select name="([^"]+)">([\s\S]*?)<\/select>/g)) {
      fields[match[1] ?? ''] = /<option value="([^"]*)"\s+selected/.exec(match[2] ?? '')?.[1] ?? '';
    }
    return fields;
  };

  it('shows the rules and saves a change, keeping everything else', async () => {
    const { request, logIn, post, setRoles, lfr } = site();
    setRoles([TEST_STAFF_ROLE], ANA.id);
    await logIn('/admin/mlb-group/lfr/rules');
    expect(await (await request('/admin/mlb-group/lfr')).text()).toContain(
      'href="/admin/mlb-group/lfr/rules"',
    );
    const page = await (await request('/admin/mlb-group/lfr/rules')).text();
    const fields = inputsOf(page);
    expect(fields).toMatchObject({
      'points.outcomes.win': '3',
      'points.forfeit.counts_as_played': '1',
      'tiebreak.criteria.0': 'points',
      'ruleset.mercato.mode': 'windows',
      'ruleset.dispute_reasons.0.key': 'wrong_score',
    });
    const before = lfr();
    expect(
      where(
        await post('/admin/mlb-group/lfr/rules', {
          ...fields,
          'ruleset.mercato.lock_hours': '48',
        }),
      ),
    ).toBe('/admin/mlb-group/lfr/rules?done=saved');
    const after = lfr();
    expect(after?.rulesetJson.mercato.lock_hours).toBe(48);
    expect({ ...after?.rulesetJson, mercato: null }).toEqual({
      ...before?.rulesetJson,
      mercato: null,
    });
    expect(after?.pointsJson).toEqual(before?.pointsJson);
  });

  it('says what a veto sequence must hold, and saves nothing', async () => {
    const { request, logIn, post, setRoles, lfr } = site();
    setRoles([TEST_STAFF_ROLE], ANA.id);
    await logIn('/admin/mlb-group/lfr/rules');
    const fields = inputsOf(await (await request('/admin/mlb-group/lfr/rules')).text());
    const before = lfr();
    const response = await post('/admin/mlb-group/lfr/rules', {
      ...fields,
      'ruleset.veto.formats.bo3.sequence': 'A_ban B_ban A_pick',
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('En BO N, une séquence choisit N − 1 cartes');
    expect(lfr()).toEqual(before);
  });
});
