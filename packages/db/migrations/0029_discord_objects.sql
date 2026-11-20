CREATE TABLE `discord_object` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`discord_id` text NOT NULL,
	`created_by_ligo` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "discord_object_kind_check" CHECK("discord_object"."kind" in ('team_role', 'week_category', 'archive_category', 'moss_category', 'match_channel', 'moss_channel'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discord_object_guild_kind_key_unique` ON `discord_object` (`guild_id`,`kind`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `discord_object_guild_discord_id_unique` ON `discord_object` (`guild_id`,`discord_id`);--> statement-breakpoint
ALTER TABLE `division` ADD `staff_role_id` text;