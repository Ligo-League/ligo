CREATE TABLE `registration_invite` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`nonce` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`request_id`) REFERENCES `request`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `registration_invite_request_idx` ON `registration_invite` (`request_id`);--> statement-breakpoint
CREATE TABLE `registration_player` (
	`request_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`role` text NOT NULL,
	`captain` integer DEFAULT false NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`request_id`, `player_id`),
	FOREIGN KEY (`request_id`) REFERENCES `request`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "registration_player_role_check" CHECK("registration_player"."role" in ('player', 'sub'))
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_request` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competition_id` integer NOT NULL,
	`season_id` integer,
	`team_id` integer,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`approval` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`note` text,
	`requested_by` integer NOT NULL,
	`requested_at` integer NOT NULL,
	`decided_by` integer,
	`decided_at` integer,
	`reason` text,
	`reminded_at` integer,
	FOREIGN KEY (`competition_id`) REFERENCES `competition`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`season_id`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "request_kind_check" CHECK("__new_request"."kind" in ('team_owner', 'team_member_add', 'team_member_remove', 'registration')),
	CONSTRAINT "request_approval_check" CHECK("__new_request"."approval" in ('auto', 'staff')),
	CONSTRAINT "request_status_check" CHECK("__new_request"."status" in ('pending', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "request_decided_check" CHECK(("__new_request"."status" = 'pending') = ("__new_request"."decided_at" is null)),
	CONSTRAINT "request_reason_check" CHECK("__new_request"."status" <> 'rejected' or "__new_request"."reason" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_request`("id", "competition_id", "season_id", "team_id", "kind", "payload_json", "approval", "status", "note", "requested_by", "requested_at", "decided_by", "decided_at", "reason", "reminded_at") SELECT "id", "competition_id", "season_id", "team_id", "kind", "payload_json", "approval", "status", "note", "requested_by", "requested_at", "decided_by", "decided_at", "reason", "reminded_at" FROM `request`;--> statement-breakpoint
DROP TABLE `request`;--> statement-breakpoint
ALTER TABLE `__new_request` RENAME TO `request`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `request_status_idx` ON `request` (`status`);--> statement-breakpoint
CREATE INDEX `request_team_idx` ON `request` (`team_id`);--> statement-breakpoint
-- The two rank columns are new: nothing to copy into them.
CREATE TABLE `__new_game_account` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` integer NOT NULL,
	`title` text NOT NULL,
	`external_id` text,
	`display_name` text NOT NULL,
	`rank_at_registration` text,
	`rank` text,
	`rank_updated_at` integer,
	`verified` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "game_account_title_check" CHECK("__new_game_account"."title" in ('r6', 'valorant', 'rocket_league', 'lol', 'cs'))
);
--> statement-breakpoint
INSERT INTO `__new_game_account`("id", "player_id", "title", "external_id", "display_name", "rank_at_registration", "rank", "rank_updated_at", "verified") SELECT "id", "player_id", "title", "external_id", "display_name", "rank_at_registration", NULL, NULL, "verified" FROM `game_account`;--> statement-breakpoint
DROP TABLE `game_account`;--> statement-breakpoint
ALTER TABLE `__new_game_account` RENAME TO `game_account`;--> statement-breakpoint
CREATE UNIQUE INDEX `game_account_title_external_unique` ON `game_account` (`title`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `game_account_player_title_unique` ON `game_account` (`player_id`,`title`);