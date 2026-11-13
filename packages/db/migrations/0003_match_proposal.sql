CREATE TABLE `match_proposal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`side` text NOT NULL,
	`proposed_by` integer NOT NULL,
	`at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`answered_by` integer,
	`answered_at` integer,
	FOREIGN KEY (`match_id`) REFERENCES `match`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposed_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`answered_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "match_proposal_side_check" CHECK("match_proposal"."side" in ('a', 'b')),
	CONSTRAINT "match_proposal_status_check" CHECK("match_proposal"."status" in ('pending', 'accepted', 'declined', 'superseded', 'withdrawn'))
);
--> statement-breakpoint
CREATE INDEX `match_proposal_match_idx` ON `match_proposal` (`match_id`);--> statement-breakpoint
ALTER TABLE `league_guild` ADD `schedule_channel_id` text;