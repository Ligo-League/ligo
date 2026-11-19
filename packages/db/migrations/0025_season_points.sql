-- Each season keeps its own points and tie-breakers (maintainer, 19 November 2026; M-40):
-- standings are computed, so changing the competition's would rewrite the seasons already
-- played. The competition's columns stay as what a new season copies. A season that already has
-- its own keeps them.
UPDATE `season`
SET `settings_json` = json_set(
  `settings_json`,
  '$.points', json((SELECT `points_json` FROM `competition` WHERE `competition`.`id` = `season`.`competition_id`)),
  '$.tiebreak', json((SELECT `tiebreak_json` FROM `competition` WHERE `competition`.`id` = `season`.`competition_id`))
)
WHERE json_extract(`settings_json`, '$.points') IS NULL;
