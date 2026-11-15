-- Registrations filed before 15 November 2026 carried the club and roster to create at approval.
-- A registration now enters an existing roster (M-33): those still waiting are withdrawn, each
-- with an audit row, and their filer creates the club on the website and registers again
-- (maintainer, 15 November 2026). Their invitation links stop working.
INSERT INTO `audit_log` (`actor_player_id`, `actor_kind`, `action`, `entity`, `entity_id`, `before_json`, `after_json`, `at`)
SELECT NULL, 'system', 'registration.withdraw', 'request', CAST(`id` AS TEXT), '{"status":"pending"}', '{"status":"withdrawn","because":"M-33"}', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `request`
WHERE `kind` = 'registration' AND `status` = 'pending' AND json_extract(`payload_json`, '$.roster') IS NOT NULL;
--> statement-breakpoint
UPDATE `request`
SET `status` = 'withdrawn', `decided_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE `kind` = 'registration' AND `status` = 'pending' AND json_extract(`payload_json`, '$.roster') IS NOT NULL;
--> statement-breakpoint
UPDATE `registration_invite`
SET `revoked_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE `revoked_at` IS NULL;
