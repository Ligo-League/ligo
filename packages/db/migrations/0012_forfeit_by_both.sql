PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_game` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`n` integer NOT NULL,
	`map` text,
	`bans_json` text NOT NULL,
	`score_a` integer DEFAULT 0 NOT NULL,
	`score_b` integer DEFAULT 0 NOT NULL,
	`overtime` integer DEFAULT false NOT NULL,
	`forfeit_side` text,
	`rehosts_a` integer DEFAULT 0 NOT NULL,
	`rehosts_b` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`stats_source` text DEFAULT 'none' NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `match`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "game_forfeit_side_check" CHECK("__new_game"."forfeit_side" in ('a', 'b', 'both')),
	CONSTRAINT "game_status_check" CHECK("__new_game"."status" in ('pending', 'final', 'void')),
	CONSTRAINT "game_stats_source_check" CHECK("__new_game"."stats_source" in ('none', 'manual', 'replay', 'api'))
);
--> statement-breakpoint
INSERT INTO `__new_game`("id", "match_id", "n", "map", "bans_json", "score_a", "score_b", "overtime", "forfeit_side", "rehosts_a", "rehosts_b", "status", "stats_source") SELECT "id", "match_id", "n", "map", "bans_json", "score_a", "score_b", "overtime", "forfeit_side", "rehosts_a", "rehosts_b", "status", "stats_source" FROM `game`;--> statement-breakpoint
DROP TABLE `game`;--> statement-breakpoint
ALTER TABLE `__new_game` RENAME TO `game`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `game_match_n_unique` ON `game` (`match_id`,`n`);