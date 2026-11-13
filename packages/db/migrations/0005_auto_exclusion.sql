ALTER TABLE `slot` ADD `auto_exclusion_off_reason` text;--> statement-breakpoint
ALTER TABLE `slot` ADD `auto_exclusion_off_by` integer REFERENCES player(id);--> statement-breakpoint
ALTER TABLE `slot` ADD `auto_exclusion_off_at` integer;