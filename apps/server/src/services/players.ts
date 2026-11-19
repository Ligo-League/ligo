import { slugify } from '@ligo/core';
import { schema, type Db, type Tx } from '@ligo/db';
import { eq } from 'drizzle-orm';

const { player } = schema;

/**
 * The player row of a Discord user, created on first use. One Discord account is one player
 * across every league (design doc section 12), so an existing row is returned whatever its org.
 */
export function ensurePlayer(
  db: Db | Tx,
  input: { orgId: number; discordUserId: string; displayName: string },
  now: number,
): typeof player.$inferSelect {
  const existing = db
    .select()
    .from(player)
    .where(eq(player.discordUserId, input.discordUserId))
    .get();
  if (existing) return existing;

  // Discord names are not unique and may hold no letter at all; the slug must be unique across
  // Ligo, since `/players/:slug` is one page per person (M-42).
  const slug = slugify(input.displayName);
  const base = slug.ok ? slug.slug : 'player';
  let candidate = base;
  for (let suffix = 2; slugTaken(db, candidate); suffix += 1) {
    candidate = `${base}-${suffix}`;
  }

  return db
    .insert(player)
    .values({
      orgId: input.orgId,
      slug: candidate,
      displayName: input.displayName,
      discordUserId: input.discordUserId,
      createdAt: now,
    })
    .returning()
    .get();
}

function slugTaken(db: Db | Tx, slug: string): boolean {
  const found = db.select({ id: player.id }).from(player).where(eq(player.slug, slug)).get();
  return found !== undefined;
}
