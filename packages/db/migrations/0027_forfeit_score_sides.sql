-- Each side of a forfeit gets its own rounds (O-36, maintainer, 19 November 2026): LFR Season 4
-- gives the team that receives a forfeit 7-3 and the team that forfeits 0-7. A stored single
-- pair [winner, loser] becomes the same score on both sides, [w, l] and [l, w], so no standings
-- change. Settings already split are left alone.
UPDATE `season`
SET `settings_json` = json_set(
  `settings_json`,
  '$.forfeit_score', json_object(
    'winner', json_array(json_extract(`settings_json`, '$.forfeit_score[0]'), json_extract(`settings_json`, '$.forfeit_score[1]')),
    'loser', json_array(json_extract(`settings_json`, '$.forfeit_score[1]'), json_extract(`settings_json`, '$.forfeit_score[0]'))
  )
)
WHERE json_type(`settings_json`, '$.forfeit_score') = 'array';
--> statement-breakpoint
UPDATE `season`
SET `settings_json` = json_set(
  `settings_json`,
  '$.exclusion_forfeit_score', json_object(
    'winner', json_array(json_extract(`settings_json`, '$.exclusion_forfeit_score[0]'), json_extract(`settings_json`, '$.exclusion_forfeit_score[1]')),
    'loser', json_array(json_extract(`settings_json`, '$.exclusion_forfeit_score[1]'), json_extract(`settings_json`, '$.exclusion_forfeit_score[0]'))
  )
)
WHERE json_type(`settings_json`, '$.exclusion_forfeit_score') = 'array';
