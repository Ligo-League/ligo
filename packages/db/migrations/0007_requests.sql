CREATE TABLE `queue_post` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`entity_id` integer NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text NOT NULL,
	`posted_at` integer NOT NULL,
	CONSTRAINT "queue_post_entity_check" CHECK("queue_post"."entity" in ('request', 'match', 'dispute'))
);
--> statement-breakpoint
CREATE INDEX `queue_post_entity_idx` ON `queue_post` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `request` (
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
	CONSTRAINT "request_kind_check" CHECK("request"."kind" in ('team_owner', 'team_member_add', 'team_member_remove')),
	CONSTRAINT "request_approval_check" CHECK("request"."approval" in ('auto', 'staff')),
	CONSTRAINT "request_status_check" CHECK("request"."status" in ('pending', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "request_decided_check" CHECK(("request"."status" = 'pending') = ("request"."decided_at" is null)),
	CONSTRAINT "request_reason_check" CHECK("request"."status" <> 'rejected' or "request"."reason" is not null)
);
--> statement-breakpoint
CREATE INDEX `request_status_idx` ON `request` (`status`);--> statement-breakpoint
CREATE INDEX `request_team_idx` ON `request` (`team_id`);