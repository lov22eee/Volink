-- Week 6 (added with the user, 2026-11-04): an activity's notices and Q&A, so the organizer and confirmed participants
-- can talk without sharing contact details. NOTICE by the organizer, QUESTION by a participant, ANSWER by the organizer
-- (parent = the question). Deleting keeps the row (deleted_at) so the thread stays readable for reports later.
CREATE TABLE activity_posts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    activity_id BIGINT NOT NULL,
    author_id BIGINT NOT NULL,
    kind VARCHAR(10) NOT NULL,
    parent_id BIGINT NULL,
    body VARCHAR(500) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL,
    CONSTRAINT ck_post_kind CHECK (kind IN ('NOTICE', 'QUESTION', 'ANSWER')),
    CONSTRAINT ck_post_parent CHECK ((kind = 'ANSWER') = (parent_id IS NOT NULL)),
    CONSTRAINT fk_post_activity FOREIGN KEY (activity_id) REFERENCES activities(id),
    CONSTRAINT fk_post_author FOREIGN KEY (author_id) REFERENCES users(id),
    CONSTRAINT fk_post_parent FOREIGN KEY (parent_id) REFERENCES activity_posts(id),
    INDEX ix_post_activity (activity_id, created_at),
    INDEX ix_post_author_time (author_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
