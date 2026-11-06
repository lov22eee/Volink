-- 2026-11-06: rows taken from the 1365 list often have a day but no time. Until now 09:00~11:00 was filled in and shown as
-- if real; now the time is stored only for ordering and shown as "시간 미정" when the page had none.
ALTER TABLE external_records ADD COLUMN time_known BOOLEAN NOT NULL DEFAULT TRUE AFTER ends_at;
