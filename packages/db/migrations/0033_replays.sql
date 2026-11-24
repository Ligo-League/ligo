CREATE TABLE `job` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` integer NOT NULL,
	`locked_until` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	CONSTRAINT "job_kind_check" CHECK("job"."kind" in ('verify_replay', 'stitch_game', 'render_images', 'reparse_game')),
	CONSTRAINT "job_status_check" CHECK("job"."status" in ('queued', 'running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `job_queue_idx` ON `job` (`status`,`run_after`);--> statement-breakpoint
CREATE TABLE `game_round` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`n` integer,
	`kind` text NOT NULL,
	`segment_id` integer,
	`local_n` integer,
	`winner_side` text,
	`reason` text,
	`decided_by` integer,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`segment_id`) REFERENCES `replay_segment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "game_round_kind_check" CHECK("game_round"."kind" in ('replay', 'awarded', 'void')),
	CONSTRAINT "game_round_winner_check" CHECK("game_round"."winner_side" in ('a', 'b')),
	CONSTRAINT "game_round_shape_check" CHECK(case "game_round"."kind"
        when 'replay' then "game_round"."segment_id" is not null and "game_round"."local_n" is not null and "game_round"."n" is not null
        when 'awarded' then "game_round"."segment_id" is null and "game_round"."winner_side" is not null and "game_round"."n" is not null
        else "game_round"."n" is null end)
);
--> statement-breakpoint
CREATE INDEX `game_round_game_idx` ON `game_round` (`game_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `game_round_game_n_unique` ON `game_round` (`game_id`,`n`);--> statement-breakpoint
CREATE TABLE `kill_event` (
	`segment_id` integer NOT NULL,
	`local_n` integer NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`elapsed_s` real,
	`actor_idx` integer,
	`target_idx` integer,
	`headshot` integer DEFAULT false NOT NULL,
	`team_kill` integer DEFAULT false NOT NULL,
	`trade` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`segment_id`, `local_n`, `seq`),
	FOREIGN KEY (`segment_id`) REFERENCES `replay_segment`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kill_event_kind_check" CHECK("kill_event"."kind" in ('kill', 'death', 'leave'))
);
--> statement-breakpoint
CREATE TABLE `replay_file` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`uploader_player_id` integer NOT NULL,
	`title` text NOT NULL,
	`file_name` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`lobby_id` text NOT NULL,
	`unit_number` integer NOT NULL,
	`recorded_side` text,
	`parser_version` text NOT NULL,
	`parsed_json` text NOT NULL,
	`raw_status` text DEFAULT 'none' NOT NULL,
	`raw_key` text,
	`verified` text DEFAULT 'unverified' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `match`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploader_player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "replay_file_recorded_side_check" CHECK("replay_file"."recorded_side" in ('a', 'b')),
	CONSTRAINT "replay_file_raw_status_check" CHECK("replay_file"."raw_status" in ('none', 'uploading', 'stored', 'deleted')),
	CONSTRAINT "replay_file_verified_check" CHECK("replay_file"."verified" in ('unverified', 'verified', 'mismatch')),
	CONSTRAINT "replay_file_raw_key_check" CHECK("replay_file"."raw_status" <> 'stored' or "replay_file"."raw_key" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `replay_file_sha256_unique` ON `replay_file` (`sha256`);--> statement-breakpoint
CREATE INDEX `replay_file_match_lobby_idx` ON `replay_file` (`match_id`,`lobby_id`);--> statement-breakpoint
CREATE TABLE `replay_segment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`game_id` integer,
	`lobby_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`team_map_json` text,
	`rehost_called_by` text,
	`status` text NOT NULL,
	`issue` text,
	FOREIGN KEY (`match_id`) REFERENCES `match`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "replay_segment_status_check" CHECK("replay_segment"."status" in ('ok', 'unassigned', 'ignored')),
	CONSTRAINT "replay_segment_issue_check" CHECK("replay_segment"."issue" in ('unknown_map', 'ambiguous_map', 'teams_unresolved', 'teams_differ')),
	CONSTRAINT "replay_segment_called_by_check" CHECK("replay_segment"."rehost_called_by" in ('a', 'b')),
	CONSTRAINT "replay_segment_assigned_check" CHECK(("replay_segment"."status" = 'ok') = ("replay_segment"."game_id" is not null and "replay_segment"."team_map_json" is not null))
);
--> statement-breakpoint
CREATE INDEX `replay_segment_game_idx` ON `replay_segment` (`game_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `replay_segment_match_lobby_unique` ON `replay_segment` (`match_id`,`lobby_id`);--> statement-breakpoint
CREATE TABLE `round_player` (
	`segment_id` integer NOT NULL,
	`local_n` integer NOT NULL,
	`idx` integer NOT NULL,
	`account` text,
	`player_id` integer,
	`name` text NOT NULL,
	`side_idx` integer NOT NULL,
	`operator` text,
	`operator_swaps_json` text,
	`kills` integer NOT NULL,
	`died` integer NOT NULL,
	`assists` integer NOT NULL,
	`headshots` integer NOT NULL,
	`opening_kill` integer NOT NULL,
	`opening_death` integer NOT NULL,
	`trade_kills` integer NOT NULL,
	`traded` integer NOT NULL,
	`survived` integer NOT NULL,
	`left` integer NOT NULL,
	`kost` integer NOT NULL,
	`clutch_vs` integer NOT NULL,
	`clutch_won` integer NOT NULL,
	PRIMARY KEY(`segment_id`, `local_n`, `idx`),
	FOREIGN KEY (`segment_id`) REFERENCES `replay_segment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "round_player_side_check" CHECK("round_player"."side_idx" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `round_player_player_idx` ON `round_player` (`player_id`);--> statement-breakpoint
CREATE TABLE `segment_round` (
	`segment_id` integer NOT NULL,
	`local_n` integer NOT NULL,
	`canonical_file_id` integer NOT NULL,
	`complete` integer NOT NULL,
	`winner_idx` integer,
	`win_condition` text,
	`attacker_idx` integer NOT NULL,
	`site` text,
	`planted` integer NOT NULL,
	`pov_count` integer NOT NULL,
	PRIMARY KEY(`segment_id`, `local_n`),
	FOREIGN KEY (`segment_id`) REFERENCES `replay_segment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`canonical_file_id`) REFERENCES `replay_file`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "segment_round_winner_check" CHECK("segment_round"."winner_idx" in (0, 1)),
	CONSTRAINT "segment_round_attacker_check" CHECK("segment_round"."attacker_idx" in (0, 1))
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_evidence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`game_id` integer,
	`kind` text NOT NULL,
	`object_key` text,
	`url` text,
	`post_channel_id` text,
	`post_message_id` text,
	`uploaded_by` integer NOT NULL,
	`player_id` integer,
	`deleted_at` integer,
	`visibility` text DEFAULT 'staff' NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `match`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "evidence_kind_check" CHECK("__new_evidence"."kind" in ('score_screenshot', 'moss', 'vod_link', 'other')),
	CONSTRAINT "evidence_visibility_check" CHECK("__new_evidence"."visibility" in ('staff', 'teams', 'public')),
	CONSTRAINT "evidence_location_check" CHECK("__new_evidence"."object_key" is not null or "__new_evidence"."url" is not null),
	CONSTRAINT "evidence_moss_player_check" CHECK("__new_evidence"."kind" <> 'moss' or "__new_evidence"."player_id" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_evidence`("id", "match_id", "game_id", "kind", "object_key", "url", "post_channel_id", "post_message_id", "uploaded_by", "visibility", "at") SELECT "id", "match_id", "game_id", "kind", "object_key", "url", "post_channel_id", "post_message_id", "uploaded_by", "visibility", "at" FROM `evidence`;--> statement-breakpoint
DROP TABLE `evidence`;--> statement-breakpoint
ALTER TABLE `__new_evidence` RENAME TO `evidence`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `evidence_match_idx` ON `evidence` (`match_id`);--> statement-breakpoint
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
	`status` text DEFAULT 'pending' NOT NULL,
	`stats_source` text DEFAULT 'none' NOT NULL,
	`stitch_status` text DEFAULT 'none' NOT NULL,
	`stitch_checks_json` text,
	FOREIGN KEY (`match_id`) REFERENCES `match`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "game_forfeit_side_check" CHECK("__new_game"."forfeit_side" in ('a', 'b', 'both')),
	CONSTRAINT "game_status_check" CHECK("__new_game"."status" in ('pending', 'final', 'void')),
	CONSTRAINT "game_stats_source_check" CHECK("__new_game"."stats_source" in ('none', 'manual', 'replay', 'api')),
	CONSTRAINT "game_stitch_status_check" CHECK("__new_game"."stitch_status" in ('none', 'auto', 'needs_review', 'staff'))
);
--> statement-breakpoint
INSERT INTO `__new_game`("id", "match_id", "n", "map", "bans_json", "score_a", "score_b", "overtime", "forfeit_side", "status", "stats_source") SELECT "id", "match_id", "n", "map", "bans_json", "score_a", "score_b", "overtime", "forfeit_side", "status", "stats_source" FROM `game`;--> statement-breakpoint
DROP TABLE `game`;--> statement-breakpoint
ALTER TABLE `__new_game` RENAME TO `game`;--> statement-breakpoint
CREATE UNIQUE INDEX `game_match_n_unique` ON `game` (`match_id`,`n`);--> statement-breakpoint
ALTER TABLE `match` ADD `moss_held_at` integer;--> statement-breakpoint
ALTER TABLE `match` ADD `moss_held_by` integer REFERENCES player(id);--> statement-breakpoint
ALTER TABLE `match` ADD `moss_hold_reason` text;