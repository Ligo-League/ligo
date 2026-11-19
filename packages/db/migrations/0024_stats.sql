CREATE TABLE `stat` (
	`game_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`source` text NOT NULL,
	`entered_by` integer,
	`verified` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`game_id`, `player_id`, `metric`),
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entered_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stat_source_check" CHECK("stat"."source" in ('manual', 'replay', 'api'))
);
--> statement-breakpoint
CREATE INDEX `stat_player_idx` ON `stat` (`player_id`);--> statement-breakpoint
CREATE TABLE `stat_sheet` (
	`game_id` integer NOT NULL,
	`side` text NOT NULL,
	`entered_by` integer NOT NULL,
	`entered_at` integer NOT NULL,
	`entered_as` text NOT NULL,
	`confirmed_by` integer,
	`confirmed_at` integer,
	PRIMARY KEY(`game_id`, `side`),
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entered_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stat_sheet_side_check" CHECK("stat_sheet"."side" in ('a', 'b')),
	CONSTRAINT "stat_sheet_entered_as_check" CHECK("stat_sheet"."entered_as" in ('own', 'opponent', 'staff')),
	CONSTRAINT "stat_sheet_confirmed_check" CHECK(("stat_sheet"."confirmed_by" is null) = ("stat_sheet"."confirmed_at" is null))
);
