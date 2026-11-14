CREATE TABLE `club` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`city` text,
	`legal_status` text,
	`colors_json` text NOT NULL,
	`logo_key` text,
	`socials_json` text NOT NULL,
	`discord_url` text,
	FOREIGN KEY (`org_id`) REFERENCES `org`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "club_legal_status_check" CHECK("club"."legal_status" in ('association', 'association_1901', 'company', 'amateur'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `club_org_slug_unique` ON `club` (`org_id`,`slug`);--> statement-breakpoint
-- Every existing team becomes the only roster of a club of its own, which takes its name, slug,
-- details, logo and colours; the roster's own colours and logo stay empty and fall back to them.
INSERT INTO `club`("org_id", "name", "slug", "city", "legal_status", "colors_json", "logo_key", "socials_json", "discord_url") SELECT "org_id", "name", "slug", "city", "legal_status", "colors_json", "logo_key", "socials_json", "discord_url" FROM `team` ORDER BY "id";--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_team` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`club_id` integer NOT NULL,
	`title` text NOT NULL,
	`name` text NOT NULL,
	`tag` text NOT NULL,
	`slug` text NOT NULL,
	`colors_json` text,
	`logo_key` text,
	`can_stream` integer DEFAULT false NOT NULL,
	`discord_role_id` text,
	FOREIGN KEY (`org_id`) REFERENCES `org`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`club_id`) REFERENCES `club`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "team_title_check" CHECK("__new_team"."title" in ('r6', 'valorant', 'rocket_league', 'lol', 'cs'))
);
--> statement-breakpoint
INSERT INTO `__new_team`("id", "org_id", "club_id", "title", "name", "tag", "slug", "colors_json", "logo_key", "can_stream", "discord_role_id") SELECT `team`."id", `team`."org_id", `club`."id", `team`."title", `team`."name", `team`."tag", `team`."slug", NULL, NULL, `team`."can_stream", `team`."discord_role_id" FROM `team` INNER JOIN `club` ON `club`."org_id" = `team`."org_id" AND `club`."slug" = `team`."slug";--> statement-breakpoint
DROP TABLE `team`;--> statement-breakpoint
ALTER TABLE `__new_team` RENAME TO `team`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `team_org_title_tag_unique` ON `team` (`org_id`,`title`,`tag`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_org_slug_unique` ON `team` (`org_id`,`slug`);