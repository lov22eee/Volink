-- 2026-11-26 (presentation day): the app was logged out after a refresh whose answer never reached it (phone asleep,
-- weak Wi-Fi): the server had already rotated the token, so the app's next refresh used a revoked one. A rotated token
-- now remembers its replacement; while that replacement has never been used, the old token is accepted once more.
ALTER TABLE refresh_tokens ADD COLUMN replaced_by BIGINT NULL;
