-- Week 7 (2026-11-09): 모집자 시간 추가. When an activity took longer than planned, the organizer can add the extra time
-- once, within 24 hours after the planned end, up to 2 hours: to their own hosted time and to the participants who stayed.
ALTER TABLE activities
    ADD COLUMN extra_minutes INT NOT NULL DEFAULT 0,
    ADD COLUMN extra_reason VARCHAR(40) NULL,
    ADD COLUMN extra_at DATETIME NULL,
    ADD CONSTRAINT ck_activity_extra CHECK (extra_minutes BETWEEN 0 AND 120);
ALTER TABLE participations
    ADD COLUMN extra_minutes INT NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_participation_extra CHECK (extra_minutes BETWEEN 0 AND 120);
