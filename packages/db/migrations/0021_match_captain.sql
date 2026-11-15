CREATE TABLE `match_captain` (
	`match_id` integer NOT NULL,
	`side` text NOT NULL,
	`player_id` integer NOT NULL,
	`named_by` integer NOT NULL,
	`named_at` integer NOT NULL,
	PRIMARY KEY(`match_id`, `side`),
	FOREIGN KEY (`match_id`) REFERENCES `match`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`named_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "match_captain_side_check" CHECK("match_captain"."side" in ('a', 'b'))
);
--> statement-breakpoint
CREATE INDEX `match_captain_player_idx` ON `match_captain` (`player_id`);