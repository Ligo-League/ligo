CREATE TABLE `veto_step` (
	`match_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`side` text,
	`action` text NOT NULL,
	`map` text,
	`start_side` text,
	`game_n` integer,
	`at` integer NOT NULL,
	`by_player_id` integer,
	`timed_out` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`match_id`, `seq`),
	FOREIGN KEY (`match_id`) REFERENCES `match`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`by_player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "veto_step_side_check" CHECK("veto_step"."side" in ('a', 'b')),
	CONSTRAINT "veto_step_action_check" CHECK("veto_step"."action" in ('ban', 'pick', 'decider', 'side', 'ot_side')),
	CONSTRAINT "veto_step_start_side_check" CHECK("veto_step"."start_side" in ('attack', 'defense'))
);
--> statement-breakpoint
ALTER TABLE `match` ADD `veto_json` text;--> statement-breakpoint
ALTER TABLE `match` ADD `veto_started_at` integer;--> statement-breakpoint
ALTER TABLE `match` ADD `veto_channel_id` text;--> statement-breakpoint
ALTER TABLE `match` ADD `veto_message_id` text;