import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { player } from './people.ts';
import { competition } from './structure.ts';

// A competition's rulebook, one row per published version (design doc section 4). A version is
// never edited once published: teams accept a given version when they register, so a change is
// a new version. The one in force is the latest whose `effective_from` has passed.
export const rulesVersion = sqliteTable(
  'rules_version',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    competitionId: integer('competition_id')
      .notNull()
      .references(() => competition.id),
    /** The name staff give it, such as "Saison 4". */
    version: text('version').notNull(),
    markdown: text('markdown').notNull(),
    /** When the league voted it, if it says so. */
    votedAt: integer('voted_at'),
    effectiveFrom: integer('effective_from').notNull(),
    publishedBy: integer('published_by')
      .notNull()
      .references(() => player.id),
    publishedAt: integer('published_at').notNull(),
  },
  (t) => [
    unique('rules_version_competition_version_unique').on(t.competitionId, t.version),
    index('rules_version_competition_effective_idx').on(t.competitionId, t.effectiveFrom),
  ],
);
