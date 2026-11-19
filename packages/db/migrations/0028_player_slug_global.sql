-- Player slugs become unique across Ligo, since /players/:slug is one page per person (M-42).
-- A slug two organisations share keeps its oldest player; the others get their ID appended.
UPDATE `player` SET `slug` = `slug` || '-' || `id` WHERE `id` NOT IN (SELECT min(`id`) FROM `player` GROUP BY `slug`);--> statement-breakpoint
DROP INDEX `player_org_slug_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `player_slug_unique` ON `player` (`slug`);
