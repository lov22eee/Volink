-- Week 6 app (2026-11-05): "저장한 봉사" — a member keeps activities to look at later. Only the member sees the list.
CREATE TABLE saved_activities (
    user_id BIGINT NOT NULL,
    activity_id BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, activity_id),
    CONSTRAINT fk_saved_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_saved_activity FOREIGN KEY (activity_id) REFERENCES activities(id),
    INDEX ix_saved_activity (activity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
