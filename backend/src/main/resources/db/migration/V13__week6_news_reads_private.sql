-- Week 6 app (2026-11-05, user request): 활동 소식 improvements.
-- * private_post: a question only the organizer (and the asker) can see, e.g. about health. Its answer follows it.
-- * activity_post_seen: when each person last opened the activity's news. Gives "새 공지 1 · 새 답변 1" on the entry
--   card and "확정 3명 중 2명 읽음" under a notice (read = opened the news after the notice was posted).
ALTER TABLE activity_posts
    ADD COLUMN private_post BOOLEAN NOT NULL DEFAULT FALSE AFTER body;

CREATE TABLE activity_post_seen (
    activity_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (activity_id, user_id),
    CONSTRAINT fk_post_seen_activity FOREIGN KEY (activity_id) REFERENCES activities(id),
    CONSTRAINT fk_post_seen_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
