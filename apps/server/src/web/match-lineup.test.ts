import { schema, type Db } from '@ligo/db';
import { addRosterPlayers } from '@ligo/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../services/permissions.ts';
import { setTeamOwner } from '../services/team-staff.ts';
import { leagueDatabase, requireMoss, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, testSite } from './testing.ts';

// The players of a match (M-47, maintainer 24 November 2026): where MOSS files come from the
// lineup (the default), the team's officials say who plays, its starters by default, until the
// result is reported. Match 3 is Bravo (Ana's) v Charlie, still to play.

const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};

const fromLineup = (db: Db) => {
  for (const row of db.select().from(schema.competition).all()) {
    db.update(schema.competition)
      .set({
        rulesetJson: {
          ...row.rulesetJson,
          moss: { ...row.rulesetJson.moss, players_from: 'lineup' },
        },
      })
      .where(eq(schema.competition.id, row.id))
      .run();
  }
};

async function setup() {
  const db = leagueDatabase();
  requireMoss(db);
  fromLineup(db);
  setTeamOwner(db, STAFF, { teamId: 2, member: ANA }, 100);
  const season = db.select().from(schema.season).where(eq(schema.season.name, 'Saison 3')).get();
  addRosterPlayers(db, season?.id ?? 0, 2, 'b');
  const site = testSite({ db });
  await site.logIn('/matches/3');
  const ids = db
    .select({ id: schema.player.id, slug: schema.player.slug })
    .from(schema.player)
    .all()
    .filter((p) => /^b\d$/.test(p.slug));
  return { ...site, ids };
}

describe('the players of a match', () => {
  it('shows a team’s officials its starters, ticked, and saves another five', async () => {
    const { request, post, ids, db } = await setup();
    const page = await (await request('/matches/3')).text();
    expect(page).toContain('Joueurs de ce match');
    expect(page).toContain(`name="player_${String(ids[0]?.id)}"`);
    expect(page).toContain('checked');
    const fields = Object.fromEntries(ids.map((p) => [`player_${String(p.id)}`, 'on']));
    const saved = await post('/matches/3/lineup/a', fields);
    expect(saved.headers.get('location')).toBe('/matches/3?lineup=done#lineup');
    expect(db.select().from(schema.lineupMember).all()).toHaveLength(5);
    const few = await post('/matches/3/lineup/a', { [`player_${String(ids[0]?.id)}`]: 'on' });
    expect(few.headers.get('location')).toBe('/matches/3?lineup_error=too_few#lineup');
  });

  it('does not let a team name the other team’s players', async () => {
    const { post } = await setup();
    expect((await post('/matches/3/lineup/b', {})).status).toBe(403);
  });
});
