ALTER TABLE `org` ADD `owner_discord_user_id` text;--> statement-breakpoint
ALTER TABLE `org` ADD `invite_url` text;--> statement-breakpoint
ALTER TABLE `org` ADD `description` text;--> statement-breakpoint
ALTER TABLE `org` ADD `logo_key` text;--> statement-breakpoint
-- The group is MLB Group, not MBL Group: migration 0022's name was a typo (maintainer,
-- 19 November 2026). Only that exact row is renamed, and only while no organisation holds the
-- new slug; `/mbl-group/...` addresses redirect to `/mlb-group/...`.
UPDATE `org`
SET `name` = 'MLB Group', `slug` = 'mlb-group'
WHERE `slug` = 'mbl-group' AND `name` = 'MBL Group'
  AND NOT EXISTS (SELECT 1 FROM `org` AS `other` WHERE `other`.`slug` = 'mlb-group');--> statement-breakpoint
-- MLB Group's owner, given by the maintainer (19 November 2026, M-20).
UPDATE `org`
SET `owner_discord_user_id` = '994597181476569170'
WHERE `slug` = 'mlb-group' AND `owner_discord_user_id` IS NULL;
