CREATE TABLE `match_transcript` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`match_id` integer NOT NULL,
	`channel_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`message_count` integer NOT NULL,
	`saved_at` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `match`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_transcript_guild_match_unique` ON `match_transcript` (`guild_id`,`match_id`);