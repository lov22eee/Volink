-- 자동 승인 (2026-11-05 user request): the organizer may let applications be confirmed at once while seats are free
-- (when full, people still join the waitlist in order). Off by default = each application is approved by hand.
ALTER TABLE activities ADD COLUMN auto_approve BOOLEAN NOT NULL DEFAULT FALSE;
