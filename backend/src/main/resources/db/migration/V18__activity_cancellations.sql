-- Organizer's emergency cancellation (2026-11-05): one record per cancelled activity with the reason code, the message
-- for participants and a snapshot of who was affected. The activity row keeps status CANCELLED (never deleted); the
-- existing cancel_reason/cancelled_at stay for older screens. UNIQUE(activity_id) makes a second cancel a no-op.
CREATE TABLE activity_cancellations (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    activity_id BIGINT NOT NULL,
    cancelled_by BIGINT NOT NULL,
    reason_code VARCHAR(20) NOT NULL,
    message VARCHAR(300) NOT NULL,
    status_before VARCHAR(20) NOT NULL,
    confirmed_count INT NULL,
    waiting_count INT NULL,
    applied_count INT NULL,
    cancelled_at DATETIME NOT NULL,
    CONSTRAINT uk_cancellation_activity UNIQUE (activity_id),
    CONSTRAINT fk_cancellation_activity FOREIGN KEY (activity_id) REFERENCES activities(id),
    CONSTRAINT fk_cancellation_user FOREIGN KEY (cancelled_by) REFERENCES users(id),
    CONSTRAINT ck_cancellation_reason CHECK (reason_code IN ('PERSONAL', 'WEATHER', 'PLACE', 'STAFF', 'OTHER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Cancellations made before this table (V9): reason "기타" with their text; the counts at the time are unknown (NULL).
INSERT INTO activity_cancellations(activity_id, cancelled_by, reason_code, message, status_before, cancelled_at)
    SELECT id, organizer_id, 'OTHER', LEFT(cancel_reason, 300), 'RECRUITING', cancelled_at
    FROM activities WHERE status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL;
