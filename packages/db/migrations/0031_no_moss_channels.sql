-- MOSS files go on the website, not in Discord (maintainer, 20 November 2026; M-47). A MOSS
-- channel or category Ligo made is forgotten, never deleted: it stays in the server as it is.
-- The leagues' Discord settings lose their MOSS keys.
UPDATE `competition` SET `ruleset_json` = json_remove(`ruleset_json`, '$.discord.moss', '$.discord.moss_channel_template', '$.discord.moss_category_template') WHERE json_type(`ruleset_json`, '$.discord') IS NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_discord_object` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`discord_id` text NOT NULL,
	`created_by_ligo` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "discord_object_kind_check" CHECK("__new_discord_object"."kind" in ('team_role', 'week_category', 'archive_category', 'match_channel'))
);
--> statement-breakpoint
INSERT INTO `__new_discord_object`("id", "guild_id", "kind", "key", "discord_id", "created_by_ligo", "created_at") SELECT "id", "guild_id", "kind", "key", "discord_id", "created_by_ligo", "created_at" FROM `discord_object` WHERE "kind" NOT IN ('moss_category', 'moss_channel');--> statement-breakpoint
DROP TABLE `discord_object`;--> statement-breakpoint
ALTER TABLE `__new_discord_object` RENAME TO `discord_object`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `discord_object_guild_kind_key_unique` ON `discord_object` (`guild_id`,`kind`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `discord_object_guild_discord_id_unique` ON `discord_object` (`guild_id`,`discord_id`);