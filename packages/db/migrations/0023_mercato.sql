CREATE TABLE `mercato_window` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`opens_at` integer NOT NULL,
	`closes_at` integer NOT NULL,
	`max_moves_per_team` integer,
	`lock_hours` integer NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	`closed_early_at` integer,
	FOREIGN KEY (`season_id`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mercato_window_dates_check" CHECK("mercato_window"."opens_at" < "mercato_window"."closes_at"),
	CONSTRAINT "mercato_window_limit_check" CHECK("mercato_window"."max_moves_per_team" is null or "mercato_window"."max_moves_per_team" >= 1),
	CONSTRAINT "mercato_window_lock_check" CHECK("mercato_window"."lock_hours" >= 0)
);
--> statement-breakpoint
CREATE INDEX `mercato_window_season_idx` ON `mercato_window` (`season_id`);--> statement-breakpoint
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
	CONSTRAINT "request_kind_check" CHECK("__new_request"."kind" in ('team_owner', 'team_member_add', 'team_member_remove', 'registration', 'roster_move')),
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
-- LFR's mercato (O-35, M-22, maintainer, 16 and 19 November 2026): announced windows, 3 moves per
-- team, every incoming player blocked 24 hours. Only the seed's LFR, and only if it has none yet.
UPDATE `competition`
SET `ruleset_json` = json_set(`ruleset_json`, '$.mercato', json('{"mode":"windows","max_moves_per_team":3,"lock_hours":24,"intra_club_moves":"counted"}'))
WHERE `slug` = 'lfr'
  AND json_extract(`ruleset_json`, '$.mercato') IS NULL
  AND `org_id` IN (SELECT `id` FROM `org` WHERE `slug` = 'mbl-group');
