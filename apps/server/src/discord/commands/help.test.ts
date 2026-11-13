import { describe, expect, it } from 'vitest';
import type { Locale } from '../../i18n/index.ts';
import type { HelpFacts } from '../../services/help.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../../testing.ts';
import { fakeContext, fakeInteraction, type FakeInput } from '../testing.ts';
import { HELP_TOPICS, helpCommand, helpOverview, helpPage, type HelpTopic } from './help.ts';
import { commands } from './index.ts';

const MEMBER: FakeInput = {
  guildId: TEST_GUILD,
  user: { id: '700000000000000001', displayName: 'Member' },
  memberRoleIds: [],
};
const STAFF: FakeInput = { ...MEMBER, memberRoleIds: [TEST_STAFF_ROLE] };

async function ask(who: FakeInput, command?: HelpTopic, locale: Locale = 'fr') {
  const interaction = fakeInteraction('help', {
    ...who,
    options: command ? { command } : {},
  });
  await helpCommand.execute(interaction, fakeContext({ db: leagueDatabase(), locale }));
  expect(interaction.replies).toHaveLength(1);
  expect(interaction.replies[0]?.ephemeral).toBe(true);
  return interaction.replies[0]?.content ?? '';
}

// Every variant a page can take, to check them all against Discord's limits.
const FACTS: HelpFacts[] = [
  { staff: false, rules: null },
  {
    staff: true,
    rules: {
      validation: 'staff',
      teamRoles: { managers_max: 3, coaches_max: 1 },
      forfeits: { warning_at: 2, exclusion_at: 3 },
      extensionWeeks: 1,
      autoSlot: { weekday: 7, time: '21:00' },
    },
  },
  {
    staff: true,
    rules: {
      validation: 'opponent',
      teamRoles: { managers_max: 10, coaches_max: 1 },
      forfeits: { warning_at: null, exclusion_at: null },
      extensionWeeks: 2,
      autoSlot: null,
    },
  },
  {
    staff: true,
    rules: {
      validation: 'staff',
      teamRoles: { managers_max: 0, coaches_max: 1 },
      forfeits: null,
      extensionWeeks: 1,
      autoSlot: { weekday: 7, time: '21:00' },
    },
  },
];
const LOCALES: Locale[] = ['fr', 'en'];

describe('/help', () => {
  it('lists the team commands for a member, without the staff ones', async () => {
    const content = await ask(MEMBER);
    expect(content).toContain('/standings');
    expect(content).toContain('/match report');
    expect(content).toContain('/help');
    expect(content).not.toContain('/staff');
    expect(content).not.toContain('/league');
  });

  it('adds the staff commands and the first setup steps for staff', async () => {
    const content = await ask(STAFF);
    expect(content).toContain('/standings');
    for (const command of ['/staff match', '/staff sanction', '/team', '/league channel']) {
      expect(content).toContain(command);
    }
  });

  it('explains one command in detail, in the member’s language', async () => {
    expect(await ask(MEMBER, 'match')).toContain('Confirmer');
    expect(await ask(MEMBER, 'match', 'en')).toContain('Confirm');
  });

  it('explains a staff command to anyone who asks: it reveals nothing, and says who may use it', async () => {
    expect(await ask(MEMBER, 'staff-match')).toContain('staff de la ligue');
  });

  it('follows how the league validates results', () => {
    const facts = (validation: 'staff' | 'opponent'): HelpFacts => ({
      staff: false,
      rules: {
        validation,
        teamRoles: { managers_max: 3, coaches_max: 1 },
        forfeits: null,
        extensionWeeks: 1,
        autoSlot: { weekday: 7, time: '21:00' },
      },
    });
    expect(helpPage('fr', 'match', facts('staff'))).toContain('Valider');
    expect(helpPage('fr', 'match', facts('opponent'))).not.toContain('Valider');
  });

  it("states the league's deadline rule on the time page", () => {
    const page = (autoSlot: { weekday: number; time: string } | null) =>
      helpPage('fr', 'match-time', {
        staff: false,
        rules: {
          validation: 'staff',
          teamRoles: { managers_max: 3, coaches_max: 1 },
          forfeits: null,
          extensionWeeks: 1,
          autoSlot,
        },
      });
    expect(page({ weekday: 7, time: '21:00' })).toContain(
      'fixe aussitôt le match au dernier dimanche de la prolongation, à 21:00',
    );
    expect(page(null)).toContain("le staff de la ligue fixe l'horaire");
  });

  it('names the forfeit thresholds of the season, and leaves out those that are not set', () => {
    const page = (rules: HelpFacts['rules']) =>
      helpPage('fr', 'staff-match', { staff: true, rules });
    const both = page({
      validation: 'staff',
      teamRoles: { managers_max: 3, coaches_max: 1 },
      forfeits: { warning_at: 2, exclusion_at: 3 },
      extensionWeeks: 1,
      autoSlot: null,
    });
    expect(both).toContain('À 2 forfaits');
    expect(both).toContain('À 3 forfaits');
    const none = page({
      validation: 'staff',
      teamRoles: { managers_max: 3, coaches_max: 1 },
      forfeits: { warning_at: null, exclusion_at: null },
      extensionWeeks: 1,
      autoSlot: null,
    });
    expect(none).not.toMatch(/À \d+ forfaits/);
  });

  it('fits every page in one Discord message, in both languages', () => {
    for (const locale of LOCALES) {
      for (const facts of FACTS) {
        expect(helpOverview(locale, facts).length).toBeLessThanOrEqual(2000);
        for (const topic of HELP_TOPICS) {
          expect(helpPage(locale, topic, facts).length, `${locale} ${topic}`).toBeLessThanOrEqual(
            2000,
          );
        }
      }
    }
  });

  it('is offered for every command, and names each subcommand and option of it', () => {
    interface Node {
      name: string;
      options?: readonly Node[];
    }
    const names = (node: Node): string[] =>
      (node.options ?? []).flatMap((child) => [child.name, ...names(child)]);
    const pages: Record<string, HelpTopic[]> = {
      standings: ['standings'],
      match: ['match', 'match-time', 'match-veto'],
      staff: ['staff-match', 'staff-sanction', 'staff-exclusion'],
      team: ['team'],
      league: ['league'],
    };
    const facts = FACTS[1] as HelpFacts;
    for (const command of commands) {
      if (command.data.name === 'ping' || command.data.name === 'help') continue;
      const topics = pages[command.data.name];
      expect(topics, command.data.name).toBeDefined();
      for (const locale of LOCALES) {
        const text = (topics ?? []).map((topic) => helpPage(locale, topic, facts)).join('\n');
        for (const name of names(command.data)) {
          // Inside any code span: `/team staff add` names both `staff` and `add`.
          const named = new RegExp(`\`[^\`]*\\b${name}\\b[^\`]*\``);
          expect(text, `${locale} /${command.data.name}: ${name}`).toMatch(named);
        }
      }
    }
  });

  it('is registered, visible to everyone, in servers only', () => {
    expect(commands).toContain(helpCommand);
    expect(helpCommand.data.default_member_permissions).toBeUndefined();
    expect(helpCommand.data.contexts).toEqual([0]);
  });
});
