CREATE TABLE `dispute` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`evidence_id` integer NOT NULL,
	`reason` text NOT NULL,
	`details` text,
	`raised_by` integer NOT NULL,
	`at` integer NOT NULL,
	`resolution` text,
	`resolved_by` integer,
	`resolved_at` integer,
	FOREIGN KEY (`match_id`) REFERENCES `match`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raised_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dispute_resolution_check" CHECK("dispute"."resolution" in ('validated', 'rejected', 'voided', 'result_entered', 'forfeit')),
	CONSTRAINT "dispute_resolved_check" CHECK(("dispute"."resolution" is null) = ("dispute"."resolved_by" is null) and ("dispute"."resolution" is null) = ("dispute"."resolved_at" is null))
);
--> statement-breakpoint
CREATE INDEX `dispute_match_idx` ON `dispute` (`match_id`);