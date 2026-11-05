-- Week 6 additions (2026-11-04): what helps people before and on the day.
-- * difficulty / place_kind / newcomer_ok: shown on cards and the detail page so first-timers can choose.
-- * cancel_reason / cancelled_at: the organizer cancelled the activity (status CANCELLED). An admin rejection also uses
--   CANCELLED but leaves these empty and keeps its reason in review_note.
-- * reschedule_count: the organizer may move the date/time once, at least 24 hours before the original start.
-- * participations.late_minutes / late_at: "늦어요" (10/20/30 minutes) told to the organizer; nothing else changes.
ALTER TABLE activities
    ADD COLUMN difficulty VARCHAR(10) NOT NULL DEFAULT 'EASY' AFTER capacity,
    ADD COLUMN place_kind VARCHAR(10) NOT NULL DEFAULT 'OUTDOOR' AFTER difficulty,
    ADD COLUMN newcomer_ok BOOLEAN NOT NULL DEFAULT TRUE AFTER place_kind,
    ADD COLUMN reschedule_count TINYINT NOT NULL DEFAULT 0 AFTER newcomer_ok,
    ADD COLUMN cancel_reason VARCHAR(200) NULL AFTER reschedule_count,
    ADD COLUMN cancelled_at DATETIME NULL AFTER cancel_reason,
    ADD CONSTRAINT ck_activity_difficulty CHECK (difficulty IN ('EASY', 'NORMAL', 'HARD')),
    ADD CONSTRAINT ck_activity_place_kind CHECK (place_kind IN ('OUTDOOR', 'INDOOR', 'MIXED')),
    ADD CONSTRAINT ck_activity_reschedule CHECK (reschedule_count BETWEEN 0 AND 1);
ALTER TABLE participations
    ADD COLUMN late_minutes TINYINT NULL AFTER cancel_count,
    ADD COLUMN late_at DATETIME NULL AFTER late_minutes,
    ADD CONSTRAINT ck_participation_late CHECK (late_minutes IS NULL OR late_minutes IN (10, 20, 30));
