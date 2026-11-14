CREATE TABLE `rules_version` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competition_id` integer NOT NULL,
	`version` text NOT NULL,
	`markdown` text NOT NULL,
	`voted_at` integer,
	`effective_from` integer NOT NULL,
	`published_by` integer NOT NULL,
	`published_at` integer NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competition`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`published_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rules_version_competition_effective_idx` ON `rules_version` (`competition_id`,`effective_from`);--> statement-breakpoint
CREATE UNIQUE INDEX `rules_version_competition_version_unique` ON `rules_version` (`competition_id`,`version`);