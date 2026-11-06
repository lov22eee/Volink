-- 2026-11-06: 1365 activities in my records. Volink cannot see 1365 applications, so the person marks them
-- (SELF: "1365에서 신청했어요"; LAB: picked from their own 1365 page in the in-app lab), says whether they went,
-- may add the values read from their 1365 certificate (no file is kept), and can write a review about it.
CREATE TABLE external_records (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    program_no VARCHAR(20) NULL,
    title VARCHAR(255) NOT NULL,
    organization VARCHAR(255) NULL,
    place VARCHAR(255) NULL,
    starts_at DATETIME NOT NULL,
    ends_at DATETIME NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'PLANNED',
    source VARCHAR(8) NOT NULL DEFAULT 'SELF',
    lab_status VARCHAR(40) NULL,
    cert_title VARCHAR(255) NULL,
    cert_org VARCHAR(255) NULL,
    cert_date DATE NULL,
    cert_minutes INT NULL,
    cert_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_external_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT ck_external_status CHECK (status IN ('PLANNED', 'ATTENDED', 'MISSED')),
    CONSTRAINT ck_external_source CHECK (source IN ('SELF', 'LAB')),
    CONSTRAINT ck_external_time CHECK (ends_at > starts_at),
    CONSTRAINT ck_external_minutes CHECK (cert_minutes IS NULL OR cert_minutes BETWEEN 1 AND 1440),
    INDEX ix_external_user (user_id, starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A review is about one Volink activity or one 1365 record (promotions: a Volink activity only).
ALTER TABLE community_posts
    ADD COLUMN external_id BIGINT NULL AFTER activity_id,
    ADD CONSTRAINT fk_community_external FOREIGN KEY (external_id) REFERENCES external_records(id),
    DROP CHECK ck_community_activity;
ALTER TABLE community_posts
    ADD CONSTRAINT ck_community_activity CHECK (
        (category = 'PROMO' AND activity_id IS NOT NULL AND external_id IS NULL)
        OR (category = 'REVIEW' AND ((activity_id IS NOT NULL) + (external_id IS NOT NULL)) = 1)
        OR (category IN ('FREE', 'QUESTION') AND activity_id IS NULL AND external_id IS NULL));

-- Reminders for 1365 records: shortly before ("곧 있어요") and after ("다녀왔어요?").
ALTER TABLE notifications DROP CHECK ck_notification_type;
ALTER TABLE notifications
    ADD CONSTRAINT ck_notification_type CHECK (type IN (
        'APPLIED', 'APPROVED', 'REJECTED', 'CANCELLED', 'WAITLISTED', 'OFFERED', 'OFFER_EXPIRED', 'WAITLIST_CLOSED', 'OFFER_ACCEPTED',
        'START_EXPIRED', 'PENDING_REMINDER', 'RESCHEDULED', 'ACTIVITY_CANCELLED', 'DAY_BEFORE', 'DAY_OF', 'CHECKIN_OPEN', 'QR_TIME',
        'FINISHED', 'CHECKED_IN', 'RECORD_CONFIRMED', 'REVIEW_INVITE', 'LATE', 'NOTICE', 'QUESTION', 'ANSWER', 'COMMUNITY_COMMENT',
        'APPLICATION_RESULT', 'WAITLIST_OFFER', 'ACTIVITY_CHANGED', 'ACTIVITY_REMINDER', 'REPORT_RESULT', 'ORGANIZATION_REVIEW', 'SANCTION',
        'EXT_DAY_BEFORE', 'EXT_CHECK'));
