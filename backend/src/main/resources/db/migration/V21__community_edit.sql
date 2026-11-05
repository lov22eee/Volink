-- Community (2026-11-05 user request): authors can fix their post or comment, shown as "수정됨".
-- Reporting posts and comments is week-7 work (the app shows the button only).
ALTER TABLE community_posts ADD COLUMN edited_at DATETIME NULL;
ALTER TABLE community_comments ADD COLUMN edited_at DATETIME NULL;
