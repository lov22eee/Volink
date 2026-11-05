-- Week 6 app (2026-11-05, user request): community tab. Categories: FREE (자유), QUESTION (질문), REVIEW (봉사후기).
-- A review is tied to an activity the author completed (the screen shows "참여 확인"). Names are shown partly hidden,
-- contact details are refused like in 활동 소식, and deleting keeps the row (deleted_at) for reports in week 7.
CREATE TABLE community_posts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    author_id BIGINT NOT NULL,
    category VARCHAR(10) NOT NULL,
    title VARCHAR(60) NOT NULL,
    body VARCHAR(2000) NOT NULL,
    activity_id BIGINT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL,
    CONSTRAINT ck_community_category CHECK (category IN ('FREE', 'QUESTION', 'REVIEW')),
    CONSTRAINT ck_community_review CHECK ((category = 'REVIEW') = (activity_id IS NOT NULL)),
    CONSTRAINT fk_community_author FOREIGN KEY (author_id) REFERENCES users(id),
    CONSTRAINT fk_community_activity FOREIGN KEY (activity_id) REFERENCES activities(id),
    INDEX ix_community_list (deleted_at, category, created_at),
    INDEX ix_community_author_time (author_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE community_comments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    post_id BIGINT NOT NULL,
    author_id BIGINT NOT NULL,
    body VARCHAR(500) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL,
    CONSTRAINT fk_comment_post FOREIGN KEY (post_id) REFERENCES community_posts(id),
    CONSTRAINT fk_comment_author FOREIGN KEY (author_id) REFERENCES users(id),
    INDEX ix_comment_post (post_id, created_at),
    INDEX ix_comment_author_time (author_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE community_likes (
    post_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, user_id),
    CONSTRAINT fk_like_post FOREIGN KEY (post_id) REFERENCES community_posts(id),
    CONSTRAINT fk_like_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A comment on my community post is told in the app.
ALTER TABLE notifications
    DROP CHECK ck_notification_type,
    ADD CONSTRAINT ck_notification_type CHECK (type IN ('APPLICATION_RESULT', 'WAITLIST_OFFER', 'ACTIVITY_CHANGED', 'ACTIVITY_REMINDER',
        'RECORD_CONFIRMED', 'REPORT_RESULT', 'ORGANIZATION_REVIEW', 'SANCTION', 'COMMUNITY_COMMENT'));
