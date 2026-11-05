-- Week 6 app (2026-11-05, user request): the community shows a nickname (e.g. "따뜻한 자몽") instead of the hidden real
-- name, chosen on the first visit together with agreeing to the community rules. One change per 30 days.
ALTER TABLE users
    ADD COLUMN community_nickname VARCHAR(12) NULL,
    ADD COLUMN community_agreed_at DATETIME NULL,
    ADD COLUMN nickname_changed_at DATETIME NULL,
    ADD CONSTRAINT uq_users_community_nickname UNIQUE (community_nickname);
