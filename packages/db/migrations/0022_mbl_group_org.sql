-- Competitions moved under their organisation's address, `/:org/:comp` (phase 3f-5). The first
-- seed named the organisation after its league, "LFR"; it is MBL Group, which runs the LFR and its
-- other leagues (design doc section 1). Only that exact row is renamed, and only while no
-- organisation holds the new slug.
UPDATE `org`
SET `name` = 'MBL Group', `slug` = 'mbl-group'
WHERE `slug` = 'lfr' AND `name` = 'LFR'
  AND NOT EXISTS (SELECT 1 FROM `org` AS `other` WHERE `other`.`slug` = 'mbl-group');
