CREATE TABLE `club_staff` (
	`club_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`role` text NOT NULL,
	`since` integer NOT NULL,
	`until` integer,
	PRIMARY KEY(`club_id`, `player_id`, `since`),
	FOREIGN KEY (`club_id`) REFERENCES `club`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "club_staff_role_check" CHECK("club_staff"."role" in ('owner', 'manager'))
);