-- 기관 모집글 (2026-11-11): the 1365 recruitment page the institution also posted, shown to people as a link only.
-- Volink does not check 1365; the page says the record is made on 1365.
ALTER TABLE activities ADD COLUMN vms_link VARCHAR(300) NULL;
