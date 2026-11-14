-- 0010 created club_staff; this moves the owners into it. A separate migration because 0010
-- was already applied, as the table alone, to a database in use.
-- Each team's owner becomes the owner of the team's club, with the same dates.
INSERT OR IGNORE INTO `club_staff`("club_id", "player_id", "role", "since", "until") SELECT `team`."club_id", `team_staff`."player_id", 'owner', `team_staff`."since", `team_staff`."until" FROM `team_staff` INNER JOIN `team` ON `team`."id" = `team_staff`."team_id" WHERE `team_staff`."role" = 'owner' ORDER BY `team_staff`."since", `team_staff`."team_id";--> statement-breakpoint
DELETE FROM `team_staff` WHERE "role" = 'owner';--> statement-breakpoint
-- Someone who owned two rosters of one club keeps one role in it: the earliest.
DELETE FROM `club_staff` WHERE "until" IS NULL AND EXISTS (SELECT 1 FROM `club_staff` AS `earlier` WHERE `earlier`."club_id" = `club_staff`."club_id" AND `earlier`."player_id" = `club_staff`."player_id" AND `earlier`."until" IS NULL AND (`earlier`."since" < `club_staff`."since" OR (`earlier`."since" = `club_staff`."since" AND `earlier`.rowid < `club_staff`.rowid)));--> statement-breakpoint
-- A club whose rosters had different owners keeps the earliest as its owner; the others become
-- its managers.
UPDATE `club_staff` SET "role" = 'manager' WHERE "role" = 'owner' AND "until" IS NULL AND EXISTS (SELECT 1 FROM `club_staff` AS `first` WHERE `first`."club_id" = `club_staff`."club_id" AND `first`."role" = 'owner' AND `first`."until" IS NULL AND (`first`."since" < `club_staff`."since" OR (`first`."since" = `club_staff`."since" AND `first`.rowid < `club_staff`.rowid)));
