PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_veto_step` (
	`match_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`side` text,
	`action` text NOT NULL,
	`map` text,
	`start_side` text,
	`choice` text,
	`game_n` integer,
	`at` integer NOT NULL,
	`by_player_id` integer,
	`timed_out` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`match_id`, `seq`),
	FOREIGN KEY (`match_id`) REFERENCES `match`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`by_player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "veto_step_side_check" CHECK("__new_veto_step"."side" in ('a', 'b')),
	CONSTRAINT "veto_step_action_check" CHECK("__new_veto_step"."action" in ('toss_choice', 'first_ban', 'ban', 'pick', 'decider', 'toss', 'side', 'ot_side')),
	CONSTRAINT "veto_step_start_side_check" CHECK("__new_veto_step"."start_side" in ('attack', 'defense'))
);
--> statement-breakpoint
INSERT INTO `__new_veto_step`("match_id", "seq", "side", "action", "map", "start_side", "choice", "game_n", "at", "by_player_id", "timed_out") SELECT "match_id", "seq", "side", "action", "map", "start_side", NULL, "game_n", "at", "by_player_id", "timed_out" FROM `veto_step`;--> statement-breakpoint
DROP TABLE `veto_step`;--> statement-breakpoint
ALTER TABLE `__new_veto_step` RENAME TO `veto_step`;--> statement-breakpoint
PRAGMA foreign_keys=ON;