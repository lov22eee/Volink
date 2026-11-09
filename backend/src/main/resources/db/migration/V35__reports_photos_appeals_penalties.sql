-- Week 7 (2026-11-09): 신고 · 커뮤니티 사진 · 이의신청 · 불참/신고 누적 패널티. The week-2 tables (V3) are widened:
-- a report can be about an activity, a post, a comment or a user; an appeal can be about a no-show, a record or a
-- sanction; a sanction says what it limits (신청 / 글쓰기 / 둘 다) and why. Photos stay on the server's disk (paths only here).

-- Reports: any target, the week-7 reasons, an optional description, one report per person and target.
ALTER TABLE reports
    DROP FOREIGN KEY fk_report_activity,
    DROP CHECK ck_report_reason,
    DROP CHECK ck_report_description;
ALTER TABLE reports
    MODIFY activity_id BIGINT NULL,
    MODIFY description VARCHAR(1000) NOT NULL DEFAULT '',
    ADD COLUMN target_type VARCHAR(20) NOT NULL DEFAULT 'ACTIVITY' AFTER reporter_id,
    ADD COLUMN target_id BIGINT NULL AFTER target_type,
    ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT fk_report_activity FOREIGN KEY (activity_id) REFERENCES activities(id),
    ADD CONSTRAINT ck_report_target CHECK (target_type IN ('ACTIVITY', 'POST', 'COMMENT', 'USER', 'PHOTO')),
    ADD CONSTRAINT ck_report_reason CHECK (reason_type IN ('CONTACT', 'DANGER', 'ABUSE', 'SPAM', 'FALSE_RECORD', 'PRIVACY', 'OTHER',
        'SAFETY', 'HARASSMENT', 'INAPPROPRIATE')),
    ADD UNIQUE INDEX uq_report_once (reporter_id, target_type, target_id);
UPDATE reports SET target_id = activity_id WHERE target_id IS NULL;

-- Report photos: JPEG/PNG re-encoded on the server (no camera metadata), up to 3 per report.
ALTER TABLE report_evidences
    DROP CHECK ck_evidence_type;
ALTER TABLE report_evidences
    ADD CONSTRAINT ck_evidence_type CHECK (content_type IN ('image/jpeg', 'image/png'));

-- Community photos: up to 5 per post, in order. The file is re-encoded (location and other metadata removed).
CREATE TABLE post_photos (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    post_id BIGINT NULL,
    owner_id BIGINT NOT NULL,
    storage_key VARCHAR(80) NOT NULL UNIQUE,
    width INT NOT NULL,
    height INT NOT NULL,
    size_bytes INT NOT NULL,
    position TINYINT NOT NULL DEFAULT 0,
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_photo_post FOREIGN KEY (post_id) REFERENCES community_posts(id),
    CONSTRAINT fk_photo_owner FOREIGN KEY (owner_id) REFERENCES users(id),
    CONSTRAINT ck_photo_size CHECK (size_bytes BETWEEN 1 AND 5242880),
    INDEX ix_photo_post (post_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE community_posts ADD COLUMN hidden_at DATETIME NULL;
ALTER TABLE community_comments ADD COLUMN hidden_at DATETIME NULL;

-- Appeals: a no-show (participation), a record or a sanction; the organizer answers first, then an admin.
ALTER TABLE appeals
    DROP FOREIGN KEY fk_appeal_record,
    DROP INDEX uq_appeal_record_user,
    DROP CHECK ck_appeal_status,
    DROP CHECK ck_appeal_reason;
ALTER TABLE appeals
    MODIFY record_id BIGINT NULL,
    ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'RECORD' AFTER id,
    ADD COLUMN participation_id BIGINT NULL AFTER record_id,
    ADD COLUMN sanction_id BIGINT NULL AFTER participation_id,
    ADD COLUMN reason_code VARCHAR(20) NOT NULL DEFAULT 'OTHER' AFTER user_id,
    ADD COLUMN host_id BIGINT NULL,
    ADD COLUMN host_note VARCHAR(500) NULL,
    ADD COLUMN host_at DATETIME NULL,
    ADD COLUMN host_due_at DATETIME NULL,
    ADD CONSTRAINT fk_appeal_record FOREIGN KEY (record_id) REFERENCES activity_records(id),
    ADD CONSTRAINT fk_appeal_participation FOREIGN KEY (participation_id) REFERENCES participations(id),
    ADD CONSTRAINT fk_appeal_sanction FOREIGN KEY (sanction_id) REFERENCES sanctions(id),
    ADD CONSTRAINT ck_appeal_kind CHECK (kind IN ('NO_SHOW', 'RECORD', 'SANCTION')),
    ADD CONSTRAINT ck_appeal_status CHECK (status IN ('SUBMITTED', 'ESCALATED', 'ACCEPTED', 'REJECTED')),
    ADD CONSTRAINT ck_appeal_reason CHECK (CHAR_LENGTH(TRIM(reason)) >= 5),
    ADD UNIQUE INDEX uq_appeal_participation (participation_id),
    ADD UNIQUE INDEX uq_appeal_record (record_id),
    ADD UNIQUE INDEX uq_appeal_sanction (sanction_id);

-- Sanctions: what they limit and why; a no-show cleared by an accepted appeal stops counting.
ALTER TABLE sanctions
    ADD COLUMN scope VARCHAR(10) NOT NULL DEFAULT 'ALL' AFTER type,
    ADD COLUMN source VARCHAR(10) NOT NULL DEFAULT 'ADMIN' AFTER scope,
    ADD COLUMN revoked_at DATETIME NULL,
    ADD CONSTRAINT ck_sanction_scope CHECK (scope IN ('APPLY', 'WRITE', 'ALL', 'NONE')),
    ADD CONSTRAINT ck_sanction_source CHECK (source IN ('NOSHOW', 'REPORT', 'ADMIN')),
    ADD INDEX ix_sanction_user (user_id, ends_at);
ALTER TABLE participations ADD COLUMN noshow_cleared BOOLEAN NOT NULL DEFAULT FALSE;

-- An appeal received / answered.
ALTER TABLE notifications DROP CHECK ck_notification_type;
ALTER TABLE notifications
    ADD CONSTRAINT ck_notification_type CHECK (type IN (
        'APPLIED', 'APPROVED', 'REJECTED', 'CANCELLED', 'WAITLISTED', 'OFFERED', 'OFFER_EXPIRED', 'WAITLIST_CLOSED', 'OFFER_ACCEPTED',
        'START_EXPIRED', 'PENDING_REMINDER', 'RESCHEDULED', 'ACTIVITY_CANCELLED', 'DAY_BEFORE', 'DAY_OF', 'CHECKIN_OPEN', 'QR_TIME',
        'FINISHED', 'CHECKED_IN', 'RECORD_CONFIRMED', 'REVIEW_INVITE', 'LATE', 'NOTICE', 'QUESTION', 'ANSWER', 'COMMUNITY_COMMENT',
        'APPLICATION_RESULT', 'WAITLIST_OFFER', 'ACTIVITY_CHANGED', 'ACTIVITY_REMINDER', 'REPORT_RESULT', 'ORGANIZATION_REVIEW', 'SANCTION',
        'EXT_DAY_BEFORE', 'EXT_CHECK', 'EXT_REFRESH', 'ACTIVITY_REVIEW', 'APPEAL'));
