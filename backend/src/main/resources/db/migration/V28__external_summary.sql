-- 2026-11-06: the person's 1365 total (봉사참여 실적: total time, count, time per field), read in the lab from their own
-- 1365 page on the phone. One row per person, replaced on each import. Names on that page are never sent or stored.
CREATE TABLE external_summaries (
    user_id BIGINT PRIMARY KEY,
    total_minutes INT NOT NULL,
    activity_count INT NULL,
    fields JSON NULL,
    fetched_at DATETIME NOT NULL,
    CONSTRAINT fk_external_summary_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT ck_external_summary CHECK (total_minutes BETWEEN 0 AND 600000 AND (activity_count IS NULL OR activity_count BETWEEN 0 AND 100000))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
