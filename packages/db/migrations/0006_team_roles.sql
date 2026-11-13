PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_team_staff` (
	`team_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`role` text NOT NULL,
	`since` integer NOT NULL,
	`until` integer,
	PRIMARY KEY(`team_id`, `player_id`, `since`),
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "team_staff_role_check" CHECK("__new_team_staff"."role" in ('owner', 'manager', 'coach'))
);
--> statement-breakpoint
-- The team's one manager becomes its owner, and its staff become managers (maintainer, 13 November 2026).
INSERT INTO `__new_team_staff`("team_id", "player_id", "role", "since", "until") SELECT "team_id", "player_id", CASE "role" WHEN 'manager' THEN 'owner' WHEN 'staff' THEN 'manager' ELSE "role" END, "since", "until" FROM `team_staff`;--> statement-breakpoint
DROP TABLE `team_staff`;--> statement-breakpoint
ALTER TABLE `__new_team_staff` RENAME TO `team_staff`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- The limit on team staff becomes the limit on managers, next to the new limit on coaches.
UPDATE `competition` SET `ruleset_json` = json_remove(json_set(`ruleset_json`, '$.team_roles', json_object('managers_max', coalesce(json_extract(`ruleset_json`, '$.team_staff_max'), 3), 'coaches_max', 1)), '$.team_staff_max');
