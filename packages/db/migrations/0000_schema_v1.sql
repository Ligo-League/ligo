CREATE TABLE `game_account` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` integer NOT NULL,
	`title` text NOT NULL,
	`external_id` text NOT NULL,
	`display_name` text NOT NULL,
	`rank_at_registration` text,
	`verified` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "game_account_title_check" CHECK("game_account"."title" in ('r6', 'valorant', 'rocket_league', 'lol', 'cs'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_account_title_external_unique` ON `game_account` (`title`,`external_id`);--> statement-breakpoint
CREATE TABLE `org` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`locale` text DEFAULT 'fr' NOT NULL,
	`settings_json` text NOT NULL,
	CONSTRAINT "org_locale_check" CHECK("org"."locale" in ('fr', 'en'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_slug_unique` ON `org` (`slug`);--> statement-breakpoint
CREATE TABLE `player` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`slug` text NOT NULL,
	`display_name` text NOT NULL,
	`discord_user_id` text,
	`nationality` text,
	`stats_consent_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `org`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_discord_user_id_unique` ON `player` (`discord_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `player_org_slug_unique` ON `player` (`org_id`,`slug`);--> statement-breakpoint
CREATE TABLE `team` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`title` text NOT NULL,
	`name` text NOT NULL,
	`tag` text NOT NULL,
	`slug` text NOT NULL,
	`city` text,
	`legal_status` text,
	`colors_json` text NOT NULL,
	`logo_key` text,
	`socials_json` text NOT NULL,
	`discord_url` text,
	`can_stream` integer DEFAULT false NOT NULL,
	`discord_role_id` text,
	FOREIGN KEY (`org_id`) REFERENCES `org`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "team_title_check" CHECK("team"."title" in ('r6', 'valorant', 'rocket_league', 'lol', 'cs')),
	CONSTRAINT "team_legal_status_check" CHECK("team"."legal_status" in ('association', 'association_1901', 'company', 'amateur'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_org_title_tag_unique` ON `team` (`org_id`,`title`,`tag`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_org_slug_unique` ON `team` (`org_id`,`slug`);--> statement-breakpoint
CREATE TABLE `team_staff` (
	`team_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`role` text NOT NULL,
	`since` integer NOT NULL,
	`until` integer,
	PRIMARY KEY(`team_id`, `player_id`, `since`),
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "team_staff_role_check" CHECK("team_staff"."role" in ('manager', 'staff'))
);
--> statement-breakpoint
CREATE TABLE `competition` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`title` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`participant_mode` text NOT NULL,
	`ruleset_json` text NOT NULL,
	`points_json` text NOT NULL,
	`tiebreak_json` text NOT NULL,
	`scheduling_json` text NOT NULL,
	`stat_schema_version` integer NOT NULL,
	`theme_json` text NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `org`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "competition_title_check" CHECK("competition"."title" in ('r6', 'valorant', 'rocket_league', 'lol', 'cs')),
	CONSTRAINT "competition_participant_mode_check" CHECK("competition"."participant_mode" in ('team', 'mixed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `competition_org_slug_unique` ON `competition` (`org_id`,`slug`);--> statement-breakpoint
CREATE TABLE `division` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`level` integer NOT NULL,
	`region` text,
	`category_prefix` text NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "division_kind_check" CHECK("division"."kind" in ('league', 'regional'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `division_season_name_unique` ON `division` (`season_id`,`name`);--> statement-breakpoint
CREATE TABLE `league_guild` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`org_id` integer NOT NULL,
	`competition_id` integer NOT NULL,
	`staff_role_id` text NOT NULL,
	`alerts_channel_id` text,
	`results_channel_id` text,
	`mercato_channel_id` text,
	FOREIGN KEY (`org_id`) REFERENCES `org`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`competition_id`) REFERENCES `competition`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `roster_entry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`team_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`role` text NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_to` integer,
	FOREIGN KEY (`season_id`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "roster_entry_role_check" CHECK("roster_entry"."role" in ('player', 'sub', 'coach'))
);
--> statement-breakpoint
CREATE INDEX `roster_entry_season_team_idx` ON `roster_entry` (`season_id`,`team_id`);--> statement-breakpoint
CREATE INDEX `roster_entry_player_idx` ON `roster_entry` (`player_id`);--> statement-breakpoint
CREATE TABLE `season` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competition_id` integer NOT NULL,
	`name` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`settings_json` text NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competition`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "season_starts_on_check" CHECK("season"."starts_on" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "season_ends_on_check" CHECK("season"."ends_on" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "season_status_check" CHECK("season"."status" in ('registration', 'active', 'cup', 'closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `season_competition_name_unique` ON `season` (`competition_id`,`name`);--> statement-breakpoint
CREATE TABLE `slot` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`division_id` integer NOT NULL,
	`team_id` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`forfeits` integer DEFAULT 0 NOT NULL,
	`excluded_at` integer,
	FOREIGN KEY (`division_id`) REFERENCES `division`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "slot_status_check" CHECK("slot"."status" in ('active', 'frozen', 'withdrawn', 'excluded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slot_division_team_unique` ON `slot` (`division_id`,`team_id`);--> statement-breakpoint
CREATE TABLE `stage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`division_id` integer,
	`ord` integer NOT NULL,
	`kind` text NOT NULL,
	`config_json` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`division_id`) REFERENCES `division`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stage_kind_check" CHECK("stage"."kind" in ('round_robin', 'single_elim', 'double_elim', 'barrage', 'ladder')),
	CONSTRAINT "stage_status_check" CHECK("stage"."status" in ('draft', 'published', 'closed'))
);
--> statement-breakpoint
CREATE INDEX `stage_season_idx` ON `stage` (`season_id`);--> statement-breakpoint
CREATE TABLE `stage_entry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stage_id` integer NOT NULL,
	`slot_id` integer,
	`player_id` integer,
	`seed` integer NOT NULL,
	FOREIGN KEY (`stage_id`) REFERENCES `stage`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`slot_id`) REFERENCES `slot`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stage_entry_participant_check" CHECK(("stage_entry"."slot_id" is null) <> ("stage_entry"."player_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stage_entry_stage_slot_unique` ON `stage_entry` (`stage_id`,`slot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stage_entry_stage_player_unique` ON `stage_entry` (`stage_id`,`player_id`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`game_id` integer,
	`kind` text NOT NULL,
	`object_key` text,
	`url` text,
	`uploaded_by` integer NOT NULL,
	`visibility` text DEFAULT 'staff' NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `match`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "evidence_kind_check" CHECK("evidence"."kind" in ('score_screenshot', 'moss', 'vod_link', 'other')),
	CONSTRAINT "evidence_visibility_check" CHECK("evidence"."visibility" in ('staff', 'teams', 'public')),
	CONSTRAINT "evidence_location_check" CHECK("evidence"."object_key" is not null or "evidence"."url" is not null)
);
--> statement-breakpoint
CREATE INDEX `evidence_match_idx` ON `evidence` (`match_id`);--> statement-breakpoint
CREATE TABLE `game` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`n` integer NOT NULL,
	`map` text,
	`bans_json` text NOT NULL,
	`score_a` integer DEFAULT 0 NOT NULL,
	`score_b` integer DEFAULT 0 NOT NULL,
	`overtime` integer DEFAULT false NOT NULL,
	`forfeit_side` text,
	`rehosts_a` integer DEFAULT 0 NOT NULL,
	`rehosts_b` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`stats_source` text DEFAULT 'none' NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `match`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "game_forfeit_side_check" CHECK("game"."forfeit_side" in ('a', 'b')),
	CONSTRAINT "game_status_check" CHECK("game"."status" in ('pending', 'final', 'void')),
	CONSTRAINT "game_stats_source_check" CHECK("game"."stats_source" in ('none', 'manual', 'replay', 'api'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_match_n_unique` ON `game` (`match_id`,`n`);--> statement-breakpoint
CREATE TABLE `lineup` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`side` text NOT NULL,
	`team_id` integer,
	FOREIGN KEY (`match_id`) REFERENCES `match`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lineup_side_check" CHECK("lineup"."side" in ('a', 'b'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lineup_match_side_unique` ON `lineup` (`match_id`,`side`);--> statement-breakpoint
CREATE TABLE `lineup_member` (
	`lineup_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`lineup_id`, `player_id`),
	FOREIGN KEY (`lineup_id`) REFERENCES `lineup`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lineup_member_role_check" CHECK("lineup_member"."role" in ('starter', 'sub'))
);
--> statement-breakpoint
CREATE TABLE `match` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stage_id` integer NOT NULL,
	`week` integer,
	`bracket_node` text,
	`best_of` integer NOT NULL,
	`host_side` text,
	`side_chooser` text,
	`ot_side_chooser` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`window_start` integer NOT NULL,
	`window_end` integer NOT NULL,
	`scheduled_at` integer,
	`auto_scheduled` integer DEFAULT false NOT NULL,
	`channel_id` text,
	`reported_by` integer,
	`confirmed_by` integer,
	`validated_by` integer,
	`validated_at` integer,
	FOREIGN KEY (`stage_id`) REFERENCES `stage`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reported_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`validated_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "match_host_side_check" CHECK("match"."host_side" in ('a', 'b')),
	CONSTRAINT "match_side_chooser_check" CHECK("match"."side_chooser" in ('a', 'b')),
	CONSTRAINT "match_ot_side_chooser_check" CHECK("match"."ot_side_chooser" in ('a', 'b')),
	CONSTRAINT "match_status_check" CHECK("match"."status" in ('scheduled', 'reported', 'confirmed', 'disputed', 'validated', 'forfeit', 'void'))
);
--> statement-breakpoint
CREATE INDEX `match_stage_week_idx` ON `match` (`stage_id`,`week`);--> statement-breakpoint
CREATE INDEX `match_status_idx` ON `match` (`status`);--> statement-breakpoint
CREATE TABLE `match_slot` (
	`match_id` integer NOT NULL,
	`side` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_ref` integer NOT NULL,
	PRIMARY KEY(`match_id`, `side`),
	FOREIGN KEY (`match_id`) REFERENCES `match`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "match_slot_side_check" CHECK("match_slot"."side" in ('a', 'b')),
	CONSTRAINT "match_slot_source_kind_check" CHECK("match_slot"."source_kind" in ('entry', 'seed', 'winner_of', 'loser_of'))
);
--> statement-breakpoint
CREATE TABLE `sanction` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` integer NOT NULL,
	`kind` text NOT NULL,
	`points_delta` integer,
	`match_id` integer,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`reason` text NOT NULL,
	`decided_by` integer NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`match_id`) REFERENCES `match`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sanction_target_kind_check" CHECK("sanction"."target_kind" in ('slot', 'team', 'player', 'staff')),
	CONSTRAINT "sanction_kind_check" CHECK("sanction"."kind" in ('warning', 'admin_defeat', 'points', 'forfeit', 'suspension', 'exclusion', 'slot_freeze', 'slot_withdrawal', 'accreditation_removal', 'league_ban'))
);
--> statement-breakpoint
CREATE INDEX `sanction_season_idx` ON `sanction` (`season_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_player_id` integer,
	`actor_kind` text NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`actor_player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audit_log_actor_kind_check" CHECK("audit_log"."actor_kind" in ('user', 'bot', 'system'))
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`);